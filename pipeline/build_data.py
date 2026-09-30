#!/usr/bin/env python3
"""Radar ITBI SP — build do protótipo (somente leitura).

Lê a tabela analítica da pesquisa (../research/stage/itbi_negocios.parquet, gerada por 06_analitico.py),
o IPTU (../raw/iptu/*_slim.parquet), os lotes GeoSampa (../raw/lotes/lotes_sp.parquet), os anúncios casados
ao lote (../research/stage/qa_lote.parquet) e os distritos do banco `imoveis` (SELECT, readonly; sem o banco,
usa o snapshot ../research/stage/geo_distritos.json gravado na última execução com banco).
Não grava em banco nenhum. Saídas nesta pasta:

  data.json                       agregados da cidade e dos distritos (embutido no HTML)
  itbi_proto.html                 a página, com data.json embutido entre /*__DATA__*/ … /*__END__*/
  dist/{cd}.json                  por distrito, sob demanda: série histórica completa por estrato,
                                  lotes com venda (polígono + resumo) e negócios (colunar)
  ruas.json                       índice de logradouros (busca por rua): nome normalizado → centróide, caixa,
                                  nº de negócios e índices dos lotes por distrito

    python3 build_data.py                 # tudo
    python3 build_data.py --no-dist       # só data.json + ruas.json + HTML
    python3 build_data.py --last-q 2026T2 # força o último trimestre completo (padrão: automático)

Regras (ver ../research/DECISOES.md): preço = só negócios `preco_ok` (SQL próprio, sem flag); planta entra no
volume e na liquidez como série separada; mediana móvel de 4 trimestres (TTM) com IQR e n; intervalo de
confiança da mediana ≈ med ± 1,58·IQR/√n (entalhe de McGill) calculado no navegador; n < mínimo → cinza.
Tipos (I-036): seis grupos do seletor — apto · casa · terreno · sala (lojas, escritórios e comerciais) · vaga ·
galpao. Base do preço por grupo: R$/m² construído (apto, casa, sala, galpao), R$/m² de terreno (terreno),
R$/unidade (vaga). Faixas de tamanho próprias para terreno e galpão; vaga só tem padrão e idade.
"""
from __future__ import annotations

import argparse, json, math, re, sys, time, unicodedata
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import shapely

HERE = Path(__file__).resolve().parent
ITBI = HERE.parent
ST = ITBI / "research" / "stage"
RAW = ITBI / "raw"
FIIQ = HERE.parents[3]
SP_CAPITAL_JSON = FIIQ / "dashboard/src/components/map/limites/sp_capital.json"
SP_CAPITAL_SNAP = ST / "sp_capital.json"
DIST_SNAP = ST / "geo_distritos.json"
OUT_DIST = HERE / "dist"
DSN_GEO = "dbname=imoveis user=gustavosantos host=localhost"

Q0 = 2006                       # 1º ano da série
MIN_N = 10                      # n mínimo para mostrar mediana (abaixo: cinza)
# ── tipos (I-036) ────────────────────────────────────────────────────────────
TIPOS = ["apto", "casa", "terreno", "sala", "vaga", "galpao"]          # grupos do seletor, na ordem da faixa
GRUPO = {"apto": "apto", "casa": "casa", "sala": "sala", "loja": "sala", "escr": "sala", "vaga": "vaga",
         "terreno": "terreno", "galpao": "galpao"}                        # tipo bruto → grupo
GRUPO_LB = {"apto": "Apartamentos", "casa": "Casas e residências", "terreno": "Terrenos",
            "sala": "Lojas, escritórios e comerciais", "vaga": "Garagens e vagas", "galpao": "Galpões logísticos"}
GRUPO_LB1 = {"apto": "Apartamento", "casa": "Casa", "terreno": "Terreno", "sala": "Loja/escritório/comercial",
             "vaga": "Vaga de garagem", "galpao": "Galpão logístico"}     # singular, para frases
TIPO_LB = {"apto": "Apartamento", "casa": "Casa", "sala": "Sala/flat comercial", "loja": "Loja", "escr": "Prédio de escritórios",
           "vaga": "Vaga de garagem", "terreno": "Terreno", "galpao": "Galpão/indústria", "outros": "Outros", "planta": "Planta"}
BASE = {"apto": "m2c", "casa": "m2c", "sala": "m2c", "galpao": "m2c", "terreno": "m2t", "vaga": "unid"}
BASE_LB = {"m2c": "R$/m² de área construída (IPTU)", "m2t": "R$/m² de área do terreno (IPTU)", "unid": "R$ por unidade (vaga)"}
DIMS_TIPO = {"apto": ["area", "padrao", "idade", "quartos"], "casa": ["area", "padrao", "idade"], "sala": ["area", "padrao", "idade"],
             "galpao": ["area", "padrao", "idade"], "terreno": ["area"], "vaga": ["padrao", "idade"]}
