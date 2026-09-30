#!/usr/bin/env python3.12
"""Radar ITBI · módulo Aluguel: agregados do A5 → proto/aluguel/*.json (servidos pelo serve.py, nunca embutidos).

Fontes (somente leitura; nada em banco):
  ../research/stage/fase2_aluguel_{anuncios,predio,distrito,hex,cobertura,curta,curta_vs_longa,fipezap_sp}.parquet (A5)
  ../raw/iptu/iptu_2026_slim.parquet + ../research/stage/lotes_centroides.parquet (estoque por hexágono, nome do prédio)
  dist/{cd}.json (ids e ponto dos lotes com venda ITBI: o prédio com lote em dist/ abre a página do Prédio)

Regras (A5 · P-A5-n; A6 · H9/H15/H17):
  QuintoAndar = foto única de 20/06/2026, preço PEDIDO, área ÚTIL; só agregados (distrito, hexágono, prédio com n) —
  nunca um ponto por anúncio (P-A5-14). Yield do mapa = yield da unidade (dupla oferta, P-A5-9); yield sobre o
  fechamento ITBI só como segundo número (P-A5-10). Inside Airbnb só por hexágono/distrito (CC BY 4.0, P-A5-13).
  Mediana e IQR; n sempre junto; ausente = null; percentuais 0–100; R$ cheio.

Saídas (proto/aluguel/):
  distrito.json   distrito (e cidade 'SP') × grupo (apto|casa) × dim (todos|quartos|area_util) × faixa
  hex.json        hexágonos ~500 m (mesmo esquema do A5; geometria refeita no cliente a partir de hq/hr)
  predios/<cd>.json  prédios com anúncio de aluguel (lote cadastral ou ponto nativo fora de lote)
  curta.json      Airbnb por hexágono e por distrito (+ noites para empatar com o aluguel longo)
  fipezap.json    série da cidade (contexto temporal da foto)
  meta.json       fontes, datas, licenças, cobertura por distrito e por padrão, constantes do hexágono

    python3.12 build_aluguel.py        (≈ 1 min; duckdb com memory_limit 2GB, threads 2)
"""
from __future__ import annotations

import json
import math
import re
import time
import warnings
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=RuntimeWarning)   # medianas de células vazias (NaN → null)
H = Path(__file__).resolve().parent
ST = H.parent / "research" / "stage"
RAW = H.parent / "raw"
OUT = H / "aluguel"
(OUT / "predios").mkdir(parents=True, exist_ok=True)
T0 = time.time()
con = duckdb.connect()
con.execute("SET memory_limit='2GB'; SET threads=2;")

QS = ["≤1", "2", "3", "4+"]
QK = {"≤1": "1", "2": "2", "3": "3", "4+": "4p"}
FA = ["≤35", "35–50", "50–70", "70–100", "100–150", ">150"]
GRUPOS = ["apto", "casa"]


def log(*a):
    print(f"[{time.time() - T0:5.1f}s]", *a, flush=True)


