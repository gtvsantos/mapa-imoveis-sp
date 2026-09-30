#!/usr/bin/env python3
"""Contexto urbano do Radar ITBI → proto/contexto/ (dados do módulo src/m_contexto.js).

Lê SÓ o que o A4 já preparou (somente leitura): ../research/stage/fase2_*.parquet e o bruto em cache em
../raw/{geosampa/wfs,ssp}. Nada de banco, nada de rede, nenhuma geocodificação: toda coordenada é a nativa
da fonte (GeoSampa, CNES, OSM, SSP) ou o ponto interior do lote fiscal.

    python3.12 build_contexto.py          # tudo (≈ 2–3 min; duckdb 2 GB / 2 threads)

Saídas (contexto/), cada arquivo carregado de uma vez ≤ ~1,5 MB SEM gzip (o serve.py só comprime dist/):
  meta.json          fontes, datas, licenças, categorias, zonas (Quadro 3), contexto por distrito, bbox dos arquivos
  transporte.json    estações (existente · em obra [lista manual P-A4-4, a validar] · planejada), linhas,
                     terminais e corredores de ônibus
  zon/eixos.json     eixos (ZEU/ZEM e previstos ZEUP/ZEMP) da cidade inteira — zoom ≥ 11
  zon/{cd}.json      demais zonas do distrito (ponto interior no distrito) — zoom ≥ 13; Praça/canteiro fica fora
  poi/{cd}.json      equipamentos e serviços (só os que entram em contagem: sem duplicata OSM×oficial, sem parque
                     proposto); os de fora do município a ≤ 2 km da divisa vão para o distrito mais próximo
  parques.json       parques existentes (polígono): a distância é até a borda
  comercial.json     corredores, faces e polos comerciais (IPTU 2026; A4 §6)
  riscos.json        setores de risco geológico e hidrológico (GeoSampa)
  inund/{cd}.json    mancha de inundação TR 25 anos (GeoSampa), agregada em células de 20 m
  dens_roubos.json   hexágonos de ~500 m: roubos registrados em 2025 por km² (SSP; BO único)
  dens_varejo.json   hexágonos de ~500 m: m² construídos de varejo (IPTU 2026) por hectare
  lote/{cd}.json     por lote com venda (id = setor3+quadra3+lote4+condomínio2, o mesmo de dist/{cd}.json):
                     estação existente/em obra/planejada mais próxima, zona e parâmetros, riscos, roubos e furtos
                     a 500 m, IDEB máx. a 1 km, varejo a 500 m, região comercial; quantis do distrito por categoria
                     (para "mais perto que X% dos prédios do distrito") e o POI mais próximo quando passa de 1,5 km
Contagens a 500 m/1 km e os pontos da régua saem no navegador de poi/{cd}.json (a mesma base que o mapa desenha).
"""
from __future__ import annotations

import gzip
import json
import math
import time
import unicodedata
from datetime import date
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import shapely
from shapely.geometry import shape
from shapely.ops import substring
from sklearn.neighbors import KDTree

H = Path(__file__).resolve().parent
ITBI = H.parent
ST = ITBI / "research" / "stage"
WFS = ITBI / "raw" / "geosampa" / "wfs"
SSP = ITBI / "raw" / "ssp" / "ssp_2025_capital.parquet"
OUT = H / "contexto"
LAT0 = -23.6
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110574.0
R_CLI = 1500          # raio da régua (m): o navegador calcula tudo até aqui a partir de poi/{cd}.json
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:5.0f}s]", *a, flush=True)


def xy(lon, lat):
    return np.column_stack([(np.asarray(lon, float) + 46.6) * KX, (np.asarray(lat, float) - LAT0) * KY])


def to_metric(g):
    return shapely.transform(g, lambda c: np.column_stack([(c[:, 0] + 46.6) * KX, (c[:, 1] - LAT0) * KY]))


def load_wfs(layer):
    return json.loads(gzip.decompress((WFS / f"{layer}.geojson.gz").read_bytes()))["features"]


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().upper()
    return " ".join(s.replace("-", " ").split())


def titulo(s):
    """NOME EM CAIXA ALTA → Nome em Caixa Alta (preposições minúsculas); nomes já mistos ficam como vieram."""
    if not s:
        return ""
    s = str(s).strip()
    if s != s.upper():
        return s
    small = {"DE", "DA", "DO", "DAS", "DOS", "E", "EM", "NA", "NO"}
    keep = {"EE", "EMEF", "EMEFM", "CEU", "UBS", "AMA", "PA", "PS", "AME", "USP", "PUC", "SESC", "SENAI", "FAAP",
            "CEI", "EMEI", "CR", "CRP", "II", "III", "IV", "DP", "BPM/M", "GCM", "SP", "FATEC", "ETEC", "CNES", "UPA"}
    out = []
    for i, w in enumerate(s.split()):
        out.append(w if w in keep else w.lower() if (w in small and i) else w.capitalize())
    return " ".join(out)


TIPO_LOG = {"R": "R.", "AV": "Av.", "AL": "Al.", "PC": "Pç.", "PCA": "Pç.", "TV": "Tv.", "EST": "Estr.", "ESTR": "Estr.",
            "LGO": "Lgo.", "LG": "Lgo.", "VD": "Vd.", "PTE": "Pte.", "ROD": "Rod.", "VL": "Vl.", "PQ": "Pq.", "R.": "R."}


def logradouro(s):
    """'R  DOS PINHEIROS 800–1079' → 'R. dos Pinheiros 800–1079'"""
    ws = str(s or "").split()
    if not ws:
        return ""
    small = {"DE", "DA", "DO", "DAS", "DOS", "E", "EM", "NA", "NO", "A", "O"}
    out = [TIPO_LOG.get(ws[0].upper(), ws[0].capitalize())]
    for w in ws[1:]:
        u = w.upper()
        out.append(w if any(ch.isdigit() for ch in w) else u.lower() if u in small else w.capitalize())
    return " ".join(out)