DIMS = {"todos": None, "area": "f_area", "padrao": "f_padrao", "idade": "f_idade", "quartos": "f_quartos"}
FAIXAS = {"area": ["≤45", "45–70", "70–100", "100–150", "150–250", ">250"],
          "padrao": ["A", "B", "C", "D", "E", "F"],
          "idade": ["≤3", "4–10", "11–20", "21–35", ">35"],
          "quartos": ["1", "2", "3", "4+"], "todos": ["todos"]}
FAIXAS_TIPO = {"terreno": {"area": ["≤150", "150–250", "250–500", "500–1.000", "1.000–5.000", ">5.000"]},
               "galpao": {"area": ["≤300", "300–600", "600–1.200", "1.200–2.500", ">2.500"]}}
TIPO_CODE = {"apto": 0, "casa": 1, "sala": 2, "loja": 3, "vaga": 4, "terreno": 5, "outros": 6, "planta": 7, "galpao": 8, "escr": 9}
PRECO_TIPOS = ["apto", "casa", "sala", "loja", "escr", "galpao", "terreno", "vaga"]


def fx_list(grp: str, dim: str) -> list:
    return FAIXAS_TIPO.get(grp, {}).get(dim) or FAIXAS[dim]


t0 = time.time()
log = lambda *a: print(f"[{time.time() - t0:6.1f}s]", *a, flush=True)


def qidx(ano, tri):
    return (ano - Q0) * 4 + (tri - 1)


def load_negocios() -> pd.DataFrame:
    cols = ["sql11", "data_transacao", "ano", "tri", "tipo", "grupo", "planta", "preco_ok", "motivo_fora_preco", "valor", "valor100",
            "area_construida", "area_terreno", "rsm2", "preco", "base_preco", "f_area", "f_padrao", "f_idade", "f_quartos", "quartos_est",
            "idade", "fin_flag", "fin", "vvr", "bloco", "cd_distrito", "distrito", "lot_id", "geo_nivel", "logradouro", "numero",
            "complemento", "referencia", "uso_cod", "acc_ano", "padrao_cod", "prop_c"]
    N = pd.read_parquet(ST / "itbi_negocios.parquet", columns=cols)
    N["qi"] = (N.ano - Q0) * 4 + N.tri.str[-1].astype(int) - 1
    N = N[N.qi >= 0].copy()
    N["cd"] = N.cd_distrito.astype("string").str.lstrip("0").where(N.cd_distrito.notna(), None)
    return N


def last_full_quarter(lastd: pd.Timestamp) -> tuple[int, int]:
    """Último trimestre completo: o fim do trimestre precisa estar ≥ 30 dias antes da última data do arquivo
    (a Fazenda publica com defasagem; os últimos dias de um trimestre recém-fechado ainda estão incompletos)."""
    y, q = lastd.year, (lastd.month - 1) // 3 + 1
    while True:
        end = pd.Timestamp(y, q * 3, 1) + pd.offsets.MonthEnd(0)
        if end + pd.Timedelta(days=30) <= lastd:
            return (y, q)
        q -= 1
        if q == 0:
            y, q = y - 1, 4


# ── séries de preço: mediana móvel de 4 trimestres (TTM) com IQR e n ─────────────
def price_series(N: pd.DataFrame, NQ: int) -> pd.DataFrame:
    P = N[N.preco_ok & N.grupo.isin(TIPOS) & (N.qi < NQ) & N.preco.notna()][["qi", "cd", "grupo", "preco", "f_area", "f_padrao", "f_idade", "f_quartos"]]
    P = P.rename(columns={"grupo": "tipo", "preco": "rsm2"})
    con = duckdb.connect()
    con.register("p", P)
    sel = " union all ".join(
        [f"select qi, cd, tipo, rsm2, 'todos' dim, 'todos' faixa from p"] +
        [f"select qi, cd, tipo, rsm2, '{d}' dim, {c} faixa from p where {c} is not null" for d, c in DIMS.items() if c])
    q = f"""
      with u as ({sel}),
      w as (select u.qi + k.k qe, u.* from u, (select range k from range(4)) k),
      g as (select qe, cd, tipo, dim, faixa, rsm2 from w union all select qe, 'SP' cd, tipo, dim, faixa, rsm2 from w)
      select cd, tipo, dim, faixa, qe, count(*) n,
             quantile_cont(rsm2, 0.25) p25, quantile_cont(rsm2, 0.5) med, quantile_cont(rsm2, 0.75) p75
      from g where qe < {NQ} and qe >= 3 group by all"""
    S = con.execute(q).df()
    log("séries de preço:", len(S), "células")
    return S