def num(v, d=1):
    """número JSON: NaN/None → None; d casas (0 → int)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return int(round(f)) if d == 0 else round(f, d)


def cdk(cd: str) -> str:
    """código do distrito como no núcleo (R.DIST): '07' → '7'; cidade '00' → 'SP'."""
    return "SP" if cd in ("00", None) else str(int(cd))


def dump(name, obj):
    p = OUT / name
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    p.write_text(s)
    return len(s)


def q(s, p):
    s = pd.Series(s).dropna()
    return float(s.quantile(p)) if len(s) else None


# ── dados do A5 ─────────────────────────────────────────────────────────────
A = pd.read_parquet(ST / "fase2_aluguel_anuncios.parquet")
A = A[A.in_sp].copy()
A["cd"] = A.cd_distrito.map(cdk)
RENT = A[A.business.eq("RENT")]
R_OK = RENT[RENT.preco_ok]
S_OK = A[A.business.eq("SALE") & A.preco_ok]
Y_OK = A[A.yield_ok]
P = pd.read_parquet(ST / "fase2_aluguel_predio.parquet")
T = pd.read_parquet(ST / "fase2_aluguel_distrito.parquet")
COB = pd.read_parquet(ST / "fase2_aluguel_cobertura.parquet")
log("anúncios na capital:", len(A), "aluguel:", len(RENT), "prédios A5:", len(P))

# ── 1. distrito.json ────────────────────────────────────────────────────────
FD = [("n", "aluguel_m2_n", 0), ("p25", "aluguel_m2_p25", 1), ("p50", "aluguel_m2_p50", 1), ("p75", "aluguel_m2_p75", 1),
      ("lo", "aluguel_m2_ic95_lo", 1), ("hi", "aluguel_m2_ic95_hi", 1),
      ("al25", "aluguel_p25", 0), ("al", "aluguel_p50", 0), ("al75", "aluguel_p75", 0),
      ("cmn", "custo_morar_n", 0), ("cm25", "custo_morar_p25", 0), ("cm", "custo_morar_p50", 0), ("cm75", "custo_morar_p75", 0),
      ("cmm2", "custo_morar_m2_p50", 1), ("ic", "iptu_condo_p50", 0), ("peso", "peso_condo_iptu_pct", 1), ("taxa", "taxas_qa_pct", 2),
      ("vn", "venda_m2_n", 0), ("v25", "venda_m2_p25", 0), ("v", "venda_m2_p50", 0), ("v75", "venda_m2_p75", 0),
      ("yn", "yield_unid_n", 0), ("y25", "yield_unid_p25", 2), ("y", "yield_unid_p50", 2), ("y75", "yield_unid_p75", 2),
      ("ylo", "yield_unid_ic95_lo", 2), ("yhi", "yield_unid_ic95_hi", 2), ("yq", "yield_qaqa", 2),
      ("yin", "yield_itbi_n", 0), ("yi25", "yield_itbi_p25", 2), ("yi", "yield_itbi_p50", 2), ("yi75", "yield_itbi_p75", 2),
      ("nb", "n_aluguel_bruto", 0), ("est", "estoque_unid", 0), ("of", "oferta_aluguel_por_mil", 1), ("ofv", "oferta_venda_por_mil", 1)]
Td = T[T.grupo.isin(GRUPOS)].copy()
Td["cd"] = Td.cd_distrito.map(cdk)
dd: dict = {}
for r in Td.itertuples(index=False):
    if not (r.n_aluguel_bruto or 0) and not (r.venda_m2_n or 0):
        continue
    dd.setdefault(r.cd, {})[f"{r.grupo}|{r.dim}|{r.faixa}"] = [num(getattr(r, c), d) for _, c, d in FD]
# oferta por idade do prédio (A5 §2.4): condomínios com ≥ 10 unidades, por década de entrega (ACC)
ACC = ["≤1980", "1981–2000", "2001–2015", "2016–2022", "2023+"]
CA = P[P.n_unid.ge(10) & P.geo_nivel.eq("lote_condominio") & P.f_acc.notna()].copy()
CA["cd"] = CA.cd_distrito.map(cdk)
idade: dict = {}
for cd, g0 in [("SP", CA)] + list(CA.groupby("cd")):
    rows = []
    for fa in ACC:
        g = g0[g0.f_acc.eq(fa)]
        if not len(g):
            continue
        unid, alug, venda = g.n_unid.sum(), g.n_aluguel.sum(), g.n_venda.sum()
        rows.append([fa, int(len(g)), num(unid, 0), num(alug, 0), num(venda, 0), num(1000 * alug / unid, 1),
                     num(1000 * venda / unid, 1), num(g.aluguel_m2_p50.median(), 1), num(g.yield_unid_p50.median(), 2)])
    idade[cd] = rows
n_d = dump("distrito.json", {"f": [k for k, _, _ in FD], "d": dd, "idade": idade,
                             "idade_f": ["acc", "predios", "unid", "n_aluguel", "n_venda", "aluguel_por_mil", "venda_por_mil",
                                         "aluguel_m2_p50", "yield_unid_p50"]})
log("distrito.json", round(n_d / 1e3), "KB ·", len(dd), "áreas (com cidade)")

# ── 2. hexágonos (MESMO esquema do A5_02: ~500 m de raio, projeção local equirretangular) ──────
LAT0, LON0 = -23.55, -46.63
KX, KY = 111_320 * np.cos(np.radians(LAT0)), 110_574
SIZE = 500.0


def hex_of(lat, lon):
    x = (np.asarray(lon) - LON0) * KX
    y = (np.asarray(lat) - LAT0) * KY
    qf = (np.sqrt(3) / 3 * x - y / 3) / SIZE
    rf = (2 / 3 * y) / SIZE
    xs, zs = qf, rf
    ys = -xs - zs
    rx, ry, rz = np.round(xs), np.round(ys), np.round(zs)
    dx, dy, dz = np.abs(rx - xs), np.abs(ry - ys), np.abs(rz - zs)
    c1 = (dx > dy) & (dx > dz)
    c2 = ~c1 & (dy > dz)
    rx = np.where(c1, -ry - rz, rx)
    rz = np.where(~c1 & ~c2, -rx - ry, rz)
    return rx.astype(int), rz.astype(int)


A["hq"], A["hr"] = hex_of(A.lat.values, A.lon.values)
A["hex_id"] = A.hq.astype(str) + "_" + A.hr.astype(str)
HX5 = pd.read_parquet(ST / "fase2_aluguel_hex.parquet")
chk = set(A.loc[A.business.eq("RENT"), "hex_id"]) - set(HX5.hex_id)
assert not chk, f"hexágonos fora do esquema do A5: {list(chk)[:5]}"

# estoque residencial do IPTU 2026 por hexágono (oferta por 1.000 unid.): SQL → lote → centróide (quadra se faltar)
con.execute(f"""create table ip as
  select case when condominio <> '00-0' then substr(sql,1,6)||'0000'||substr(condominio,1,2) else substr(sql,1,10)||'00' end lot_id,
         substr(sql,1,3) setor, substr(sql,4,3) quadra,
         case when uso ilike 'Apartamento%' or uso ilike 'Flat residencial%' or uso ilike 'Prédio de apartamento%' then 'apto'
              when uso ilike 'Residência%' or uso = 'Cortiço' then 'casa' end grupo,
         referencia, logradouro, numero
  from '{RAW}/iptu/iptu_2026_slim.parquet'""")
con.execute(f"""create table ctr as select setor||quadra||lote||condominio lot_id,
                  arg_min(plon, case tp_lote when 'F' then 0 else 1 end) lon, arg_min(plat, case tp_lote when 'F' then 0 else 1 end) lat
                from '{ST}/lotes_centroides.parquet' group by 1""")
con.execute(f"""create table cq as select setor, quadra, avg(plon) lon, avg(plat) lat from '{ST}/lotes_centroides.parquet' group by 1, 2""")
EST = con.execute("""select coalesce(c.lon, q.lon) lon, coalesce(c.lat, q.lat) lat, i.grupo, count(*) n
  from ip i left join ctr c using (lot_id) left join cq q on q.setor = i.setor and q.quadra = i.quadra
  where i.grupo is not null group by 1, 2, 3""").df()
EST = EST[EST.lon.notna()]
EST["hq"], EST["hr"] = hex_of(EST.lat.values, EST.lon.values)
EST["hex_id"] = EST.hq.astype(str) + "_" + EST.hr.astype(str)
estx = EST.groupby(["hex_id", "grupo"]).n.sum().unstack(fill_value=0)
log("estoque IPTU por hexágono:", int(estx.values.sum()), "unidades em", len(estx), "hexágonos")


def cell_table(key):
    """células por `key` (hexágono ou prédio) × grupo|dim|faixa → [n, p25, p50, p75, aluguel, custo, yu_n, yu_p50,
    venda_n, venda_m2, n_bruto] (n = anúncios no preço; n_bruto = todos, inclusive fora do preço). Vetorizado."""
    out: dict = {}
    ra, ya, sa = RA[RA.grupo.isin(GRUPOS)], YA[YA.grupo.isin(GRUPOS)], SA[SA.grupo.isin(GRUPOS)]
    ok = ra[ra.preco_ok]
    for dim, col in [("todos", None), ("quartos", "f_quartos"), ("area_util", "f_area_util")]:
        gk = [key, "grupo"] + ([col] if col else [])
        g = ok.groupby(gk)
        gy, gs = ya.groupby(gk).yield_unid, sa.groupby(gk).sale_m2
        t = pd.DataFrame({"nb": ra.groupby(gk).size()}).join(pd.DataFrame({
            "n": g.size(), "p25": g.rent_m2.quantile(.25), "p50": g.rent_m2.median(), "p75": g.rent_m2.quantile(.75),
            "al": g.rent.median(), "cm": g.custo_morar.median()}), how="left").join(
            pd.DataFrame({"yn": gy.size(), "y": gy.median()}), how="left").join(
            pd.DataFrame({"vn": gs.size(), "v": gs.median()}), how="left")
        for ix, r in zip(t.index, t.itertuples(index=False)):
            fx = ix[2] if col else "todos"
            out.setdefault(ix[0], {})[f"{ix[1]}|{dim}|{fx}"] = [
                num(r.n, 0) or 0, num(r.p25, 1), num(r.p50, 1), num(r.p75, 1), num(r.al, 0), num(r.cm, 0),
                num(r.yn, 0) or 0, num(r.y, 2), num(r.vn, 0) or 0, num(r.v, 0), int(r.nb)]
    return out


hexes = []
RA = A[A.business.eq("RENT")]
YA, SA = A[A.yield_ok], A[A.business.eq("SALE") & A.preco_ok]
HC = cell_table("hex_id")
for hid, r in RA.groupby("hex_id"):
    hq_, hr_ = map(int, hid.split("_"))
    e = estx.loc[hid] if hid in estx.index else None
    hexes.append({"h": [hq_, hr_], "cd": r.cd.mode().iat[0], "nb": int(len(r)), "np": int(r.predio_key.nunique()),
                  "e": [int(e.get("apto", 0)) if e is not None else 0, int(e.get("casa", 0)) if e is not None else 0],
                  "c": HC.get(hid, {})})
n_h = dump("hex.json", {"f": ["n", "p25", "p50", "p75", "al", "cm", "yn", "y", "vn", "v", "nb"], "hex": hexes})
log("hex.json", round(n_h / 1e3), "KB ·", len(hexes), "hexágonos com aluguel ·", sum(h["nb"] >= 10 for h in hexes), "com n ≥ 10")

# ── 3. prédios por distrito ─────────────────────────────────────────────────
# lotes com venda ITBI (dist/{cd}.json): id + ponto; o prédio cujo lote está lá abre a página do Prédio
rx = re.compile(r'"id":"(\d{12})","c":\[(-?[\d.]+),(-?[\d.]+)\]')
LOTC: dict = {}
for f in sorted((H / "dist").glob("*.json")):
    for m in rx.finditer(f.read_text()):
        LOTC[m.group(1)] = (f.stem, float(m.group(2)), float(m.group(3)))
log("lotes em dist/:", len(LOTC))

PR = P[P.n_aluguel.gt(0)].copy()
PR["cd"] = PR.cd_distrito.map(cdk)
# nome e endereço do lote (IPTU 2026): referência + logradouro + número mais frequentes
con.register("plots", PR[PR.lot_id.notna()][["lot_id"]].drop_duplicates())
NM = con.execute("""select lot_id, mode(referencia) nm, mode(logradouro) lg, mode(numero) nr
                    from ip semi join plots using (lot_id) group by 1""").df().set_index("lot_id")
viz = A[A.business.eq("RENT")].groupby("predio_key").neighbourhood.agg(lambda s: s.mode().iat[0] if s.notna().any() else None)

# células do prédio para a cor do mapa (grupo × todos/quartos/área útil) e tabela por quartos da seção do Prédio
PC = cell_table("predio_key")


def qtable():
    """por prédio × quartos (todos os grupos, como o A5; '*' = todos os quartos):
    [nb, n, aluguel, R$/m², área útil, custo de morar, n venda, venda, venda R$/m², yield unid., n yield]."""
    out: dict = {}
    ok = RA[RA.preco_ok]
    for col in [None, "f_quartos"]:
        gk = ["predio_key"] + ([col] if col else [])
        g, gs, gy = ok.groupby(gk), SA.groupby(gk), YA.groupby(gk).yield_unid
        t = pd.DataFrame({"nb": RA.groupby(gk).size()}).join(pd.DataFrame({
            "n": g.size(), "al": g.rent.median(), "am": g.rent_m2.median(), "au": g.area.median(), "cm": g.custo_morar.median()}),
            how="outer").join(pd.DataFrame({"nv": gs.size(), "vv": gs.sale_price.median(), "vm": gs.sale_m2.median()}),
            how="outer").join(pd.DataFrame({"yn": gy.size(), "y": gy.median()}), how="left")
        for ix, r in zip(t.index, t.itertuples(index=False)):
            k, fx = (ix[0], ix[1]) if col else (ix, "*")
            out.setdefault(k, {})[fx] = [num(r.nb, 0) or 0, num(r.n, 0) or 0, num(r.al, 0), num(r.am, 1), num(r.au, 0),
                                         num(r.cm, 0), num(r.nv, 0) or 0, num(r.vv, 0), num(r.vm, 0), num(r.y, 2), num(r.yn, 0) or 0]
    return out


PQ = qtable()
log("células de prédio:", len(PC), "· tabelas por quartos:", len(PQ))


def tb(v):
    return v is True or (isinstance(v, np.bool_) and bool(v))


SUMF = [("am25", "aluguel_m2_p25", 1), ("am", "aluguel_m2_p50", 1), ("am75", "aluguel_m2_p75", 1), ("al", "aluguel_p50", 0),
        ("cm", "custo_morar_p50", 0), ("ic", "iptu_condo_p50", 0), ("au", "area_util_aluguel_p50", 0),
        ("vm", "venda_m2_p50", 0), ("vv", "venda_p50", 0), ("y25", "yield_unid_p25", 2), ("y", "yield_unid_p50", 2),
        ("y75", "yield_unid_p75", 2), ("yn", "yield_unid_n", 0), ("yq", "yield_qaqa", 2),
        ("nu", "n_unid", 0), ("na", "n_apto", 0), ("pav", "pav", 0), ("acc", "acc", 0),
        ("of", "oferta_aluguel_por_mil", 1), ("ofv", "oferta_venda_por_mil", 1), ("rz", "razao_constr_util", 2),
        ("in", "itbi_n", 0), ("iv", "itbi_valor_p50", 0), ("irc", "itbi_rsm2_constr_p50", 0), ("iru", "itbi_rsm2_util_p50", 0),
        ("yiu", "yield_itbi_unid", 2), ("yi", "yield_itbi", 2), ("sp", "spread_pedido_fechado", 1),
        ("pv", "premio_vizinhanca_pct", 1), ("nv5", "n_viz_500m", 0)]
ITQ = {fx: (f"q{QK[fx]}_yield_itbi", f"q{QK[fx]}_itbi_n", f"q{QK[fx]}_itbi_valor") for fx in QS}
n_tot, n_lot, n_in = 0, 0, 0
tam = []
for cd, g in PR.groupby("cd"):
    rows = []
    for r in g.itertuples(index=False):
        k = r.predio_key
        lot = r.lot_id if isinstance(r.lot_id, str) else None
        ind = lot is not None and lot in LOTC
        if ind:
            c = [LOTC[lot][1], LOTC[lot][2]]
        elif lot is not None and pd.notna(r.lot_lon):
            c = [round(float(r.lot_lon), 6), round(float(r.lot_lat), 6)]
        else:
            c = [round(float(r.lon), 6), round(float(r.lat), 6)]
        nm = NM.loc[lot] if lot is not None and lot in NM.index else None
        end = None
        if nm is not None and isinstance(nm.lg, str):
            end = (nm.lg + " " + str(nm.nr or "").lstrip("0")).strip()
        s = {kk: num(getattr(r, col), d) for kk, col, d in SUMF}
        s = {kk: v for kk, v in s.items() if v is not None}
        qr = {fx: list(v) for fx, v in PQ.get(k, {}).items()}
        for fx, (cy, cn, cv) in ITQ.items():
            yi, ni, vi = num(getattr(r, cy), 2), num(getattr(r, cn), 0), num(getattr(r, cv), 0)
            if ni:
                qr.setdefault(fx, [0, 0, None, None, None, None, 0, None, None, None, 0])
                qr[fx] = qr[fx][:11] + [yi, ni, vi]
        row = {"k": k, "c": c, "g": {"lote_condominio": "c", "lote_simples": "s"}.get(r.geo_nivel, "p"),
               "nb": int(r.n_aluguel), "nv": int(r.n_venda), "gr": r.grupo_pred,
               "s": s, "q": qr, "m": {ck: v[:8] for ck, v in PC.get(k, {}).items()}}
        if lot:
            row["lot"] = lot
        if ind:
            row["d"] = LOTC[lot][0]
        if nm is not None and isinstance(nm.nm, str) and nm.nm.strip():
            row["nm"] = nm.nm.strip()
        if end:
            row["end"] = end
        if lot is None and isinstance(viz.get(k), str):
            row["bairro"] = viz.get(k)
        if isinstance(r.padrao, str):
            row["pad"] = r.padrao
        if tb(r.tipologia_unica):
            row["tu"] = 1
        if tb(r.flag_oferta_concentrada):
            row["conc"] = 1
        if tb(r.razao_ok):
            row["rzok"] = 1
        if isinstance(r.yield_itbi_metodo, str):
            row["yim"] = r.yield_itbi_metodo
        if isinstance(r.f_acc, str):
            row["facc"] = r.f_acc
        rows.append(row)
        n_tot += 1
        n_lot += lot is not None
        n_in += ind
    tam.append(dump(f"predios/{cd}.json", {"cd": cd, "f": ["n", "p25", "p50", "p75", "al", "cm", "yn", "y"],
                                           "fq": ["nb", "n", "al", "am", "au", "cm", "nv", "vv", "vm", "y", "yn", "yi", "in", "iv"],
                                           "p": rows}))
log(f"predios/: {n_tot} prédios com aluguel ({n_lot} em lote, {n_in} com página de Prédio) em {len(tam)} arquivos;"
    f" maior {round(max(tam) / 1e3)} KB, total {round(sum(tam) / 1e6, 1)} MB")

# ── 4. curta.json (Inside Airbnb, 14/06/2026, CC BY 4.0) ──────────────────────
C = pd.read_parquet(ST / "fase2_aluguel_curta.parquet")
C = C[C.in_sp].copy()
C["cd"] = C.cd_distrito.map(cdk)
C["hq"], C["hr"] = hex_of(C.latitude.values, C.longitude.values)
C["hex_id"] = C.hq.astype(str) + "_" + C.hr.astype(str)
OKc = C[C.preco_ok & C.inteiro & C.modalidade.eq("curta")]
# aluguel longo (QA) de apto ≤1 quarto, mesmo hexágono: base de "noites para empatar" (a tipologia dominante do Airbnb)
qa1 = R_OK[R_OK.grupo.eq("apto") & R_OK.f_quartos.eq("≤1")].copy()
qa1["hq"], qa1["hr"] = hex_of(qa1.lat.values, qa1.lon.values)
qa1["hex_id"] = qa1.hq.astype(str) + "_" + qa1.hr.astype(str)
qa1h = qa1.groupby("hex_id").rent.agg(["size", "median"])
qall = RA.groupby("hex_id").size()
ch = []
for hid, g in C.groupby("hex_id"):
    ok = OKc[OKc.hex_id.eq(hid)]
    ok1 = ok[ok.f_quartos.eq("≤1")]
    nq = int(qall.get(hid, 0))
    d1 = q(ok1.preco_noite, .5) if len(ok1) >= 10 else None
    a1n, a1 = (int(qa1h.at[hid, "size"]), float(qa1h.at[hid, "median"])) if hid in qa1h.index else (0, None)
    hq_, hr_ = map(int, hid.split("_"))
    ch.append({"h": [hq_, hr_], "n": int(len(g)), "at": int(g.ativo_12m.sum()), "mu": num(100 * g.operador_multi.mean(), 0),
               "ni": int(len(ok)), "di": num(q(ok.preco_noite, .5), 0), "oc": num(q(ok.estimated_occupancy_l365d, .5), 0),
               "rm": num(q(ok.receita_mes_est, .5), 0), "nq": nq,
               "rz": num(len(g) / nq, 2) if nq >= 10 else None,
               "n1": int(len(ok1)), "d1": num(d1, 0), "a1n": a1n, "a1": num(a1, 0),
               "ne": num(a1 / d1, 1) if d1 and a1 and a1n >= 10 else None})
CV = pd.read_parquet(ST / "fase2_aluguel_curta_vs_longa.parquet")
CV["cd"] = CV.cd_distrito.map(cdk)
CV["noites"] = CV.aluguel_p50 / CV.diaria
cobd = COB[COB.nivel.eq("distrito")].copy()
cobd["cd"] = cobd.cd_distrito.map(cdk)
cobd = cobd.set_index("cd")
cdist = {}
for cd, g in C.groupby("cd"):
    ok = OKc[OKc.cd.eq(cd)]
    est = cobd.at[cd, "estoque_todos"] if cd in cobd.index else None
    nq = cobd.at[cd, "n_aluguel"] if cd in cobd.index else None
    cv = CV[CV.cd.eq(cd)]
    cdist[cd] = {"n": int(len(g)), "at": int(g.ativo_12m.sum()), "mu": num(100 * g.operador_multi.mean(), 0),
                 "ni": int(len(ok)), "di": num(q(ok.preco_noite, .5), 0), "d25": num(q(ok.preco_noite, .25), 0),
                 "d75": num(q(ok.preco_noite, .75), 0), "oc": num(q(ok.estimated_occupancy_l365d, .5), 0),
                 "rm": num(q(ok.receita_mes_est, .5), 0), "pm": num(1000 * len(g) / est, 1) if est else None,
                 "rz": num(len(g) / nq, 2) if nq else None, "bi": num(100 * g.borda_incerta.mean(), 0),
                 "q": {r.f_quartos: [int(r.n), num(r.diaria, 0), num(r.receita_mes, 0), num(r.ocup, 0), num(r.aluguel_p50, 0),
                                     num(r.curta_sobre_longa, 2), num(r.noites, 1)] for r in cv.itertuples(index=False)}}
city = {"n": int(len(C)), "at": int(C.ativo_12m.sum()), "mu": num(100 * C.operador_multi.mean(), 0), "ni": int(len(OKc)),
        "di": num(q(OKc.preco_noite, .5), 0), "d25": num(q(OKc.preco_noite, .25), 0), "d75": num(q(OKc.preco_noite, .75), 0),
        "oc": num(q(OKc.estimated_occupancy_l365d, .5), 0), "rm": num(q(OKc.receita_mes_est, .5), 0),
        "ne": [num(q(CV.noites, .25), 1), num(q(CV.noites, .5), 1), num(q(CV.noites, .75), 1)],
        "csl": [num(q(CV.curta_sobre_longa, .25), 2), num(q(CV.curta_sobre_longa, .5), 2), num(q(CV.curta_sobre_longa, .75), 2)],
        "celulas": int(len(CV)), "bi": num(100 * C.borda_incerta.mean(), 1), "min30": int(C.modalidade.str.startswith("média").sum())}
n_c = dump("curta.json", {"snapshot": str(C.snapshot.iat[0]), "hex": ch, "dist": cdist, "city": city,
                          "fq": ["n", "diaria", "receita_mes", "ocup", "aluguel_p50", "receita_sobre_aluguel", "noites_empate"]})
log("curta.json", round(n_c / 1e3), "KB ·", len(ch), "hexágonos,", sum(1 for h in ch if h["n"] >= 10), "com n ≥ 10;",
    sum(1 for h in ch if h["ne"]), "com noites para empatar (≤1 quarto)")

# ── 5. fipezap.json (série da cidade) ─────────────────────────────────────────
FZ = pd.read_parquet(ST / "fase2_aluguel_fipezap_sp.parquet")
want = {("Locação", "Preço médio (R$/m²)"): "loc", ("Venda", "Preço médio (R$/m²)"): "ven",
        ("Rentabilidade", "Rentabilidade anualizada (% a.a., ×12)"): "rent",
        ("Locação", "Var. em 12 meses (%)"): "loc12", ("Venda", "Var. em 12 meses (%)"): "ven12"}
FZ = FZ[[(n, m) in want for n, m in zip(FZ.negocio, FZ.medida)]].copy()
FZ["k"] = [want[(n, m)] + "_" + e.replace("Total", "T") for n, m, e in zip(FZ.negocio, FZ.medida, FZ.estrato)]
pv = FZ.pivot_table(index="data", columns="k", values="valor").sort_index()
fz = {"t": [d.strftime("%Y-%m") for d in pv.index],
      "s": {k: [num(v, 2) for v in pv[k].tolist()] for k in pv.columns}}
n_f = dump("fipezap.json", fz)
log("fipezap.json", round(n_f / 1e3), "KB ·", len(fz["t"]), "meses", fz["t"][0], "→", fz["t"][-1])

# ── 6. meta.json ──────────────────────────────────────────────────────────────
cob = {r.cd: [num(r.estoque_todos, 0), num(r.n_aluguel, 0), num(r.n_venda, 0), num(r.aluguel_por_mil, 1),
              num(r.venda_por_mil, 1), num(r.repr_aluguel, 2)] for r in cobd.reset_index().itertuples(index=False)}
pad = [[r.padrao, num(r.estoque_apto, 0), num(r.n_aluguel, 0), num(r.n_venda, 0), num(r.aluguel_por_mil, 1), num(r.venda_por_mil, 1)]
       for r in COB[COB.nivel.eq("padrao_vertical")].itertuples(index=False)]
yb = P[P.yield_itbi_unid.notna() & P.yield_unid_p50.notna()]
meta = {
    "built": time.strftime("%Y-%m-%d %H:%M"),
    "qa": {"foto": "2026-06-20", "fonte": "QuintoAndar", "base": "preço pedido · área útil do anúncio",
           "uso": "base congelada, só agregados (distrito, hexágono, prédio com n); nunca um ponto por anúncio (P-A5-14)",
           "n_sp": int(len(A)), "n_aluguel": int(len(RENT)), "n_aluguel_preco": int(len(R_OK)),
           "n_venda": int((A.business == "SALE").sum()), "n_yield_unid": int(len(Y_OK)),
           "n_predios_aluguel": int(len(PR)), "n_predios_lote": int(PR.lot_id.notna().sum()), "n_predios_pagina": int(n_in),
           "n_hex": len(hexes), "n_hex_10": int(sum(h["nb"] >= 10 for h in hexes))},
    "airbnb": {"snapshot": str(C.snapshot.iat[0]), "fonte": "Inside Airbnb (insideairbnb.com)", "licenca": "CC BY 4.0",
               "nota": "coordenada deslocada até ~150 m pela Airbnb: só hexágono/distrito; receita estimada é piso"},
    "fipezap": {"fonte": "FipeZAP (Fipe)", "arquivo": "fipezap-serieshistoricas (atualizado 21/09/2026)", "ate": fz["t"][-1]},
    "itbi": {"janela": "jan/2025 a ago/2026", "mediana_fechamento": "15/10/2025",
             "razao_itbi_unid": num((yb.yield_itbi_unid / yb.yield_unid_p50).median(), 2), "predios_razao": int(len(yb))},
    "hex": {"lat0": LAT0, "lon0": LON0, "kx": float(KX), "ky": float(KY), "size": SIZE},
    "faixas": {"quartos": QS, "area_util": FA, "acc": ACC},
    "cob_f": ["estoque", "n_aluguel", "n_venda", "aluguel_por_mil", "venda_por_mil", "repr_aluguel"], "cob": cob,
    "pad_f": ["padrao", "estoque_apto", "n_aluguel", "n_venda", "aluguel_por_mil", "venda_por_mil"], "pad": pad,
}
dump("meta.json", meta)
log("meta.json ok ·", len(cob), "distritos com cobertura")