def jdump(obj, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(txt)
    return len(txt)


def ring_enc(coords, sc=1e5):
    """anel → [x0, y0, dx1, dy1, …] inteiros a 1e-5 grau (~1 m), sem repetir o ponto de fechamento"""
    a = np.round(np.asarray(coords)[:-1] * sc).astype(np.int64)
    if len(a) < 3:
        return None
    d = np.vstack([a[:1], np.diff(a, axis=0)])
    keep = np.ones(len(d), bool)
    keep[1:] = np.any(d[1:] != 0, axis=1)    # vértices que colapsaram na quantização
    if keep.sum() < 3:
        return None
    a = a[keep]
    d = np.vstack([a[:1], np.diff(a, axis=0)])
    return d.ravel().tolist()


def poly_enc(g):
    """Polygon/MultiPolygon → [[anel externo, buracos…], …] (cada anel codificado com ring_enc)"""
    out = []
    for p in (g.geoms if g.geom_type == "MultiPolygon" else [g] if g.geom_type == "Polygon" else []):
        rs = [ring_enc(p.exterior.coords)] + [ring_enc(r.coords) for r in p.interiors]
        if rs[0] is None:
            continue
        out.append([r for r in rs if r is not None])
    return out


def only_polys(g):
    if g is None or g.is_empty:
        return None
    t = g.geom_type
    if t in ("Polygon", "MultiPolygon"):
        return g
    parts = [p for p in shapely.get_parts(g) if p.geom_type in ("Polygon", "MultiPolygon")]
    return shapely.union_all(parts) if parts else None


def num(v, nd=0):
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return None
    return round(float(v), nd) if nd else int(round(float(v)))


# ── distritos (mesmos códigos do núcleo: '1'…'96') ─────────────────────────────────────────────
def distritos():
    t = pq.read_table(ST / "fase2_distritos_ref.parquet")
    d = t.drop(["geometry"]).to_pandas()
    d["cd"] = d["cd"].astype(str).str.lstrip("0")
    g = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    core = json.loads((H / "data.json").read_text())["geo"]["distritos"]["features"]
    nomes = {f["properties"]["cd"]: f["properties"]["nome"] for f in core}
    d["nome_core"] = d["cd"].map(nomes)
    return d, g


def assign_district(lon, lat, dcd, dgeo, gm_union_m, max_out_m=2000.0):
    """cd do distrito que contém o ponto; fora do município: o distrito mais próximo se a ≤ max_out_m da divisa"""
    pts = shapely.points(np.asarray(lon, float), np.asarray(lat, float))
    tree = shapely.STRtree(dgeo)
    pi, gi = tree.query(pts, predicate="within")
    out = np.full(len(pts), None, dtype=object)
    out[pi] = dcd[gi]
    miss = np.nonzero(pd.isna(out))[0]
    if len(miss):
        pm = shapely.points(xy(np.asarray(lon)[miss], np.asarray(lat)[miss]))
        tm = shapely.STRtree(to_metric(dgeo))
        idx, dist = tm.query_nearest(pm, return_distance=True, all_matches=False)
        ok = dist <= max_out_m
        out[miss[idx[0][ok]]] = dcd[idx[1][ok]]
    return out


# ── categorias (uma fonte de verdade: o navegador lê de meta.json) ────────────────────────────
# chave, rótulo, grupo, subcategorias de fase2_poi, sub-camada do mapa, glifo; fontes: GS GeoSampa · CNES · OSM
CATS = [
    ("esc_pub", "Escola pública", "Educação", ["escola_estadual", "escola_municipal_ef", "escola_municipal_efm", "ceu"], "escola", "E"),
    ("esc_priv", "Escola particular", "Educação", ["escola_privada"], "escola", "E"),
    ("infantil", "Creche e educação infantil", "Educação", ["educacao_infantil_publica", "educacao_infantil_osm"], "infantil", "C"),
    ("univ", "Universidade e faculdade", "Educação", ["universidade", "faculdade_tecnica"], "univ", "U"),
    ("ubs", "UBS, AMA e pronto-atendimento", "Saúde", ["ubs", "pronto_atendimento", "pronto_atendimento_cnes", "ambulatorio_especialidades"], "saude", "+"),
    ("hosp", "Hospital", "Saúde", ["hospital_publico", "hospital_privado", "hospital_cnes", "hospital_dia_cnes", "hospital_osm"], "saude", "H"),
    ("farm", "Farmácia", "Saúde", ["farmacia"], "comercio", "Fa"),
    ("super", "Supermercado", "Abastecimento e consumo", ["supermercado", "atacarejo"], "abast", "S"),
    ("feira", "Feira livre, mercado e sacolão", "Abastecimento e consumo", ["feira_livre", "mercado_municipal", "sacolao", "mercado_feira_osm"], "abast", "F"),
    ("alim", "Restaurante, bar, café e padaria", "Abastecimento e consumo", ["restaurante", "lanchonete", "bar", "cafe", "padaria", "sorveteria", "praca_alimentacao"], "alim", "R"),
    ("shop", "Shopping center", "Abastecimento e consumo", ["shopping"], "comercio", "Sh"),
    ("acad", "Academia", "Lazer e cultura", ["academia"], "esporte", "A"),
    ("parque", "Parque", "Lazer e cultura", [], "parque", "P"),
    ("praca", "Praça", "Lazer e cultura", ["praca"], "parque", "p"),
    ("esporte", "Clube e centro esportivo", "Lazer e cultura", ["clube", "clube_comunidade", "centro_esportivo_publico", "centro_esportivo", "estadio"], "esporte", "Cl"),
    ("cult", "Cultura: biblioteca, museu, teatro, cinema", "Lazer e cultura", ["biblioteca", "museu", "teatro", "cinema", "centro_cultural", "cultura_outros"], "cult", "Cu"),
    ("dp", "Delegacia (Polícia Civil)", "Segurança e serviço público", ["delegacia"], "seg", "D"),
    ("pol", "PM, GCM e bombeiros", "Segurança e serviço público", ["policia_militar", "gcm", "bombeiros", "policia_osm"], "seg", "PM"),
    ("pub", "Prédio público: subprefeitura, Descomplica, fórum, Correios", "Segurança e serviço público", ["subprefeitura", "descomplica", "defesa_civil", "forum", "correios", "predio_publico"], "pub", "Pb"),
    ("templo", "Templo e igreja", "Outros (tom neutro)", ["templo"], "templo", "T"),
    ("cemit", "Cemitério", "Outros (tom neutro)", ["cemiterio"], "cemit", "†"),
]
SUBS = [  # sub-camadas do mapa (ícones no zoom ≥ 16): as 7 primeiras formam o subconjunto decisivo (A4 §7)
    ("escola", "Escolas (IDEB 2023)", True), ("saude", "UBS, AMA e hospitais", True), ("abast", "Supermercado e feira", True),
    ("parque", "Parques e praças", True), ("seg", "Delegacia, PM, GCM, bombeiros", True), ("pub", "Prédios públicos", True),
    ("cemit", "Cemitérios (neutro)", True), ("infantil", "Creches", False), ("univ", "Universidades", False),
    ("alim", "Restaurantes, bares, cafés (OSM)", False), ("comercio", "Shopping e farmácia", False),
    ("esporte", "Academias e clubes", False), ("cult", "Cultura", False), ("templo", "Templos e igrejas (OSM)", False),
]
FONTES_POI = {"geosampa": 0, "cnes": 1, "osm": 2}
REDE = {"escola_estadual": "estadual (EE)", "escola_municipal_ef": "municipal (EMEF)", "escola_municipal_efm": "municipal (EMEFM)",
        "ceu": "municipal (CEU)", "escola_privada": "particular"}
DIA = {"DOMINGO": "domingo", "SEGUNDA-FEIRA": "segunda", "TERCA-FEIRA": "terça", "TERÇA-FEIRA": "terça", "QUARTA-FEIRA": "quarta",
       "QUINTA-FEIRA": "quinta", "SEXTA-FEIRA": "sexta", "SABADO": "sábado", "SÁBADO": "sábado"}


def fmt_n(v):
    return f"{v:,.0f}".replace(",", ".")


def poi_attr(r, leitos):
    """atributo curto (texto) e selo do mapa por POI"""
    s, a = r.subcategoria, {}
    if r.atributos:
        try:
            a = json.loads(r.atributos)
        except ValueError:
            a = {}
    parts, badge = [], ""
    if s in REDE:
        parts.append("rede " + REDE[s])
        ides = [(k, getattr(r, f"ideb_{k}_2023")) for k in ("ai", "af", "em")]
        ides = [(k, v) for k, v in ides if v is not None and math.isfinite(v)]
        if ides:
            lb = {"ai": "anos iniciais", "af": "anos finais", "em": "médio"}
            parts.append("IDEB 2023: " + " · ".join(f"{lb[k]} {v:.1f}".replace(".", ",") for k, v in ides))
            badge = f"{ides[0][1]:.1f}".replace(".", ",")
    elif s in ("hospital_cnes", "hospital_dia_cnes", "pronto_atendimento_cnes"):
        if a.get("tipo_unidade"):
            parts.append(a["tipo_unidade"].capitalize())
        if a.get("leitos_existentes"):
            parts.append(f"{a['leitos_existentes']} leitos ({a.get('leitos_sus') or 0} SUS)")
    elif s in ("hospital_publico", "hospital_privado", "ubs", "pronto_atendimento", "ambulatorio_especialidades"):
        if a.get("esfera_fonte"):
            parts.append(("hospital " if s.startswith("hospital") else "") + "gestão " + str(a["esfera_fonte"]).lower())
        lt = leitos.get(r.poi_id)
        if lt:
            parts.append(f"{lt[0]} leitos ({lt[1]} SUS) · CNES")
    elif s == "feira_livre" and a.get("dia"):
        parts.append("feira de " + DIA.get(str(a["dia"]).upper(), str(a["dia"]).lower()))
    elif s == "shopping" and r.fonte == "geosampa":
        if a.get("qt_area_bruta_locavel"):
            parts.append(f"ABL {fmt_n(a['qt_area_bruta_locavel'])} m²")
        if a.get("qt_loja"):
            parts.append(f"{a['qt_loja']} lojas")
    elif s == "praca":
        if r.area_m2 and math.isfinite(r.area_m2):
            parts.append(f"{fmt_n(r.area_m2)} m²")
    elif s == "templo":
        rel = {"christian": "cristão", "spiritualist": "espírita", "jewish": "judaico", "muslim": "muçulmano",
               "buddhist": "budista", "umbanda": "umbanda", "candomble": "candomblé", "shinto": "xintoísta"}.get(a.get("religion"))
        den = {"roman_catholic": "católico", "pentecostal": "pentecostal", "evangelical": "evangélico", "baptist": "batista",
               "presbyterian": "presbiteriano", "lutheran": "luterano", "methodist": "metodista", "adventist": "adventista",
               "jehovahs_witness": "testemunhas de Jeová", "orthodox": "ortodoxo", "mormon": "SUD"}.get(a.get("denomination"))
        if rel or den:
            parts.append(" · ".join(x for x in (rel, den) if x))
    elif s in ("supermercado", "atacarejo", "farmacia", "academia", "restaurante", "lanchonete", "cafe", "padaria", "sorveteria", "bar"):
        if a.get("brand") and a["brand"] != r.nome:
            parts.append(str(a["brand"]))
        if s == "restaurante" and a.get("cuisine"):
            parts.append(str(a["cuisine"]).replace("_", " ").replace(";", ", "))
    elif s in ("biblioteca", "museu", "teatro", "cinema", "centro_cultural") and a.get("tipo_fonte"):
        parts.append(str(a["tipo_fonte"]).lower())
    elif s == "cemiterio":
        parts.append("municipal" if r.fonte == "geosampa" else "OSM")
    if s in ("atacarejo",):
        parts.insert(0, "atacarejo")
    if s == "sacolao":
        parts.insert(0, "sacolão municipal")
    if s == "mercado_municipal":
        parts.insert(0, "mercado municipal")
    return " · ".join(p for p in parts if p), badge


def build_pois(dcd, dgeo):
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'; SET threads=2;")
    poi = con.execute(f"SELECT * FROM '{ST}/fase2_poi.parquet'").df()
    # leitos do CNES que casaram com um hospital/UBS do GeoSampa (o CNES fica como duplicata: P-A4-1)
    leitos = {}
    for r in poi[poi.fonte.eq("cnes") & poi.duplicata_de.notna()].itertuples():
        try:
            a = json.loads(r.atributos or "{}")
        except ValueError:
            continue
        if a.get("leitos_existentes"):
            e = leitos.setdefault(r.duplicata_de, [0, 0])
            e[0] += int(a["leitos_existentes"] or 0)
            e[1] += int(a.get("leitos_sus") or 0)
    sub2cat = {}
    for i, c in enumerate(CATS):
        for s in c[3]:
            sub2cat[s] = i
    p = poi[poi.em_contagem.fillna(False) & poi.lon.notna() & poi.subcategoria.isin(sub2cat)].copy()
    p = p[~((p.subcategoria == "shopping") & (p.fonte == "osm"))]      # shopping = só os 56 do GeoSampa (OSM mistura galerias)
    # cinema do GeoSampa = 1 ponto por SALA → 1 por local (P-A4-3)
    k = p.lon.round(4).astype(str) + p.lat.round(4).astype(str) + p.subcategoria
    p = p[~(p.subcategoria.eq("cinema") & k.duplicated())]
    p["cat"] = p.subcategoria.map(sub2cat)
    p["cd"] = assign_district(p.lon.values, p.lat.values, dcd, dgeo, None)
    fora = p.cd.isna().sum()
    p = p[p.cd.notna()].copy()
    at = [poi_attr(r, leitos) for r in p.itertuples()]
    p["a"] = [x[0] for x in at]
    p["b"] = [x[1] for x in at]
    p["n"] = [titulo(x) if isinstance(x, str) else "" for x in p.nome]
    p["s"] = p.fonte.map(FONTES_POI)
    p["x"] = np.round(p.lon * 1e5).astype(int)
    p["y"] = np.round(p.lat * 1e5).astype(int)
    log("POIs exportados:", len(p), "· descartados fora do município a > 2 km:", int(fora))
    return p.reset_index(drop=True), poi


def write_pois(p):
    pbb = {}
    sizes = []
    for cd, g in p.groupby("cd"):
        g = g.sort_values(["cat", "x"])
        sizes.append(jdump({"cd": cd, "k": g.cat.tolist(), "x": g.x.tolist(), "y": g.y.tolist(), "n": g.n.tolist(),
                            "a": g.a.tolist(), "b": g.b.tolist(), "s": g.s.tolist()}, OUT / "poi" / f"{cd}.json"))
        pbb[cd] = [round(g.lon.min(), 5), round(g.lat.min(), 5), round(g.lon.max(), 5), round(g.lat.max(), 5)]
    log("poi/{cd}.json:", len(sizes), "arquivos · máx", round(max(sizes) / 1e3), "KB · total", round(sum(sizes) / 1e6, 2), "MB")
    return pbb


# ── parques (polígono: distância até a borda) ──────────────────────────────────────────────────
def build_parques():
    fs = [f for f in load_wfs("GEOSAMPA_cadparcs_parque_unidade_conservacao")
          if f.get("geometry") and not str(f["properties"].get("tx_situacao") or "").startswith("Proposto")]
    g = np.array([shape(f["geometry"]) for f in fs], dtype=object)
    g = shapely.make_valid(g)
    gs = shapely.simplify(g, 0.00005, preserve_topology=True)
    feats, kept = [], []
    for i, (f, gg) in enumerate(zip(fs, gs)):
        gg = only_polys(gg)
        if gg is None or only_polys(g[i]) is None:
            continue
        kept.append(i)
        pr = f["properties"]
        rp = shapely.point_on_surface(gg)
        feats.append({"n": titulo(pr.get("nm_area")) or "Parque", "t": pr.get("tx_tipo_categoria") or "",
                      "a": num(pr.get("qt_area_metro")), "c": [round(rp.x, 5), round(rp.y, 5)],
                      "bb": [round(v, 5) for v in gg.bounds], "g": poly_enc(gg)})
    n = jdump({"fonte": "GeoSampa · cadastro de parques e unidades de conservação (existentes; propostos fora)",
               "p": feats}, OUT / "parques.json")
    log("parques.json:", len(feats), "parques ·", round(n / 1e3), "KB")
    return feats, np.array([only_polys(g[i]) for i in kept], dtype=object)


# ── transporte ─────────────────────────────────────────────────────────────────────────────────
LINHA_NUM = {"AZUL": 1, "VERDE": 2, "VERMELHA": 3, "AMARELA": 4, "LILAS": 5, "LARANJA": 6, "RUBI": 7, "DIAMANTE": 8,
             "ESMERALDA": 9, "TURQUESA": 10, "CORAL": 11, "SAFIRA": 12, "JADE": 13, "ONIX": 14, "PRATA": 15,
             "VIOLETA": 16, "OURO": 17, "CELESTE": 19, "ROSA": 20, "MARROM": 22}


def build_transporte():
    tr = pd.read_parquet(ST / "fase2_transporte.parquet")
    trilho = tr[tr.modo.isin(["metro", "monotrilho", "trem"])].reset_index(drop=True)
    st = [[titulo(r.nome), titulo(r.linha_cor) if r.linha_cor else "", num(r.linha_num), r.modo, r.status_detalhado,
           round(r.lon, 5), round(r.lat, 5), 1 if r.dentro_sp else 0] for r in trilho.itertuples()]
    tm = tr[tr.modo == "onibus_terminal"]
    term = [[titulo(r.nome), titulo(r.operadora or ""), round(r.lon, 5), round(r.lat, 5)] for r in tm.itertuples()]
    em_obra = trilho[trilho.status_detalhado == "em_obra"]
    lines = []
    for layer, status, modo in (("linha_metro", "existente", "metro"), ("linha_trem", "existente", "trem"),
                                ("linha_metro_projetada", "planejada", "metro"), ("linha_trem_projetada", "planejada", "trem")):
        for f in load_wfs(layer):
            if not f.get("geometry"):
                continue
            p = f["properties"]
            cor = norm(p.get("nm_linha_metro_trem"))
            g = shapely.simplify(shape(f["geometry"]), 0.00004)
            nome = titulo(p.get("nr_nome_linha") or ("Linha " + str(LINHA_NUM.get(cor, "")) + " - " + cor))
            md = "monotrilho" if cor in ("PRATA", "OURO") else modo
            pieces = [(g, status)]
            if status == "planejada":   # trecho em obra = entre as estações da lista P-A4-4 projetadas sobre a linha
                eo = em_obra[em_obra.linha_cor == cor]
                if len(eo):
                    gm = to_metric(g)
                    pts = shapely.points(xy(eo.lon, eo.lat))
                    dd = shapely.distance(gm, pts)
                    near = pts[dd < 400]
                    if len(near) >= 2:
                        s = shapely.line_locate_point(gm, near)
                        a, b = float(s.min()), float(s.max())
                        L = gm.length
                        pieces = [(substring(g, a / L, b / L, normalized=True), "em_obra")]
                        if a > 30:
                            pieces.append((substring(g, 0, a / L, normalized=True), "planejada"))
                        if L - b > 30:
                            pieces.append((substring(g, b / L, 1, normalized=True), "planejada"))
            for gg, stt in pieces:
                for part in shapely.get_parts(gg):
                    if part.geom_type != "LineString" or part.length == 0:
                        continue
                    lines.append({"l": nome, "k": cor, "n": LINHA_NUM.get(cor), "m": md, "s": stt,
                                  "c": [[round(x, 5), round(y, 5)] for x, y in part.coords]})
    corr = []
    for f in load_wfs("corredor_onibus"):
        if not f.get("geometry"):
            continue
        p = f["properties"]
        g = shapely.simplify(shape(f["geometry"]), 0.00004)
        for part in shapely.get_parts(g):
            if part.geom_type == "LineString":
                corr.append({"n": titulo(p.get("nm_corredor")), "s": p.get("dc_tipo_status_corredor_onibus") or "",
                             "c": [[round(x, 5), round(y, 5)] for x, y in part.coords]})
    n = jdump({"st": st, "tm": term, "ln": lines, "co": corr,
               "cols": {"st": ["nome", "linha", "num", "modo", "status", "lon", "lat", "dentro_sp"], "tm": ["nome", "tipo", "lon", "lat"]}},
              OUT / "transporte.json")
    log("transporte.json:", len(st), "estações,", len(term), "terminais,", len(lines), "trechos de linha,", len(corr), "corredores ·", round(n / 1e3), "KB")
    return trilho, tm


# ── zoneamento ─────────────────────────────────────────────────────────────────────────────────
GRUPO7 = {  # grupo de leitura (A4) → os 7 grupos do mapa (+ "outros": ZOE e clubes, só contorno)
    "Eixo (ZEU/ZEM)": "eixo", "Eixo previsto (ZEUP/ZEMP)": "eixo", "Centralidade (ZC)": "centr", "Corredor (ZCOR)": "centr",
    "Mista (ZM/ZMIS)": "mista", "Residencial exclusiva (ZER)": "zer", "Predominantemente residencial (ZPR)": "zer",
    "ZEIS": "zeis", "Econômica/industrial (ZDE/ZPI)": "ind", "Ambiental (ZEPAM/ZEP/ZPDS)": "prot",
    "Ocupação especial (ZOE)": "outros", "Clube (AC)": "outros",
}
G7LB = {"eixo": "Eixos de transformação (ZEU, ZEM; previstos ZEUP, ZEMP)", "centr": "Centralidades e corredores (ZC, ZCOR)",
        "mista": "Mistas (ZM, ZMIS)", "zer": "Residenciais (ZER, ZPR)", "zeis": "ZEIS (interesse social)",
        "ind": "Industriais e de desenvolvimento econômico (ZPI, ZDE)", "prot": "Proteção ambiental (ZEPAM, ZEP, ZPDS)",
        "outros": "Ocupação especial e clubes (ZOE, AC)"}


def build_zoneamento(dcd, dgeo):
    t = pq.read_table(ST / "fase2_zoneamento.parquet")
    z = t.drop(["geometry"]).to_pandas()
    g = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    keep = (z.cd_zona != "Praça/Canteiro").values
    z, g = z[keep].reset_index(drop=True), g[keep]
    z["g7"] = z.grupo.map(GRUPO7).fillna("outros")
    # tabela de zonas (Quadro 3 da 16.402 na redação da 18.081/2024; mapa pela 18.177/2024)
    zt = (z.groupby("cd_zona").agg(nome=("nome_zona", "first"), grupo=("grupo", "first"), g7=("g7", "first"), macro=("macrogrupo", "first"),
                                    ca_min=("ca_min", "first"), ca_bas=("ca_basico", "first"), ca_max=("ca_maximo", "first"),
                                    to1=("to_lote_ate500", "first"), to2=("to_lote_500mais", "first"), gab=("gabarito_m", "first"),
                                    livre=("gabarito_livre", "first"), nota=("nota_quadro3", "first"), lei=("lei", "first"),
                                    dt=("dt_atualizacao", "max")).reset_index())
    zidx = {c: i for i, c in enumerate(zt.cd_zona)}
    ouc = sorted(x for x in z.operacao_urbana.dropna().unique())
    oidx = {c: i for i, c in enumerate(ouc)}
    zonas = [{"z": r.cd_zona, "nome": titulo(r.nome) if r.nome else r.cd_zona, "grupo": r.grupo, "g7": r.g7, "macro": r.macro,
              "ca_min": num(r.ca_min, 2), "ca_bas": num(r.ca_bas, 2), "ca_max": num(r.ca_max, 2), "to": [num(r.to1, 2), num(r.to2, 2)],
              "gab": num(r.gab), "livre": bool(r.livre) if r.livre is not None and r.livre == r.livre else False,
              "nota": r.nota or "", "lei": r.lei, "dt": r.dt} for r in zt.itertuples()]
    rp = shapely.point_on_surface(g)
    z["cd"] = assign_district(shapely.get_x(rp), shapely.get_y(rp), dcd, dgeo, None, max_out_m=50000)
    eixo = z.g7.eq("eixo").values

    def enc(sel, tol):
        gg = shapely.simplify(g[sel], tol, preserve_topology=True)
        zz = z[sel]
        out = {"z": [], "a": [], "o": [], "g": []}
        for r, geom in zip(zz.itertuples(), gg):
            geom = only_polys(geom if geom.is_valid else shapely.make_valid(geom))
            if geom is None:
                continue
            pe = poly_enc(geom)
            if not pe:
                continue
            out["z"].append(zidx[r.cd_zona])
            out["a"].append(1 if r.eixo_ativado_decreto else 0)
            out["o"].append(oidx.get(r.operacao_urbana, -1) if r.operacao_urbana else -1)
            out["g"].append(pe)
        return out, gg

    ex, _ = enc(eixo, 0.00003)
    n = jdump(ex, OUT / "zon" / "eixos.json")
    log("zon/eixos.json:", len(ex["z"]), "polígonos ·", round(n / 1e3), "KB")
    zbb, sizes = {}, []
    for cd in sorted(z.cd.dropna().unique(), key=lambda c: int(c)):
        sel = (~eixo) & (z.cd == cd).values
        o, gg = enc(sel, 0.00002)
        sizes.append(jdump(o, OUT / "zon" / f"{cd}.json"))
        b = shapely.total_bounds(gg)
        zbb[cd] = [round(float(v), 5) for v in b]
    log("zon/{cd}.json:", len(sizes), "arquivos · máx", round(max(sizes) / 1e3), "KB · total", round(sum(sizes) / 1e6, 2), "MB")
    return zonas, ouc, zidx, oidx, zbb


# ── regiões comerciais ─────────────────────────────────────────────────────────────────────────
def build_comercial():
    t = pq.read_table(ST / "fase2_regioes_comerciais.parquet")
    r = t.drop(["geometry"]).to_pandas()
    g = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    gs = shapely.simplify(g, 0.00003, preserve_topology=True)
    tipo = {"corredor": 0, "face_comercial": 1, "polo": 2}
    # traço que segue a rua: centroide dos lotes (IPTU 2026: codlog + número) por faixa de 50 números, na ordem da
    # numeração (os dois lados da rua → o centroide cai perto do eixo). O polígono do A4 (envoltória convexa + 20 m)
    # vira "bolha" em rua curva; fica só para o teste "lote dentro do corredor".
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'; SET threads=2;")
    cc = r[r.tipo != "polo"][["regiao_id", "codlog", "numero_ini", "numero_fim"]].copy()
    con.register("cc", cc)
    lots = con.execute(f"""
        WITH i AS (SELECT substr(sql,1,3) setor, substr(sql,4,3) quadra,
                          CASE WHEN condominio <> '00-0' THEN '0000' ELSE substr(sql,7,4) END lote,
                          CASE WHEN condominio <> '00-0' THEN substr(condominio,1,2) ELSE '00' END condominio,
                          codlog, TRY_CAST(numero AS INTEGER) numero
                   FROM '{ITBI}/raw/iptu/iptu_2026_slim.parquet' WHERE codlog IN (SELECT DISTINCT codlog FROM cc)),
             l AS (SELECT setor, quadra, lote, condominio, mode(codlog) codlog, mode(numero) numero FROM i GROUP BY 1,2,3,4),
             c AS (SELECT setor, quadra, lote, condominio, any_value(COALESCE(plon, lon)) lon, any_value(COALESCE(plat, lat)) lat
                   FROM '{ST}/lotes_centroides.parquet' GROUP BY 1,2,3,4)
        SELECT l.codlog, l.numero, c.lon, c.lat FROM l JOIN c USING (setor, quadra, lote, condominio) WHERE l.numero > 0 AND c.lon IS NOT NULL
    """).df()
    by = {k: v for k, v in lots.groupby("codlog")}
    tracos = {}
    for row in cc.itertuples():
        g0 = by.get(row.codlog)
        if g0 is None:
            continue
        sel = g0[(g0.numero >= row.numero_ini) & (g0.numero <= row.numero_fim)]
        if len(sel) < 2:
            continue
        P = xy(sel.lon, sel.lat)
        b = (sel.numero.values // 50)
        pts = pd.DataFrame({"b": b, "x": P[:, 0], "y": P[:, 1]}).groupby("b")[["x", "y"]].mean().sort_index().values
        if len(pts) < 2:   # uma faixa só: eixo do retângulo mínimo dos lotes
            mrr = shapely.minimum_rotated_rectangle(shapely.multipoints(P))
            if mrr.geom_type != "Polygon":
                continue
            c4 = np.asarray(mrr.exterior.coords)[:4]
            e = [np.hypot(*(c4[(k + 1) % 4] - c4[k])) for k in range(4)]
            k = int(np.argmin(e[:2]))
            pts = np.array([(c4[k] + c4[k + 1]) / 2, (c4[k + 2] + c4[(k + 3) % 4]) / 2])
        ln = shapely.simplify(shapely.LineString(pts), 8)
        if ln.length < 20:
            continue
        cl = np.asarray(ln.coords)
        tracos[row.regiao_id] = [[round(x / KX - 46.6, 5), round(y / KY + LAT0, 5)] for x, y in cl]
    log("traços de corredor reconstruídos:", len(tracos), "de", len(cc))
    feats = []
    for row, gg in zip(r.itertuples(), gs):
        gg = only_polys(gg if gg.is_valid else shapely.make_valid(gg))
        if gg is None:
            continue
        nome = row.nome or ""
        if row.tipo != "polo":
            nome = logradouro(nome)
        rp = shapely.point_on_surface(gg)
        feats.append({"t": tipo[row.tipo], "id": row.regiao_id, "n": nome, "cd": str(row.cd_distrito).lstrip("0") if row.cd_distrito else None,
                      "nl": num(row.n_lotes), "nv": num(row.n_lotes_varejo), "v": num(row.varejo_m2), "e": num(row.escritorio_m2),
                      "zc": num(row.pct_lotes_em_zona_central, 1), "ha": num(row.area_ha, 1), "p": row.perfil or "",
                      "c": [round(rp.x, 5), round(rp.y, 5)]})
        if row.tipo == "polo" or row.regiao_id not in tracos:
            feats[-1]["g"] = poly_enc(gg)
        else:
            feats[-1]["l"] = tracos[row.regiao_id]
    n = jdump({"fonte": "IPTU 2026 (uso do lote) · A4 §6: corredor = trechos de 100 números consecutivos com ≥ 6 lotes e ≥ 50% com varejo; "
                        "face = trecho isolado; polo = varejo + escritório no disco de 250 m ≥ p97,5 e ≥ 5 ha",
               "f": feats}, OUT / "comercial.json")
    log("comercial.json:", len(feats), "regiões ·", round(n / 1e3), "KB")
    return feats, g, r


# ── riscos ─────────────────────────────────────────────────────────────────────────────────────
def build_riscos(dcd, dgeo):
    out = {"geo": [], "hid": []}
    for key, layer in (("geo", "area_risco_geologico"), ("hid", "risco_hidrologico")):
        for f in load_wfs(layer):
            if not f.get("geometry"):
                continue
            p = f["properties"]
            g = only_polys(shapely.make_valid(shapely.simplify(shape(f["geometry"]), 0.00003, preserve_topology=True)))
            if g is None:
                continue
            if key == "geo":
                grau = p.get("tx_grau_de_risco_geologico") or ""
                d = {"n": titulo(p.get("nm_area_risco")), "r": grau, "p": (p.get("tx_tipo_processo_geologico") or "").lower(),
                     "m": num(p.get("qt_moradia")), "v": (p.get("dt_vistoria") or "")[:10]}
            else:
                d = {"n": titulo(p.get("nm_area_risco_hidrologico")), "r": p.get("tx_grau_risco_hidrologico") or "",
                     "p": (p.get("tx_tipo_processo") or "").lower(), "m": num(p.get("qt_moradia")), "v": (p.get("dt_vistoria") or "")[:10]}
            d["g"] = poly_enc(g)
            out[key].append(d)
    n = jdump(out, OUT / "riscos.json")
    log("riscos.json:", len(out["geo"]), "setores geológicos,", len(out["hid"]), "hidrológicos ·", round(n / 1e3), "KB")
    # mancha de inundação TR 25: 488 mil quadrículas de ~10 m → células de 20 m unidas por distrito
    fs = load_wfs("mancha_inundacao_25")
    C = 20.0
    cx = np.empty(len(fs)); cy = np.empty(len(fs)); pr = np.empty(len(fs))
    for i, f in enumerate(fs):
        ring = f["geometry"]["coordinates"][0] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"][0][0]
        a = np.asarray(ring)
        cx[i], cy[i] = a[:, 0].mean(), a[:, 1].mean()
        pr[i] = float(f["properties"].get("qt_profundidade_maxima") or 0)
    dt_inund = max((f["properties"].get("dt_atualizacao") or "")[:10] for f in fs[:2000])
    del fs
    P = xy(cx, cy)
    ix = np.floor(P[:, 0] / C).astype(np.int64)
    iy = np.floor(P[:, 1] / C).astype(np.int64)
    cells = pd.DataFrame({"ix": ix, "iy": iy, "p": pr}).groupby(["ix", "iy"], as_index=False)["p"].max()
    ccx = (cells.ix.values + 0.5) * C / KX - 46.6
    ccy = (cells.iy.values + 0.5) * C / KY + LAT0
    cells["cd"] = assign_district(ccx, ccy, dcd, dgeo, None, max_out_m=0)
    cells = cells[cells.cd.notna()]
    sizes, ibb = [], {}
    for cd, gcel in cells.groupby("cd"):
        gcel = gcel.sort_values(["iy", "ix"])
        rects, depth = [], []
        for iyv, row in gcel.groupby("iy"):     # corridas horizontais → retângulos (menos geometrias para unir)
            xs = row.ix.values
            ps = row.p.values
            brk = np.nonzero(np.diff(xs) != 1)[0] + 1
            for seg, pseg in zip(np.split(xs, brk), np.split(ps, brk)):
                x0, x1 = seg[0] * C, (seg[-1] + 1) * C
                y0, y1 = iyv * C, (iyv + 1) * C
                rects.append(shapely.box(x0, y0, x1, y1))
                depth.append(pseg.max())
        u = shapely.union_all(np.array(rects, dtype=object))
        parts = shapely.get_parts(u)
        dep = np.zeros(len(parts))
        tr = shapely.STRtree(parts)
        a, b = tr.query(np.array(rects, dtype=object), predicate="intersects")
        dd = pd.Series(np.asarray(depth)[a]).groupby(b).max()
        dep[dd.index.values] = dd.values
        geo = shapely.transform(parts, lambda c: np.column_stack([c[:, 0] / KX - 46.6, c[:, 1] / KY + LAT0]))
        geo = shapely.simplify(geo, 0.00006, preserve_topology=True)
        o = {"p": [], "g": []}
        for gg, dv in zip(geo, dep):
            gg = only_polys(gg)
            if gg is None or gg.area < 1e-9:
                continue
            pe = poly_enc(gg)
            if pe:
                o["p"].append(round(float(dv), 1))
                o["g"].append(pe)
        sizes.append(jdump(o, OUT / "inund" / f"{cd}.json"))
        ibb[cd] = [round(float(v), 5) for v in shapely.total_bounds(geo)]
    log("inund/{cd}.json:", len(sizes), "arquivos · máx", round(max(sizes) / 1e3), "KB · total", round(sum(sizes) / 1e6, 2), "MB")
    return ibb, dt_inund


# ── hexágonos de densidade (~500 m entre lados paralelos; ~21,7 ha) ────────────────────────────
HEX_R = 500 / math.sqrt(3)         # circunraio (m) de hexágono "pontudo" com 500 m entre lados paralelos
HEX_AREA_HA = 3 * math.sqrt(3) / 2 * HEX_R ** 2 / 1e4


def hex_axial(P):
    """ponto métrico → (q, r) axial do hexágono pontudo de circunraio HEX_R (arredondamento cúbico)"""
    q = (math.sqrt(3) / 3 * P[:, 0] - 1 / 3 * P[:, 1]) / HEX_R
    r = (2 / 3 * P[:, 1]) / HEX_R
    x, z = q, r
    y = -x - z
    rx, ry, rz = np.round(x), np.round(y), np.round(z)
    dx, dy, dz = np.abs(rx - x), np.abs(ry - y), np.abs(rz - z)
    m1 = (dx > dy) & (dx > dz)
    m2 = ~m1 & (dy > dz)
    rx[m1] = -ry[m1] - rz[m1]
    rz[~m1 & ~m2] = (-rx - ry)[~m1 & ~m2]
    return rx.astype(int), rz.astype(int)


def hex_center(q, r):
    x = HEX_R * (math.sqrt(3) * q + math.sqrt(3) / 2 * r)
    y = HEX_R * (1.5 * r)
    return x, y


def build_densidades(dgeo):
    sp = shapely.union_all(to_metric(dgeo))
    b = sp.bounds
    # todos os hexágonos com centro no município
    qs, rs = [], []
    r0, r1 = int(math.floor(b[1] / (1.5 * HEX_R))) - 1, int(math.ceil(b[3] / (1.5 * HEX_R))) + 1
    for r in range(r0, r1 + 1):
        q0 = int(math.floor((b[0] / HEX_R - math.sqrt(3) / 2 * r) / math.sqrt(3))) - 2
        q1 = int(math.ceil((b[2] / HEX_R - math.sqrt(3) / 2 * r) / math.sqrt(3))) + 2
        for q in range(q0, q1 + 1):
            qs.append(q); rs.append(r)
    qs, rs = np.array(qs), np.array(rs)
    cx, cy = hex_center(qs, rs)
    inside = shapely.contains_xy(sp, cx, cy)
    qs, rs = qs[inside], rs[inside]
    hk = lambda q, r: np.asarray(q, np.int64) * 100003 + np.asarray(r, np.int64)
    key = pd.Index(hk(qs, rs))
    base = {"r": round(HEX_R, 2), "ha": round(HEX_AREA_HA, 2), "lat0": LAT0, "lon0": -46.6, "kx": round(KX, 3), "ky": KY,
            "q": qs.tolist(), "rr": rs.tolist()}
    # roubos 2025 (SSP): BO único, coordenada nativa, dentro do município
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'; SET threads=2;")
    ssp = con.execute(f"""SELECT DISTINCT ON (BO_HASH) BO_HASH, LATITUDE lat, LONGITUDE lon FROM '{SSP}'
                          WHERE RUBRICA LIKE 'Roubo%' AND LATITUDE BETWEEN -24.01 AND -23.35 AND LONGITUDE BETWEEN -46.83 AND -46.36""").df()
    n_all = con.execute(f"SELECT count(DISTINCT BO_HASH) FROM '{SSP}' WHERE RUBRICA LIKE 'Roubo%'").fetchone()[0]
    P = xy(ssp.lon, ssp.lat)
    ok = shapely.contains_xy(sp, P[:, 0], P[:, 1])
    q, r = hex_axial(P[ok])
    cnt = pd.Series(1, index=hk(q, r)).groupby(level=0).sum()
    v = cnt.reindex(key).fillna(0).values
    rb = dict(base, v=[int(x) for x in v], unidade="roubos registrados por km² (2025)", km2=round(HEX_AREA_HA / 100, 4),
              n=int(ok.sum()), n_total=int(n_all), fonte="SSP-SP · SPDadosCriminais_2025 (arquivo de 30/06/2026) · BO único · coordenada da SSP")
    n = jdump(rb, OUT / "dens_roubos.json")
    log("dens_roubos.json:", len(qs), "hexágonos ·", int(ok.sum()), "de", n_all, "BOs de roubo com coordenada no município; nos hexágonos:", int(v.sum()), "·", round(n / 1e3), "KB")
    # varejo (IPTU 2026): grade de 50 m do A4 (área construída de varejo) somada por hexágono
    zg = np.load(ST / "fase2_comercio_grade50m.npz")
    x0, y0, c = float(zg["x0"]), float(zg["y0"]), float(zg["c"])
    V = zg["varejo"]
    iy, ix = np.nonzero(V > 0)
    Pc = np.column_stack([x0 + (ix + 0.5) * c, y0 + (iy + 0.5) * c])
    q, r = hex_axial(Pc)
    s = pd.Series(V[iy, ix], index=hk(q, r)).groupby(level=0).sum()
    vv = s.reindex(key).fillna(0).values
    va = dict(base, v=[int(round(x)) for x in vv], unidade="m² construídos de varejo (lojas, lojas em condomínio, postos) por hectare",
              fonte="IPTU 2026 (uso do imóvel × área construída), grade de 50 m do A4")
    n = jdump(va, OUT / "dens_varejo.json")
    log("dens_varejo.json:", round(n / 1e3), "KB · varejo total", round(vv.sum() / 1e6, 1), "mi m²")


# ── por lote ───────────────────────────────────────────────────────────────────────────────────
def pdist_park(Pm, parks_m):
    tr = shapely.STRtree(parks_m)
    idx, dist = tr.query_nearest(shapely.points(Pm), return_distance=True, all_matches=False)
    d = np.full(len(Pm), np.nan)
    d[idx[0]] = dist
    k = np.full(len(Pm), -1)
    k[idx[0]] = idx[1]
    return d, k


def build_lotes(p, trilho, tm, parques_g, com_feats, com_g, com_r, zidx, oidx, parques_feats):
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'; SET threads=2;")
    L = con.execute(f"SELECT * FROM '{ST}/fase2_lote_contexto.parquet'").df()
    L["cd"] = L.cd_distrito.astype(str).str.lstrip("0")
    P = xy(L.lon, L.lat)
    log("lotes:", len(L))
    # estações (índices = linhas de transporte.json "st")
    out = {}
    for k, sel in (("e", trilho.status_detalhado.eq("existente")), ("o", trilho.status_detalhado.eq("em_obra")),
                   ("p", trilho.status_detalhado.eq("planejada"))):
        ii = np.nonzero(sel.values)[0]
        t = KDTree(xy(trilho.lon.values[ii], trilho.lat.values[ii]))
        d, j = t.query(P, k=1)
        out["s" + k] = ii[j[:, 0]]
        out["d" + k] = np.round(d[:, 0] / 10).astype(int) * 10
    # distância ao mais próximo por categoria (para os quantis do distrito) e o POI quando passa de R_CLI
    near = {}
    far_ref = {}
    for ci, c in enumerate(CATS):
        key = c[0]
        if key == "parque":
            d, kk = pdist_park(P, to_metric(parques_g))
            near[key] = d
            far_ref[key] = ("parque", kk)
            continue
        sel = p[p.cat == ci]
        if not len(sel):
            continue
        t = KDTree(xy(sel.lon, sel.lat))
        d, j = t.query(P, k=1)
        near[key] = d[:, 0]
        far_ref[key] = ("poi", sel.index.values[j[:, 0]])
    # A4: roubos/furtos 500 m, IDEB máx 1 km, varejo e escritório 500 m, riscos, zona
    rk = (L.inundacao_tr25.fillna(False).astype(int) + 2 * L.em_risco_geologico.fillna(False).astype(int)
          + 4 * L.em_risco_hidrologico.fillna(False).astype(int))
    # região comercial que contém o ponto do lote (corredor/face e polo)
    pts = shapely.points(L.lon.values, L.lat.values)
    tr = shapely.STRtree(com_g)
    a, b = tr.query(pts, predicate="within")
    cc = np.full(len(L), -1)
    cp = np.full(len(L), -1)
    fid = {f["id"]: i for i, f in enumerate(com_feats)}
    tipos = com_r.tipo.values
    ids = com_r.regiao_id.values
    for ai, bi in zip(a, b):
        j = fid.get(ids[bi], -1)
        if j < 0:
            continue
        if tipos[bi] == "polo":
            cp[ai] = j
        elif cc[ai] < 0:
            cc[ai] = j
    zcode = L.zona.map(zidx).fillna(-1).astype(int).values
    ou = L.operacao_urbana.map(oidx).fillna(-1).astype(int).values
    grau = {"R1": 1, "R2": 2, "R3": 3, "R4": 4}
    rg = np.array([0 if (s is None or s != s) else grau.get(str(s).strip().upper()[:2], 9) for s in L.grau_risco_geologico.values])

    def iv(s, f=1.0):
        v = np.asarray(s, float) * f
        return [None if not math.isfinite(x) else int(round(x)) for x in v]

    qs = np.linspace(0, 1, 21)
    sizes = []
    quant_all = {}
    for cd, idx in L.groupby("cd").groups.items():
        idx = np.asarray(sorted(idx, key=lambda i: L.lot_id.values[i]))
        o = {"cd": cd, "n": len(idx), "id": L.lot_id.values[idx].tolist()}
        for k in ("se", "so", "sp"):
            o[k] = out[k][idx].tolist()
        for k in ("de", "do", "dp"):
            o[k] = (out[k][idx] // 10).tolist()          # decâmetros
        o["z"] = zcode[idx].tolist()

        def sparse(vals, zero):
            return {str(i): v for i, v in enumerate(vals) if v is not None and v != zero}
        o["za"] = sparse([1 if (x is not None and x == x and x) else 0 for x in L.zona_eixo_ativado.values[idx]], 0)
        o["ou"] = sparse(ou[idx].tolist(), -1)
        o["rk"] = sparse(rk.values[idx].tolist(), 0)
        o["ip"] = sparse(iv(L.inundacao_tr25_prof_m.values[idx], 10), None)
        o["rg"] = sparse(rg[idx].tolist(), 0)
        o["rb"] = iv(L.n_roubo_2025_500m.values[idx])
        o["fu"] = iv(L.n_furto_2025_500m.values[idx])
        o["ia"] = iv(L.ideb_ai_max_1km.values[idx], 10)
        o["if"] = iv(L.ideb_af_max_1km.values[idx], 10)
        o["va"] = iv(L.varejo_m2_500m.values[idx], 0.01)
        o["es"] = iv(L.escritorio_m2_500m.values[idx], 0.01)
        o["cc"] = sparse(cc[idx].tolist(), -1)
        o["cp"] = sparse(cp[idx].tolist(), -1)
        # quantis do distrito (p0, p5, …, p100) — distância ao mais próximo (m), roubos e varejo a 500 m
        q = {}
        for key, d in near.items():
            q[key] = [int(round(x)) for x in np.nanquantile(d[idx], qs)]
        for k, arr in (("trilho", out["de"]), ("obra", out["do"]), ("planejada", out["dp"])):
            q[k] = [int(round(x)) for x in np.nanquantile(arr[idx], qs)]
        for k, col in (("rb", "n_roubo_2025_500m"), ("va", "varejo_m2_500m")):
            vv = L[col].values[idx].astype(float)
            q[k] = [int(round(x)) for x in np.nanquantile(vv, qs)] if np.isfinite(vv).any() else None
        o["q"] = q
        quant_all[cd] = {k: v[10] for k, v in q.items() if v}
        # candidatos "longe": o POI mais próximo de cada lote do distrito que não tem nenhum da categoria até R_CLI.
        # O navegador procura até R_CLI em poi/{cd}.json; se não achar, o mais próximo está nesta lista (parque = índice em parques.json)
        fp, seen = [], set()
        for ci, c in enumerate(CATS):
            key = c[0]
            if key not in near:
                continue
            sub = np.nonzero(near[key][idx] > R_CLI)[0]
            kind, refs = far_ref[key]
            for ref in sorted(set(int(refs[idx[li]]) for li in sub)):
                if ref < 0 or (kind, ref) in seen:
                    continue
                seen.add((kind, ref))
                if kind == "poi":
                    rr = p.loc[ref]
                    fp.append([ci, rr.n, int(rr.x), int(rr.y), rr.a, int(rr.s)])
                else:
                    fp.append([ci, ref])
        o["fp"] = fp
        sizes.append(jdump(o, OUT / "lote" / f"{cd}.json"))
    log("lote/{cd}.json:", len(sizes), "arquivos · máx", round(max(sizes) / 1e3), "KB · total", round(sum(sizes) / 1e6, 2), "MB")
    return quant_all


def main():
    OUT.mkdir(exist_ok=True)
    d, dgeo = distritos()
    dcd = d["cd"].values
    log("distritos:", len(d))
    trilho, tm = build_transporte()
    p, poi_all = build_pois(dcd, dgeo)
    pbb = write_pois(p)
    parques_feats, parques_g = build_parques()
    zonas, ouc, zidx, oidx, zbb = build_zoneamento(dcd, dgeo)
    com_feats, com_g, com_r = build_comercial()
    ibb, dt_inund = build_riscos(dcd, dgeo)
    build_densidades(dgeo)
    quant = build_lotes(p, trilho, tm, parques_g, com_feats, com_g, com_r, zidx, oidx, parques_feats)
    dc = pd.read_parquet(ST / "fase2_distrito_contexto.parquet")
    dc["cd"] = dc.cd_distrito.astype(str).str.lstrip("0")
    area_km2 = dict(zip(dcd, shapely.area(to_metric(dgeo)) / 1e6))
    cnt = p.groupby(["cd", "cat"]).size().unstack(fill_value=0)
    dist_tab = {}
    for r in dc.itertuples():
        cd = r.cd
        dens = {}
        if cd in cnt.index:
            for ci, c in enumerate(CATS):
                if ci in cnt.columns:
                    dens[c[0]] = int(cnt.loc[cd, ci])
        dist_tab[cd] = {"lotes": int(r.lotes), "km2": round(area_km2.get(cd, float("nan")), 2),
                        "tr500": num(r.pct_lotes_ate_500m_estacao, 1), "tr1k": num(r.pct_lotes_ate_1km_estacao, 1),
                        "obra1k": num(r.pct_lotes_ate_1km_estacao_em_obra, 1), "plan1k": num(r.pct_lotes_ate_1km_planejada, 1),
                        "med_tr": num(r.med_dist_estacao_m), "roubo500": num(r.med_roubo_2025_500m), "inund": num(r.pct_lotes_inundacao_tr25, 1),
                        "eixo": num(r.pct_lotes_eixo, 1), "zer": num(r.pct_lotes_zer, 1), "n": dens, "med": quant.get(cd, {})}
    cats = [{"k": c[0], "l": c[1], "g": c[2], "sub": c[4], "gl": c[5],
             "osm": all(s in {"universidade", "faculdade_tecnica", "farmacia", "supermercado", "atacarejo", "restaurante", "lanchonete", "bar",
                              "cafe", "padaria", "sorveteria", "praca_alimentacao", "academia", "templo"} for s in c[3]) and bool(c[3])}
            for c in CATS]
    meta = {
        "built": time.strftime("%Y-%m-%d %H:%M"),
        "raio_m": R_CLI,
        "cats": cats, "subs": [{"id": s[0], "l": s[1], "def": s[2]} for s in SUBS],
        "zonas": zonas, "g7": G7LB, "ouc": [titulo(x) for x in ouc],
        "pbb": pbb, "zbb": zbb, "ibb": ibb,
        "distritos": dist_tab,
        "hex": {"r": round(HEX_R, 2), "ha": round(HEX_AREA_HA, 2)},
        "fontes": [
            {"k": "geosampa", "l": "GeoSampa (Prefeitura de SP) · WFS", "lic": "CC BY-SA 4.0", "data": "camadas vivas em 27/09/2026 (feiras jun/2026; shoppings mai/2026; praças fev/2025; zoneamento 28/03/2025; inundação ago/2026)"},
            {"k": "osm", "l": "OpenStreetMap (Overpass)", "lic": "ODbL · © colaboradores do OpenStreetMap", "data": "base de 27/09/2026",
             "nota": "cobertura desigual: por m² de varejo, a Leste tem ~5× menos POIs mapeados que o Oeste (A4 §2); ausência no OSM não é ausência real"},
            {"k": "cnes", "l": "CNES/DATASUS (hospitais, PS e PA ativos)", "lic": "dados abertos · Ministério da Saúde", "data": "competência 2026-08"},
            {"k": "inep", "l": "INEP · IDEB 2023 por escola (ligado pelo código INEP)", "lic": "dados abertos · INEP", "data": "2023",
             "nota": "cobre a rede pública (e 41 particulares no ensino médio)"},
            {"k": "ssp", "l": "SSP-SP · SPDadosCriminais 2025", "lic": "dados abertos · SSP-SP", "data": "2025 completo (arquivo de 30/06/2026)",
             "nota": "BO único; 80% com coordenada (roubo 88%); subnotificação; coordenada = local declarado"},
            {"k": "zon", "l": "Zoneamento: Lei 18.177/2024 (perímetros GeoSampa) · parâmetros do Quadro 3 da Lei 16.402/2016 na redação da Lei 18.081/2024",
             "lic": "legislação municipal", "data": "perímetros de 28/03/2025"},
            {"k": "iptu", "l": "IPTU 2026 (uso e área construída) — regiões comerciais e varejo", "lic": "dados abertos · Prefeitura de SP", "data": "2026"},
        ],
        "notas": {
            "euclid": "distâncias em linha reta (plano local, erro < 0,5%); a pé costuma dar 1,2–1,4× mais",
            "obra": "estações 'em obra' vêm de lista manual (P-A4-4: Linha 6, Linha 17 e Linha 2 Vila Prudente–Penha) — a validar com Metrô/STM; sem previsão de entrega",
            "inund": dt_inund,
        },
    }
    n = jdump(meta, OUT / "meta.json")
    log("meta.json", round(n / 1e3), "KB · fim")


if __name__ == "__main__":
    main()