def pack_series(S: pd.DataFrame, cd: str, NQ: int, q_from: int = 3) -> dict:
    """{ 'apto|area|≤45': [n[], p25[], med[], p75[]] } — índices de trimestre q_from..NQ-1; null onde n=0."""
    out = {}
    sub = S[S.cd == cd]
    L = NQ - q_from
    for (tipo, dim, faixa), g in sub.groupby(["tipo", "dim", "faixa"]):
        arr = [[0] * L, [None] * L, [None] * L, [None] * L]
        for qe, n, a, m, b in zip(g.qe, g.n, g.p25, g.med, g.p75):
            i = qe - q_from
            if 0 <= i < L:
                arr[0][i] = int(n); arr[1][i] = int(round(a)); arr[2][i] = int(round(m)); arr[3][i] = int(round(b))
        if max(arr[0]) > 0:
            out[f"{tipo}|{dim}|{faixa}"] = arr
    return out


# ── volume, liquidez, financiamento, novo × usado, exclusão ──────────────────────
def volume_tables(N: pd.DataFrame, giro: dict, NQ: int, LAST_Q: tuple) -> tuple[dict, dict]:
    """Por trimestre (cidade e distritos) e por ano (exclusão, giro)."""
    V = N[(N.qi < NQ)].copy()
    V["own"] = ~V.planta & ~V.tipo.isin(["vaga"])
    V["res"] = V.tipo.isin(["apto", "casa"]) & ~V.planta
    V["ap_own"] = (V.tipo == "apto")
    V["novo"] = V.ap_own & (V.idade <= 3)
    # universo do mapa de exclusão (I-036): todos os tipos com preço + planta (antes: apto, casa, sala, loja, planta)
    V["universo"] = V.tipo.isin(PRECO_TIPOS + ["planta"])
    V["excl"] = V.universo & ~V.preco_ok
    V["excl_planta"] = V.tipo.eq("planta")
    geos = [("SP", V)] + [(cd, g) for cd, g in V[V.cd.notna()].groupby("cd")]
    vol, exc = {}, {}
    anos = list(range(Q0, LAST_Q[0] + 1))
    for cd, g in geos:
        q = g.groupby("qi")
        own = q.own.sum(); pl = q.planta.sum()
        rv_own = g[g.own].groupby("qi").valor.sum() / 1e6
        rv_pl = g[g.planta].groupby("qi").valor.sum() / 1e6
        fin = g[g.res].groupby("qi").fin_flag.mean() * 100
        nres = g[g.res].groupby("qi").size()
        nov = g[g.ap_own].groupby("qi").novo.sum(); apn = g[g.ap_own].groupby("qi").size()
        vol[cd] = {"own": [int(x) for x in own.reindex(range(NQ), fill_value=0)],
                   "pl": [int(x) for x in pl.reindex(range(NQ), fill_value=0)],
                   "rv": [None if pd.isna(x) else round(x, 1) for x in rv_own.reindex(range(NQ)).tolist()],
                   "rvp": [None if pd.isna(x) else round(x, 1) for x in rv_pl.reindex(range(NQ)).tolist()],
                   "fin": [None if (pd.isna(x) or n < MIN_N) else round(x, 1) for x, n in zip(fin.reindex(range(NQ)), nres.reindex(range(NQ), fill_value=0))],
                   "nres": [int(x) for x in nres.reindex(range(NQ), fill_value=0)],
                   "nov": [int(x) for x in nov.reindex(range(NQ), fill_value=0)],
                   "apn": [int(x) for x in apn.reindex(range(NQ), fill_value=0)],
                   "bl": [int(x) for x in q.bloco.sum().reindex(range(NQ), fill_value=0)]}
        y = g[g.universo].groupby("ano")
        uni = y.size().reindex(anos, fill_value=0)
        exc[cd] = {"uni": [int(x) for x in uni],
                   "pl": [int(x) for x in y.excl_planta.sum().reindex(anos, fill_value=0)],
                   "fl": [int(x) for x in (y.excl.sum() - y.excl_planta.sum()).reindex(anos, fill_value=0)]}
        if cd in giro:
            exc[cd]["giro"] = giro[cd]
    log("volume/exclusão:", len(vol), "geos")
    return vol, exc


def iptu_exercicios() -> list[int]:
    return sorted(int(p.name[5:9]) for p in (RAW / "iptu").glob("iptu_*_slim.parquet"))


def giro_por_ano(N: pd.DataFrame, LAST_Q: tuple) -> tuple[dict, dict]:
    """Giro anual = unidades de apartamento vendidas (SQL distintos, SQL próprio) ÷ estoque de apartamentos do
    IPTU do exercício mais próximo (distrito pela quadra fiscal). %, com numerador e denominador."""
    con = duckdb.connect()
    qd = con.execute(f"""select setor||quadra sq, mode(ltrim(cd_distrito,'0')) cd
                         from '{ST}/lotes_centroides.parquet' where tp_lote='F' group by 1""").df()
    con.register("qd", qd)
    ex = iptu_exercicios()
    stock = {}
    for e in ex:
        s = con.execute(f"""select qd.cd, count(*) n from '{RAW}/iptu/iptu_{e}_slim.parquet' i
                            join qd on qd.sq = substr(i.sql,1,6)
                            where lower(i.uso) like 'apartamento%' group by 1""").df()
        stock[e] = dict(zip(s.cd, s.n))
    anos = list(range(Q0, LAST_Q[0] + 1))
    near = {a: min(ex, key=lambda e: (abs(e - a), -e)) for a in anos}
    A = N[(N.tipo == "apto") & N.cd.notna()]
    sold = A.groupby(["cd", "ano"]).sql11.nunique()
    soldc = A.groupby("ano").sql11.nunique()
    out = {}
    for cd in list(A.cd.dropna().unique()) + ["SP"]:
        row = []
        for a in anos:
            st = sum(stock[near[a]].values()) if cd == "SP" else stock[near[a]].get(cd)
            sv = int(soldc.get(a, 0)) if cd == "SP" else int(sold.get((cd, a), 0))
            row.append([sv, int(st) if st else None])
        out[cd] = row
    log("giro: exercícios IPTU", ex)
    return out, {a: near[a] for a in anos}


# ── geometria ──────────────────────────────────────────────────────────────────
def distritos() -> dict:
    """Distritos do banco `imoveis` (SELECT readonly). Sem banco (máquina sem Postgres, GitHub Action), lê o
    snapshot geo_distritos.json gravado na última execução com banco — mesma geometria, mesma simplificação."""
    try:
        import psycopg2
        conn = psycopg2.connect(DSN_GEO, connect_timeout=5); conn.set_session(readonly=True)
    except Exception as e:   # noqa: BLE001 — sem banco: snapshot
        if not DIST_SNAP.exists():
            raise SystemExit(f"Postgres `imoveis` indisponível ({e}) e sem snapshot {DIST_SNAP}")
        log("distritos: Postgres indisponível, usando o snapshot", DIST_SNAP.name)
        return json.loads(DIST_SNAP.read_text())
    cur = conn.cursor()
    cur.execute("""select cd, nome, regiao5, regiao8, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0003), 5),
                          ST_XMin(geom), ST_YMin(geom), ST_XMax(geom), ST_YMax(geom),
                          ST_X(ST_PointOnSurface(geom)), ST_Y(ST_PointOnSurface(geom))
                   from geo_distrito order by cd""")
    feats = []
    for cd, nome, r5, r8, g, x0, y0, x1, y1, px, py in cur.fetchall():
        feats.append({"type": "Feature", "properties": {"cd": str(int(cd)), "nome": nome.title(), "r5": r5, "r8": r8,
                      "bb": [round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)], "lab": [round(px, 5), round(py, 5)]},
                      "geometry": json.loads(g)})
    conn.close()
    fc = {"type": "FeatureCollection", "features": feats}
    DIST_SNAP.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")))
    log("distritos: banco `imoveis`; snapshot gravado em", DIST_SNAP.name)
    return fc


def sp_capital() -> dict:
    src = SP_CAPITAL_JSON if SP_CAPITAL_JSON.exists() else SP_CAPITAL_SNAP
    g = json.loads(src.read_text())
    g = g["geometry"] if "geometry" in g else g
    rc = lambda c: [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [rc(x) for x in c]
    out = {"type": g["type"], "coordinates": rc(g["coordinates"])}
    if src is SP_CAPITAL_JSON and not SP_CAPITAL_SNAP.exists():
        SP_CAPITAL_SNAP.write_text(json.dumps(out, separators=(",", ":")))
    return out


def enc_ring(coords) -> list:
    """Anel → inteiros 1e-6° em delta (o 1º par absoluto). O navegador reconstrói."""
    out, px, py = [], 0, 0
    for x, y in coords[:-1]:
        ix, iy = int(round(x * 1e6)), int(round(y * 1e6))
        out += [ix - px, iy - py]; px, py = ix, iy
    return out


# ── índice de ruas (busca) ───────────────────────────────────────────────────────
TIPO_LOGR = {"R": "Rua", "AV": "Avenida", "AL": "Alameda", "TV": "Travessa", "PC": "Praça", "LG": "Largo", "ES": "Estrada",
             "VD": "Viaduto", "PTE": "Ponte", "ROD": "Rodovia", "VL": "Vila", "JD": "Jardim", "PQ": "Parque", "BC": "Beco",
             "CAM": "Caminho", "PSG": "Passagem", "PAS": "Passagem", "LD": "Ladeira", "TUN": "Túnel", "MRG": "Marginal",
             "PRQ": "Parque", "CJ": "Conjunto", "ACS": "Acesso", "CPO": "Campo", "COMPL": "Complexo", "ESTR": "Estrada",
             "EST": "Estrada", "TR": "Travessa", "RUA": "Rua", "AVN": "Avenida", "PR": "Praça"}
ABREV = {"DR": "Dr.", "DRA": "Dra.", "PROF": "Prof.", "PROFA": "Profa.", "BRIG": "Brig.", "NSRA": "Nossa Senhora", "STO": "Santo",
         "STA": "Santa", "PDE": "Padre", "PE": "Padre", "CEL": "Cel.", "MAL": "Mal.", "GAL": "Gal.", "SEN": "Sen.", "DEP": "Dep.",
         "ENG": "Eng.", "MIN": "Min.", "CONS": "Cons.", "ALM": "Alm.", "CAP": "Cap.", "TEN": "Ten.", "SGT": "Sgt.", "VER": "Ver.",
         "PRES": "Pres.", "DES": "Des.", "COM": "Com.", "CTE": "Cte.", "MONS": "Mons.", "FR": "Frei", "D": "D.", "SD": "Sd.",
         "MJ": "Maj.", "MAJ": "Maj.", "PQ": "Pq.", "JD": "Jd."}
MINUSC = {"DE", "DA", "DO", "DAS", "DOS", "E", "EM", "A", "O", "AO", "AOS", "NA", "NO", "NAS", "NOS", "COM", "SEM", "POR", "PARA"}


def norm_txt(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().upper()


def display_logr(raw: str) -> str:
    toks = norm_txt(raw).split(" ")
    if not toks or not toks[0]:
        return ""
    out = []
    for i, t in enumerate(toks):
        if i == 0 and t in TIPO_LOGR:
            out.append(TIPO_LOGR[t]); continue
        if i > 0 and t in MINUSC and t != toks[0]:
            out.append(t.lower()); continue
        if t in ABREV and i > 0:
            out.append(ABREV[t]); continue
        if t.isdigit():
            out.append(t); continue
        out.append(t.capitalize())
    # nomes originais com acento ficam melhores: usa o bruto quando existir (só capitaliza)
    return " ".join(out)


def sem_tipo(norm: str) -> str:
    toks = norm.split(" ")
    return " ".join(toks[1:]) if toks and toks[0] in TIPO_LOGR and len(toks) > 1 else norm


# ── lotes com venda: polígono + resumo + negócios (por distrito) ─────────────
def build_dist_files(N: pd.DataFrame, S: pd.DataFrame, giro_ex: dict, NQ: int, iptu_ex: int) -> tuple[dict, dict]:
    OUT_DIST.mkdir(exist_ok=True)
    lots_ids = set(N.lot_id.dropna().unique())
    tb = pq.read_table(RAW / "lotes" / "lotes_sp.parquet")
    L = tb.drop(["geometry"]).to_pandas()
    L["lot_id"] = L.setor + L.quadra + L.lote + L.condominio
    L["pref"] = (L.tp_lote != "F").astype(int)
    L["row"] = np.arange(len(L))
    L = L[L.lot_id.isin(lots_ids)].sort_values(["lot_id", "pref"]).drop_duplicates("lot_id")
    geoms = shapely.from_wkb(tb.column("geometry").take(pa_indices(L.row.values)).to_numpy(zero_copy_only=False))
    geoms = shapely.simplify(geoms, 0.000004, preserve_topology=True)
    cen = shapely.point_on_surface(geoms)
    L["gx"] = shapely.get_x(cen); L["gy"] = shapely.get_y(cen)
    L["geom"] = list(geoms)
    L["cd"] = L.cd_distrito.str.lstrip("0")
    log("lotes com venda e polígono:", len(L), "de", len(lots_ids))
    # perfil IPTU (exercício mais recente) por lote (condomínio → agregado; demais → o próprio SQL)
    con = duckdb.connect()
    ip = con.execute(f"""
      select case when condominio<>'00-0' then substr(sql,1,6)||'0000'||substr(condominio,1,2) else substr(sql,1,10)||'00' end lot_id,
             count(*) n_unid, sum(case when lower(uso) like 'apartamento%' then 1 else 0 end) n_apto,
             sum(case when lower(uso) like 'garagem%' then 1 else 0 end) n_gar,
             max(try_cast(pavimentos as int)) pav, mode(try_cast(acc as int)) acc, mode(padrao) padrao, mode(uso) uso,
             mode(referencia) refe, mode(logradouro) logr, mode(numero) num,
             list(try_cast(area_construida as double)) filter (where lower(uso) like 'apartamento%') areas
      from '{RAW}/iptu/iptu_{iptu_ex}_slim.parquet' group by 1""").df()
    ip = ip[ip.lot_id.isin(lots_ids)].set_index("lot_id")
    # tipologias do cadastro: até 6 áreas de apto mais frequentes (m² construída IPTU)
    def tipologias(a):
        if not isinstance(a, (list, np.ndarray)) or len(a) == 0:   # NULL do DuckDB chega como NA
            return None
        s = pd.Series(np.round(np.asarray(a, dtype=float))).value_counts()
        return [[int(k), int(v)] for k, v in s.head(6).items()]
    ip["tip"] = ip.areas.map(tipologias)
    # anúncios QuintoAndar no lote
    qa = pd.read_parquet(ST / "qa_lote.parquet")
    qa = qa[qa.lote.notna()].copy()
    qa["lot_id"] = qa.setor + qa.quadra + qa.lote + qa.condominio
    qa = qa[qa.lot_id.isin(lots_ids)]
    qa["area"] = qa.area.astype(float); qa["sale_price"] = qa.sale_price.astype(float); qa["rent"] = qa.rent.astype(float)
    qs = {}
    for lid, g in qa.groupby("lot_id"):
        sale = g[g.business == "SALE"]; rent = g[g.business == "RENT"]
        byq = g.groupby(g.quartos.fillna(-1).astype(int)).agg(n=("id", "size"), a=("area", "median"),
                                                               p=("sale_price", "median"), r=("rent", "median"))
        qs[lid] = {"n": int(len(g)), "ns": int(len(sale)), "nr": int(len(rent)),
                   "q": [[int(k), int(v.n), ii(v.a), ii(v.p), ii(v.r)] for k, v in byq.iterrows() if k >= 0],
                   "am": ii(g.area.median()),
                   "pm2": ii((sale.sale_price / sale.area).median()) if len(sale) else None}
    # resumo de negócios por lote
    Nl = N[N.lot_id.notna()].copy()
    Nl["days"] = (Nl.data_transacao - pd.Timestamp("2006-01-01")).dt.days
    Nl["logr_norm"] = Nl.logradouro.map(norm_txt)
    lastd = Nl.data_transacao.max()
    # índice de faixa de área por grupo (I-036): terreno e galpão têm faixas próprias
    fa_idx = {}
    for g in TIPOS:
        for i, f in enumerate(fx_list(g, "area")):
            fa_idx[(g, f)] = i
    for i, f in enumerate(FAIXAS["area"]):
        fa_idx[("_", f)] = i
    motivos = sorted(N.motivo_fora_preco.dropna().unique())
    mo_idx = {m: i for i, m in enumerate(motivos)}
    manifest, ruas = {}, {}
    for cd, Ld in L.groupby("cd"):
        Ld = Ld.reset_index(drop=True)
        idx = {lid: i for i, lid in enumerate(Ld.lot_id)}
        D = Nl[Nl.lot_id.isin(idx)].sort_values("data_transacao")
        # agregados por lote (vetorizado)
        D = D.assign(li=D.lot_id.map(idx))
        recent5 = D.data_transacao >= lastd - pd.Timedelta(days=5 * 365)
        recent1 = D.data_transacao >= lastd - pd.Timedelta(days=365)
        # tipo predominante do lote: a vaga só predomina quando o lote só tem vagas (prédio-garagem); num condomínio
        # residencial as vagas vendidas junto com os aptos não podem rotular o prédio como "vaga"
        agg = D.groupby("li").agg(n=("days", "size"), d1=("days", "min"), d2=("days", "max"),
                                  tipo=("tipo", lambda s: s[s != "vaga"].mode().iloc[0] if (s != "vaga").any() else "vaga"), pl=("planta", "sum"),
                                  logr=("logradouro", "first"), num=("numero", "first"), ref=("referencia", "first"))
        # preço de 5 anos do lote: só negócios do MESMO grupo do tipo predominante (bases diferentes não se misturam: I-036)
        lot_grp = agg.tipo.map(GRUPO)
        Dp = D[D.preco_ok & recent5 & D.preco.notna() & (D.grupo == D.li.map(lot_grp))]
        pk = Dp.groupby("li").preco.agg(["size", lambda s: s.quantile(.25), "median", lambda s: s.quantile(.75)])
        pk.columns = ["n", "a", "m", "b"]
        n5 = D[recent5].groupby("li").size(); n1 = D[recent1 & (D.tipo == "apto")].groupby("li").sql11.nunique()
        feats = []
        for i, r in Ld.iterrows():
            a = agg.loc[i] if i in agg.index else None
            prof = ip.loc[r.lot_id] if r.lot_id in ip.index else None
            geom = r.geom
            rings = [enc_ring(list(geom.exterior.coords))] if geom.geom_type == "Polygon" else \
                    [enc_ring(list(p.exterior.coords)) for p in geom.geoms]
            p = pk.loc[i] if i in pk.index else None
            n_apto = ii(prof.n_apto) if prof is not None else None
            feats.append({
                "id": r.lot_id, "c": [round(r.gx, 6), round(r.gy, 6)], "g": rings,
                "n": int(a.n) if a is not None else 0, "n5": int(n5.get(i, 0)), "pl": int(a.pl) if a is not None else 0,
                "d2": int(a.d2) if a is not None else None, "t": a.tipo if a is not None else None,
                "nm": (prof.refe if prof is not None and isinstance(prof.refe, str) else (a.ref if a is not None and isinstance(a.ref, str) else None)),
                "end": endereco(prof, a),
                "p": [ii(p.n), ii(p.a), ii(p.m), ii(p.b)] if p is not None else None,
                "u": [ii(prof.n_unid), n_apto, ii(prof.n_gar), ii(prof.pav), ii(prof.acc),
                      prof.padrao if isinstance(prof.padrao, str) else None, prof.uso if isinstance(prof.uso, str) else None] if prof is not None else None,
                "tp": prof.tip if prof is not None else None,
                "g1": [int(n1.get(i, 0)), n_apto] if n_apto else None,
                "qa": qs.get(r.lot_id)})
        grp_of = D.grupo.where(D.grupo.notna(), "_")
        deals = {
            "li": D.li.astype(int).tolist(), "d": D.days.astype(int).tolist(),
            "v": [int(x) for x in D.valor.round()], "v100": [None if pd.isna(x) else int(x) for x in D.valor100.round()],
            "a": [None if pd.isna(x) else round(float(x), 1) for x in D.area_construida],
            "at": [None if (pd.isna(x) or t != "terreno") else round(float(x), 1) for x, t in zip(D.area_terreno, D.tipo)],
            "t": [TIPO_CODE[t] for t in D.tipo],
            "fa": [None if x is None or pd.isna(x) else fa_idx.get((g, x)) for x, g in zip(D.f_area, grp_of)],
            "fp": [None if x is None or pd.isna(x) else FAIXAS["padrao"].index(x) for x in D.f_padrao],
            "fi": [None if x is None or pd.isna(x) else FAIXAS["idade"].index(x) for x in D.f_idade],
            "fq": [None if x is None or pd.isna(x) else FAIXAS["quartos"].index(x) for x in D.f_quartos],
            "ok": [1 if x else 0 for x in D.preco_ok],
            "mo": [None if x is None or pd.isna(x) else mo_idx[x] for x in D.motivo_fora_preco],
            "fin": [1 if x else 0 for x in D.fin_flag],
            "cp": [None if x is None or pd.isna(x) else str(x)[:22] for x in D.complemento],
            "ac": [None if pd.isna(x) or x <= 0 else int(x) for x in D.acc_ano],
        }
        payload = {"cd": cd, "lots": feats, "deals": deals, "series": pack_series(S, cd, NQ)}
        f = OUT_DIST / f"{cd}.json"
        f.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        manifest[cd] = {"lots": len(feats), "deals": len(D), "kb": round(f.stat().st_size / 1024)}
        # índice de ruas: por logradouro normalizado, os lotes (índice no arquivo do distrito) e as coordenadas
        for nm, g in D[D.logr_norm != ""].groupby("logr_norm"):
            r = ruas.setdefault(nm, {"raw": {}, "n": 0, "lots": {}, "xs": [], "ys": []})
            r["n"] += len(g)
            for raw_nm, k in g.logradouro.value_counts().items():
                r["raw"][raw_nm] = r["raw"].get(raw_nm, 0) + int(k)
            lis = sorted(set(int(x) for x in g.li))
            r["lots"][cd] = [b - a for a, b in zip([0] + lis[:-1], lis)]   # delta-encode (o navegador soma)
            r["xs"] += [float(Ld.gx[i]) for i in lis]; r["ys"] += [float(Ld.gy[i]) for i in lis]
    log("arquivos por distrito:", len(manifest), "· total MB", round(sum(m["kb"] for m in manifest.values()) / 1024, 1))
    return manifest, ruas


def write_ruas(ruas: dict, lastd) -> None:
    rows = []
    for nm, r in ruas.items():
        if not r["xs"]:
            continue
        raw = max(r["raw"].items(), key=lambda kv: kv[1])[0]
        xs, ys = np.array(r["xs"]), np.array(r["ys"])
        rows.append([display_logr(raw), round(float(np.median(xs)), 5), round(float(np.median(ys)), 5),
                     round(float(xs.min()), 5), round(float(ys.min()), 5), round(float(xs.max()), 5), round(float(ys.max()), 5),
                     int(r["n"]), r["lots"], nm])
    rows.sort(key=lambda x: -x[7])
    out = {"meta": {"cols": ["nome", "lng", "lat", "x0", "y0", "x1", "y1", "n_negocios", "lotes_por_distrito (índices em delta)", "chave"],
                    "fonte": "logradouro das guias de ITBI (cadastro do IPTU) → lotes com venda", "built": time.strftime("%Y-%m-%d %H:%M"),
                    "last_date": str(pd.Timestamp(lastd).date()), "n": len(rows)}, "ruas": rows}
    js = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    (HERE / "ruas.json").write_text(js)
    log("ruas.json:", len(rows), "logradouros ·", round(len(js) / 1e6, 2), "MB")


def endereco(prof, a):
    """'LOGRADOURO NÚMERO' do IPTU (preferência) ou da guia; sem número → só o logradouro; espaços duplicados colapsados."""
    if prof is not None and isinstance(prof.logr, str):
        logr, num = prof.logr, prof.num if isinstance(prof.num, str) and prof.num.strip() else None
        num = num.lstrip("0") if num else None
    elif a is not None and isinstance(a.logr, str):
        logr, num = a.logr, (str(int(a.num)) if pd.notna(a.num) and a.num > 0 else None)
    else:
        return None
    return re.sub(r"\s+", " ", (logr + (" " + num if num else "")).strip()) or None


def ii(x):
    """int ou None (NaN/NA/inf → None)."""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return int(round(x)) if math.isfinite(x) else None


def pa_indices(rows):
    import pyarrow as pa
    return pa.array(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-dist", action="store_true", help="só data.json, ruas.json (se dist já existe: não) e HTML")
    ap.add_argument("--last-q", default=None, help="último trimestre completo, ex.: 2026T2 (padrão: automático)")
    a = ap.parse_args()
    N = load_negocios()
    log("negócios:", len(N))
    lastd = N.data_transacao.max()
    if a.last_q:
        m = re.fullmatch(r"(\d{4})T([1-4])", a.last_q)
        if not m:
            raise SystemExit("--last-q no formato AAAATn, ex.: 2026T2")
        LAST_Q = (int(m.group(1)), int(m.group(2)))
    else:
        LAST_Q = last_full_quarter(lastd)
    NQ = qidx(*LAST_Q) + 1
    QLAB = [f"{(k % 4) + 1}T{Q0 + k // 4}" for k in range(NQ)]
    iptu_ex = max(iptu_exercicios())
    log("último trimestre completo:", QLAB[-1], "· última data:", lastd.date(), "· IPTU do perfil:", iptu_ex)
    S = price_series(N, NQ)
    giro, giro_ex = giro_por_ano(N, LAST_Q)
    vol, exc = volume_tables(N, giro, NQ, LAST_Q)
    dist = distritos()
    # recente (últimos 12 trimestres TTM) de TODOS os distritos: mapa e quadrante
    recent = {}
    RQ = 12
    for cd in [f["properties"]["cd"] for f in dist["features"]] + ["SP"]:
        recent[cd] = pack_series(S, cd, NQ, q_from=NQ - RQ)
    motivos = sorted(N.motivo_fora_preco.dropna().unique())
    data = {
        "meta": {"q": QLAB, "q_from_full": 3, "q_from_recent": NQ - RQ, "min_n": MIN_N, "last_date": str(lastd.date()),
                 "last_q": QLAB[-1], "giro_iptu": giro_ex, "anos": list(range(Q0, LAST_Q[0] + 1)),
                 "faixas": FAIXAS, "faixas_tipo": FAIXAS_TIPO, "tipos": TIPOS, "grupo": GRUPO, "grupo_lb": GRUPO_LB, "grupo_lb1": GRUPO_LB1,
                 "tipo_lb": TIPO_LB, "base": BASE, "base_lb": BASE_LB, "dims_tipo": DIMS_TIPO,
                 "tipo_code": TIPO_CODE, "motivos": motivos, "iptu_perfil": iptu_ex, "ruas": "ruas.json",
                 "built": time.strftime("%Y-%m-%d %H:%M")},
        "geo": {"distritos": dist, "sp_capital": sp_capital()},
        "city": {"series": pack_series(S, "SP", NQ)},
        "recent": recent, "vol": vol, "exc": exc,
    }
    if not a.no_dist:
        data["meta"]["dist_files"], ruas = build_dist_files(N, S, giro_ex, NQ, iptu_ex)
        write_ruas(ruas, lastd)
    elif (HERE / "data.json").exists():
        try:
            data["meta"]["dist_files"] = json.loads((HERE / "data.json").read_text())["meta"].get("dist_files")
        except Exception:   # noqa: BLE001
            pass
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    (HERE / "data.json").write_text(js)
    log("data.json MB", round(len(js) / 1e6, 2))
    html = HERE / "itbi_proto.html"
    if html.exists():
        s = html.read_text()
        i, j = s.index("/*__DATA__*/"), s.index("/*__END__*/")
        html.write_text(s[:i] + "/*__DATA__*/" + js + s[j:])
        log("HTML atualizado:", html.name)


if __name__ == "__main__":
    main()
