#!/usr/bin/env python3.12
"""Radar de flips (A2 → protótipo): gera proto/flips/*.json para o módulo src/m_flips.js.

Entradas (somente leitura, ../research/stage e ../raw):
  fase2_revendas.parquet (A2_02: 1 linha por par compra → venda da mesma unidade, com flags e ganhos),
  itbi_negocios.parquet (denominador: negócios de unidade pronta), fase2_estoque.parquet (A2_04: estoque IPTU por
  distrito × tipo × camada × exercício), fase2_entrega_predio.parquet (A2_05), fase2_hazard.parquet (A2_03),
  fase2_identidade.json (A2_01: ponte planta → unidade por safra), condo_perfil_2026.parquet, raw/iptu/iptu_2026_slim
  (estoque de rua e prédio, complemento), proto/data.json (zona de cada distrito).

Regras (A2_flips.md, decisões do orquestrador):
  FLIP = revenda válida, fora do repasse planta → planta (P-A2-7), com holding ≤ 12 m (P-A2-4); "revenda rápida"
  = ≤ 24 m (camada secundária). Faixas de exibição: < 3 m (relâmpago), 3–12 m, 12–24 m. Mesmo valor exato já está fora
  (P-A2-9, via revenda_valida). Natureza 2 = marcador (f_cessao_na_venda), sem preço.
  P-A2-8 (registro em duas etapas) APLICADO AQUI: par planta → 1ª guia de SQL próprio da mesma unidade com holding
  ≤ 12 m e razão 0,85–1,15 deixa de ser revenda; a revenda seguinte da unidade tem o holding medido desde a planta.
  Camada: lançamento = prédio ≤ 3 anos na venda (ACC; sem ACC, ano_vida do SQL) ou compra na planta; madura = o resto.
  Métricas (P-A2-5): flips_mil_ano = flips ÷ estoque IPTU do segmento × 1.000 × 4/janela; pct_flip_neg = flips ÷ negócios
  de unidade pronta (sem planta); pct_flip_rev = flips ÷ revendas válidas. Ganho = mediana (p25–p75), n_ganho sempre.
  Líquido (P-A2-6) = (1+real)·0,94/1,045 − 1: transformação afim do real, derivada no navegador (premissas visíveis).

Saídas (proto/flips/, servidas pelo serve.py; nada vai embutido no HTML):
  meta.json                 definições, premissas, datas, ponte por safra, efeito do P-A2-8, hazard, giro por idade
  d/{seg}_{camada}.json     cubo região × janela × trimestre final (últimos 24T: 20 selecionáveis + 4 para o d4):
                            cidade e zonas em 1T/4T/8T, distritos em 4T/8T; métricas para holding ≤ 12 e ≤ 24 m
  serie_{seg}.json          contagens trimestrais 2006–2T2026 por cidade e distrito × camada (faixa de holding,
                            revendas, negócios de unidade pronta)
  ruas.json, predios.json   rankings (janelas 8T e 20T até 2T2026) com limite inferior de Wilson da taxa
  tipologia.json            faixa do estrato × trimestre (8T) na cidade + totais 8T
  planta.json               comprou na planta → revendeu, por prédio (lote), e participação de revendas ≤ 12 m nos
                            prédios de até 3 anos; resumo da cidade e por safra
  lotes/{cd}.json           por lote (mesmo id do dist/{cd}.json): resumo de 5 anos e cadeias compra → venda por unidade

    python3.12 build_flips.py            (≈1–2 min; duckdb com memory_limit 2GB, threads=2)
"""
import json
import math
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

H = Path(__file__).resolve().parent
ITBI = H.parent
ST = ITBI / "research" / "stage"
IPTU = ITBI / "raw" / "iptu"
OUT = H / "flips"
Q_FIM = 2026 * 4 + 1               # 2T2026 = último trimestre completo (instrumentos até 07/08/2026)
NQC = 24                           # trimestres finais no cubo (20 selecionáveis + 4 para o d4)
Q0C = Q_FIM - NQC + 1
Q_SER0 = 2006 * 4                  # série desde 1T2006 (a de flips só é completa a partir de 2007)
ULTIMA = "2026-08-07"
CUSTOS = dict(itbi=0.03, cartorio_registro=0.015, corretagem=0.06)
SEGS = ("apto", "casa", "sala")
CAMADAS = {"madura": "camada='madura'", "lancamento": "camada='lancamento'", "todas": "true"}
DIMS = {"area": ["≤45", "45–70", "70–100", "100–150", "150–250", ">250"], "padrao": list("ABCDEF"),
        "idade": ["≤3", "4–10", "11–20", "21–35", ">35"], "quartos": ["1", "2", "3", "4+"]}
DAY0 = pd.Timestamp("2006-01-01")
t0 = time.time()


def log(*a):
    print(f"[{time.time() - t0:5.0f}s]", *a, flush=True)


def qlabel(q):
    return f"{q % 4 + 1}T{q // 4}"


def ex_de(ano):   # exercício IPTU mais próximo (igual ao A2_04)
    return 2010 if ano <= 2012 else 2015 if ano <= 2017 else 2020 if ano <= 2020 else 2025 if ano == 2024 else min(ano, 2026)


def num(v):
    """float finito ou None (aceita None, NaN, pd.NA, numpy)."""
    if v is None or v is pd.NA:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def r1(v):
    f = num(v)
    return None if f is None else round(f, 1)


def r2(v):
    f = num(v)
    return None if f is None else round(f, 2)


def ri(v):
    f = num(v)
    return None if f is None else int(round(f))


def rk(v):   # R$ cheio, arredondado a R$ 100
    f = num(v)
    return None if f is None else int(round(f / 100) * 100)


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(s)
    return len(s)


def lst3(a):
    """lista de 3 quantis vinda do duckdb (lista/array) ou [None]*3 quando nula (None, NaN, pd.NA)."""
    if a is None or a is pd.NA or (np.isscalar(a) and pd.isna(a)):
        return [None, None, None]
    return [None if (x is None or x is pd.NA or pd.isna(x)) else float(x) for x in a]


def lst3_5(a):
    if a is None or a is pd.NA or (np.isscalar(a) and pd.isna(a)):
        return [None] * 5
    return [None if (x is None or x is pd.NA or pd.isna(x)) else float(x) for x in a]


def wilson_lb(n, N, z=1.96):
    if not N or N <= 0 or n is None:
        return None
    p = min(1.0, n / N)
    d = 1 + z * z / N
    c = p + z * z / (2 * N)
    a = z * math.sqrt(max(0.0, p * (1 - p) / N + z * z / (4 * N * N)))
    return max(0.0, (c - a) / d)


con = duckdb.connect()
con.execute("SET memory_limit='2GB'; SET threads=2;")
TMP = H / ".flips_tmp"   # transbordo do duckdb fica dentro de proto/ (apagado no fim)
con.execute(f"SET temp_directory='{TMP}'")
OUT.mkdir(exist_ok=True)

# ── zonas (as mesmas do protótipo: data.json → geo.distritos.properties.r5) ─────────────────────────
DJ = json.loads((H / "data.json").read_text())
ZONA = {f["properties"]["cd"]: f["properties"]["r5"] for f in DJ["geo"]["distritos"]["features"]}
NOME = {f["properties"]["cd"]: f["properties"]["nome"] for f in DJ["geo"]["distritos"]["features"]}
ZONAS = sorted(set(ZONA.values()))
con.execute("create table zona(cd varchar, zona varchar)")
con.executemany("insert into zona values (?, ?)", list(ZONA.items()))

# ── 1. pares (A2_02) + colapso do registro em duas etapas (P-A2-8) ─────────────────────────────────
COLS = """unit_key, usql, seq_c, d_c, d_v, holding_meses, origem, repasse_planta, revenda_valida, ganho_ok, flip, flip24,
  razao_nominal, planta_ev_c, so_planta_c, vvr_c, valor100_c, vvr_v, valor100_v, fin_c, fin_v, tipo_unid, cd_distrito,
  lot_id, codlog, ano_vida, idade_predio_venda, area_v, padrao_cod_v, quartos_est, ganho_nominal_pct, ganho_real_pct,
  excesso_cdi_pct, lucro_real_rs, valor_compra, valor_venda, motivo_fora_ganho, f_compra_no_vvr, f_holding_ate_90d,
  f_cessao_na_venda, sql11_v, acc_ano_v, so_planta_v, planta_ev_v"""
con.execute(f"create table rv as select {COLS} from '{ST}/fase2_revendas.parquet'")
con.execute("""create table two as select unit_key, seq_c, d_c d_pl from rv
  where origem='planta→unidade' and holding_meses <= 12 and razao_nominal between 0.85 and 1.15""")
con.execute("""create table p0 as
select rv.*, (t.unit_key is not null) duas_etapas, nx.d_pl d_planta,
  case when nx.d_pl is not null then date_diff('day', nx.d_pl, rv.d_v) / 30.4375 else rv.holding_meses end hold2
from rv
left join two t on t.unit_key = rv.unit_key and t.seq_c = rv.seq_c
left join two nx on nx.unit_key = rv.unit_key and nx.seq_c + 1 = rv.seq_c""")
con.execute(f"""create table p as
select *,
  -- venda registrada como planta depois de guia de SQL próprio: colisão de unidades na ponte planta → unidade
  -- (ex.: "AP 611" da torre 1 e "APTO 611 - TORRE 2" ligados ao mesmo sql_unid); não é revenda
  (not planta_ev_c and so_planta_v) art_pl,
  revenda_valida and not repasse_planta and not duas_etapas and not (not planta_ev_c and so_planta_v) rv_ok,
  revenda_valida and not repasse_planta and not duas_etapas and not (not planta_ev_c and so_planta_v) and hold2 <= 12 f12,
  revenda_valida and not repasse_planta and not duas_etapas and not (not planta_ev_c and so_planta_v) and hold2 <= 24 f24,
  case when ganho_ok and hold2 >= 6 then 100 * (pow(1 + ganho_real_pct / 100, 12 / hold2) - 1) end real_aa2,
  planta_ev_c or d_planta is not null comprou_planta,
  case when idade_predio_venda <= 3 or origem = 'planta→unidade' or d_planta is not null
         or (idade_predio_venda is null and ano_vida >= year(d_v) - 3) then 'lancamento' else 'madura' end camada,
  ltrim(cd_distrito, '0') cd,
  year(d_v) * 4 + quarter(d_v) - 1 qn,
  case when area_v > 0 then case when area_v <= 45 then '≤45' when area_v <= 70 then '45–70' when area_v <= 100 then '70–100'
       when area_v <= 150 then '100–150' when area_v <= 250 then '150–250' else '>250' end end f_area,
  case when padrao_cod_v between 10 and 45 then ['A','B','C','D','E','F'][(padrao_cod_v::int % 10) + 1] end f_padrao,
  case when idade_predio_venda is null then null when idade_predio_venda <= 3 then '≤3' when idade_predio_venda <= 10 then '4–10'
       when idade_predio_venda <= 20 then '11–20' when idade_predio_venda <= 35 then '21–35' else '>35' end f_idade,
  case when quartos_est is null then null when quartos_est <= 1 then '1' when quartos_est = 2 then '2' when quartos_est = 3 then '3' else '4+' end f_quartos
from p0 where d_v >= '2006-01-01'""")
eff = con.execute(f"""select
  count(*) filter (where flip) flips_a2, count(*) filter (where f12) flips_pos,
  count(*) filter (where duas_etapas) pares_2e, count(*) filter (where duas_etapas and flip) flips_2e,
  count(*) filter (where d_planta is not null) revendas_pos_2e,
  count(*) filter (where d_planta is not null and flip and not f12) sairam_por_holding,
  count(*) filter (where flip24) f24_a2, count(*) filter (where f24) f24_pos,
  count(*) filter (where origem='planta→unidade' and holding_meses > 12 and holding_meses <= 24 and razao_nominal between 0.85 and 1.15 and revenda_valida) pl_2e_12_24,
  count(*) filter (where flip and camada='lancamento' and qn between {Q_FIM - 7} and {Q_FIM}) lanc8_a2,
  count(*) filter (where f12 and camada='lancamento' and qn between {Q_FIM - 7} and {Q_FIM}) lanc8_pos,
  count(*) filter (where flip and camada='madura' and qn between {Q_FIM - 7} and {Q_FIM}) mad8_a2,
  count(*) filter (where f12 and camada='madura' and qn between {Q_FIM - 7} and {Q_FIM}) mad8_pos,
  count(*) filter (where art_pl and flip) flips_art_pl,
  count(*) filter (where flip and tipo_unid in ('apto','planta') and camada='lancamento' and qn between {Q_FIM - 7} and {Q_FIM}) apto_lanc8_a2,
  count(*) filter (where f12 and tipo_unid = 'apto' and camada='lancamento' and qn between {Q_FIM - 7} and {Q_FIM}) apto_lanc8_pos,
  count(*) filter (where origem='planta→unidade' and flip and not duas_etapas and razao_nominal > 1.15 and razao_nominal <= 1.4) pl_flip_razao_115_140
from p""").df().iloc[0].to_dict()
EFF = {k: int(v) for k, v in eff.items()}
log("P-A2-8:", EFF)

# ── 2. denominadores: negócios de unidade pronta por distrito × trimestre × tipo × camada ─────────────
con.execute(f"""create table av as select sql, arg_max(try_cast(ano_vida as int), exercicio) ano_vida,
   arg_max(codlog, exercicio) codlog from read_parquet(['{IPTU}/iptu_2026_slim.parquet', '{IPTU}/iptu_2020_slim.parquet',
   '{IPTU}/iptu_2015_slim.parquet', '{IPTU}/iptu_2010_slim.parquet']) group by 1""")
con.execute(f"""create table ng as
select n.tipo, ltrim(n.cd_distrito, '0') cd, n.lot_id, year(n.data_transacao) * 4 + quarter(n.data_transacao) - 1 qn, a.codlog,
  n.f_area, n.f_padrao, n.f_idade, n.f_quartos,
  case when n.f_idade = '≤3' or (n.f_idade is null and a.ano_vida >= year(n.data_transacao) - 3) then 'lancamento' else 'madura' end camada
from '{ST}/itbi_negocios.parquet' n left join av a on a.sql = n.sql11
where n.tipo in ('apto','casa','sala') and not n.planta and n.data_transacao >= '2006-01-01'""")
log("negócios de unidade pronta:", con.execute("select count(*) from ng").fetchone()[0])

# estoque IPTU (A2_04): distrito × tipo × camada × exercício
EST = con.execute(f"select ex, ltrim(cd_distrito,'0') cd, tipo, camada, n from '{ST}/fase2_estoque.parquet' where tipo in ('apto','casa','sala')").df()
EST["zona"] = EST.cd.map(ZONA)


def est_region(seg, cam):
    """{(region, ex): estoque} para cidade, zonas e distritos."""
    e = EST[(EST.tipo == seg) & (EST.camada == cam)]
    out = {}
    for ex, g in e.groupby("ex"):
        out[("SP", ex)] = float(g.n.sum())
        for z, gz in g.groupby("zona"):
            out[("Z" + z, ex)] = float(gz.n.sum())
        for cd, n in zip(g.cd, g.n):
            out[(cd, ex)] = float(n)
    return out


# ── 3. contagens trimestrais (série e denominadores do cubo) ─────────────────────────────────────
QS = list(range(Q_SER0, Q_FIM + 1))
CNT = {}   # (seg, camada, region) -> DataFrame index q: rel, f312, f1224, rev, neg
for seg in SEGS:
    pc = con.execute(f"""select coalesce(cd, '?') cd, camada, qn,
        count(*) filter (where f24 and hold2 < 3) rel, count(*) filter (where f12 and hold2 >= 3) f312,
        count(*) filter (where f24 and hold2 > 12) f1224, count(*) filter (where rv_ok) rev
      from p where tipo_unid = '{seg}' and qn between {Q_SER0} and {Q_FIM} group by 1, 2, 3""").df()
    nc = con.execute(f"""select coalesce(cd, '?') cd, camada, qn, count(*) neg from ng where tipo = '{seg}'
      and qn between {Q_SER0} and {Q_FIM} group by 1, 2, 3""").df()
    m = pc.merge(nc, on=["cd", "camada", "qn"], how="outer").fillna(0)
    m["zona"] = m.cd.map(ZONA)
    for cam in ("madura", "lancamento"):
        mc = m[m.camada == cam]
        regs = {"SP": mc}
        for z in ZONAS:
            regs["Z" + z] = mc[mc.zona == z]
        for cd in ZONA:
            regs[cd] = mc[mc.cd == cd]
        for reg, g in regs.items():
            CNT[(seg, cam, reg)] = g.groupby("qn")[["rel", "f312", "f1224", "rev", "neg"]].sum().reindex(QS, fill_value=0).astype(int)
    for reg in ["SP"] + ["Z" + z for z in ZONAS] + list(ZONA):
        CNT[(seg, "todas", reg)] = CNT[(seg, "madura", reg)] + CNT[(seg, "lancamento", reg)]
log("contagens trimestrais ok")

# série: cidade + distritos, madura e lançamento (todas = soma no navegador)
for seg in SEGS:
    ser = {"q0": qlabel(Q_SER0), "q1": qlabel(Q_FIM), "k": ["rel", "f312", "f1224", "rev", "neg"], "r": {}}
    for reg in ["SP"] + list(ZONA):
        ser["r"][reg] = {cam: [CNT[(seg, cam, reg)][k].tolist() for k in ser["k"]] for cam in ("madura", "lancamento")}
    n = dump(OUT / f"serie_{seg}.json", ser)
    log(f"serie_{seg}.json {n / 1e3:.0f} kB")

# ── 4. cubo região × janela × trimestre final ──────────────────────────────────────────────────────
MET = ["n", "ng", "h25", "h50", "h75", "r25", "r50", "r75", "n25", "n50", "n75", "c25", "c50", "c75",
       "bate", "perda", "cvvr", "vvvr", "finc", "finv", "lucro", "aa", "x25", "x50", "x75"]


def agg(h):
    fh = f"hold2 <= {h}"
    ok = f"{fh} and ganho_ok"
    return f"""count(*) filter (where {fh}) n{h}, count(*) filter (where {ok}) ng{h},
  quantile_cont(hold2, [0.25, 0.5, 0.75]) filter (where {fh}) h{h},
  quantile_cont(ganho_real_pct, [0.25, 0.5, 0.75]) filter (where {ok}) r{h},
  quantile_cont(ganho_nominal_pct, [0.25, 0.5, 0.75]) filter (where {ok}) nm{h},
  quantile_cont(excesso_cdi_pct, [0.25, 0.5, 0.75]) filter (where {ok}) c{h},
  100 * avg((excesso_cdi_pct > 0)::int) filter (where {ok}) bate{h},
  100 * avg((ganho_real_pct < 0)::int) filter (where {ok}) perda{h},
  median(valor100_c / vvr_c) filter (where {ok} and vvr_c > 0 and not so_planta_c) cvvr{h},
  median(valor100_v / vvr_v) filter (where {ok} and vvr_v > 0) vvvr{h},
  100 * avg((coalesce(fin_c, 0) > 0)::int) filter (where {fh}) finc{h},
  100 * avg((coalesce(fin_v, 0) > 0)::int) filter (where {fh}) finv{h},
  median(lucro_real_rs) filter (where {ok}) lucro{h},
  median(real_aa2) filter (where {ok} and hold2 >= 6) aa{h},
  quantile_cont(alfa_pct, [0.25, 0.5, 0.75]) filter (where {ok}) x{h}"""


def mrow(r, h):
    hq, rq, nq, cq, xq = lst3(r[f"h{h}"]), lst3(r[f"r{h}"]), lst3(r[f"nm{h}"]), lst3(r[f"c{h}"]), lst3(r[f"x{h}"])
    return [ri(r[f"n{h}"]), ri(r[f"ng{h}"]), r1(hq[0]), r1(hq[1]), r1(hq[2]), r1(rq[0]), r1(rq[1]), r1(rq[2]),
            r1(nq[0]), r1(nq[1]), r1(nq[2]), r1(cq[0]), r1(cq[1]), r1(cq[2]), r1(r[f"bate{h}"]), r1(r[f"perda{h}"]),
            r2(r[f"cvvr{h}"]), r2(r[f"vvvr{h}"]), r1(r[f"finc{h}"]), r1(r[f"finv{h}"]), rk(r[f"lucro{h}"]), r1(r[f"aa{h}"]),
            r1(xq[0]), r1(xq[1]), r1(xq[2])]


# ── alfa do flip (P-A2-12): ganho nominal contra a variação do índice TTM de R$/m² do distrito × tipo ────────
# índice = mediana móvel de 12 meses (4 trimestres) do R$/m² dos negócios no preço (mesma regra do protótipo); distrito
# com n < 10 no trimestre usa a cidade × tipo. mercado = idx(tri da venda) ÷ idx(tri da compra) − 1; alfa = (1+g)/(1+mercado) − 1.
con.execute(f"""create table px as select tipo, ltrim(cd_distrito, '0') cd, year(data_transacao) * 4 + quarter(data_transacao) - 1 qn, rsm2
  from '{ST}/itbi_negocios.parquet' where preco_ok and tipo in ('apto','casa','sala') and rsm2 > 0""")
con.execute("""create table idx as
  select tipo, cd, px.qn + k.k q, median(rsm2) m, count(*) n from px join range(0, 4) k(k) on true where cd is not null group by 1, 2, 3
  union all select tipo, 'SP', px.qn + k.k q, median(rsm2), count(*) from px join range(0, 4) k(k) on true group by 1, 3""")
con.execute(f"""create table alfa as
select p.unit_key, p.seq_c,
  coalesce(case when ic.n >= 10 and iv.n >= 10 then iv.m / ic.m end, jv.m / jc.m) - 1 mercado
from p
left join idx ic on ic.tipo = p.tipo_unid and ic.cd = p.cd and ic.q = greatest(year(p.d_c) * 4 + quarter(p.d_c) - 1, {2006 * 4 + 3})
left join idx iv on iv.tipo = p.tipo_unid and iv.cd = p.cd and iv.q = p.qn
left join idx jc on jc.tipo = p.tipo_unid and jc.cd = 'SP' and jc.q = greatest(year(p.d_c) * 4 + quarter(p.d_c) - 1, {2006 * 4 + 3})
left join idx jv on jv.tipo = p.tipo_unid and jv.cd = 'SP' and jv.q = p.qn
where p.f24 and p.tipo_unid in ('apto','casa','sala')""")
con.execute("""create table p2 as select p.*, a.mercado * 100 mercado_pct,
   case when p.ganho_ok and a.mercado is not null then 100 * ((1 + p.ganho_nominal_pct / 100) / (1 + a.mercado) - 1) end alfa_pct
 from p left join alfa a on a.unit_key = p.unit_key and a.seq_c = p.seq_c""")
con.execute("drop table p"); con.execute("alter table p2 rename to p")
AL = con.execute(f"""select count(*) filter (where f12 and ganho_ok) ng, count(*) filter (where f12 and alfa_pct is not null) na,
   median(alfa_pct) filter (where f12) alfa_med, median(mercado_pct) filter (where f12 and ganho_ok) merc_med,
   median(ganho_nominal_pct) filter (where f12 and ganho_ok) nom_med
 from p where tipo_unid = 'apto' and camada = 'madura' and qn between {Q_FIM - 7} and {Q_FIM}""").df().iloc[0].to_dict()
ALFA = {k: (round(float(v), 1) if isinstance(v, float) else int(v)) for k, v in AL.items()}
log("alfa (apto madura 8T):", ALFA)

WIN_ALL, WIN_D = (1, 4, 8), (4, 8)
con.execute(f"create table pc as select p.*, z.zona from p left join zona z on z.cd = p.cd where f24 and qn between {Q0C - 7} and {Q_FIM}")
CUBE_CHECK, HEAD = {}, {}
for seg in SEGS:
    for cam, cf in CAMADAS.items():
        a = con.execute(f"""
with x as (select pc.*, pc.qn + k.k q, w.w from pc join (values (1),(4),(8)) w(w) on true
           join range(0, 8) k(k) on k.k < w.w where tipo_unid = '{seg}' and {cf}),
y as (select 'SP' reg, * from x union all select 'Z' || zona reg, * from x where zona is not null
      union all select cd reg, * from x where cd is not null and w in (4, 8))
select reg, q, w, {agg(12)}, {agg(24)}, count(*) filter (where hold2 < 3) rel
from y where q between {Q0C} and {Q_FIM} group by 1, 2, 3""").df()
        est = est_region(seg, cam)
        by = {(r.reg, r.w, r.q): r for r in a.itertuples(index=False)}
        cols = list(a.columns)
        regs = [("SP", WIN_ALL)] + [("Z" + z, WIN_ALL) for z in ZONAS] + [(cd, WIN_D) for cd in ZONA]
        R = {}
        for reg, wins in regs:
            cnt = CNT[(seg, cam, reg)]
            R[reg] = {}
            for w in wins:
                roll = cnt[["rev", "neg"]].rolling(w, min_periods=1).sum()
                rows = []
                for q in range(Q0C, Q_FIM + 1):
                    t = by.get((reg, w, q))
                    e = est.get((reg, ex_de(q // 4)))
                    rev, neg = int(roll.loc[q, "rev"]), int(roll.loc[q, "neg"])
                    if t is None:
                        rows.append([0, 0] + [None] * (len(MET) - 2) + [0, 0] + [None] * (len(MET) - 2) + [0, rev, neg, ri(e)])
                        continue
                    d = dict(zip(cols, t))
                    rows.append(mrow(d, 12) + mrow(d, 24) + [ri(d["rel"]), rev, neg, ri(e)])
                R[reg][str(w)] = rows
        doc = {"seg": seg, "camada": cam, "q": [qlabel(q) for q in range(Q0C, Q_FIM + 1)], "w_dist": list(WIN_D), "w_all": list(WIN_ALL),
               "m": [f"{m}12" for m in MET] + [f"{m}24" for m in MET] + ["rel", "rev", "neg", "est"], "r": R}
        n = dump(OUT / "d" / f"{seg}_{cam}.json", doc)
        HEAD.setdefault(seg, {})[cam] = {str(w): {reg: [R[reg][str(w)][-1], R[reg][str(w)][-5]] for reg in R if str(w) in R[reg]} for w in (4, 8)}
        sp8 = R["SP"]["8"][-1]
        CUBE_CHECK[f"{seg}_{cam}"] = {"flips8T": sp8[0], "est": sp8[-1], "rate": round(sp8[0] / sp8[-1] * 500, 2) if sp8[-1] else None,
                                      "pct_neg": round(100 * sp8[0] / sp8[-2], 2) if sp8[-2] else None, "real_med": sp8[6],
                                      "pct_rev": round(100 * sp8[0] / sp8[-3], 1) if sp8[-3] else None, "hold_med": sp8[3], "rel": sp8[-4]}
        log(f"d/{seg}_{cam}.json {n / 1e3:.0f} kB · cidade 8T: {CUBE_CHECK[f'{seg}_{cam}']}")

# distrito.json: recorte "manchete" do cubo (janelas 4T e 8T até o último trimestre + a mesma janela 4T antes, para o d4)
n = dump(OUT / "distrito.json", {"q": qlabel(Q_FIM), "q_d4": qlabel(Q_FIM - 4), "m": [f"{m}12" for m in MET] + [f"{m}24" for m in MET] + ["rel", "rev", "neg", "est"],
                                 "nota": "r[seg][camada][janela][região] = [linha no trimestre final, linha 4T antes]; regiões: SP, Z<zona>, código do distrito; "
                                         "taxa = n/est×1.000×4/janela; % negócios = n/neg; % revendas = n/rev; sufixo 12/24 = holding máximo",
                                 "r": HEAD})
log(f"distrito.json {n / 1e3:.0f} kB")

# ── 4b. distribuição do ganho por faixa de holding (cidade; janela 1T/4T/8T até cada um dos últimos 20T) ──────
QD0 = Q_FIM - 19
BANDS = ["< 3 m", "3–6 m", "6–12 m", "12–24 m"]
dist = {"q": [qlabel(q) for q in range(QD0, Q_FIM + 1)], "b": BANDS, "f": ["n", "perda", "r", "nm", "c", "na", "a", "x"], "t": {}}
for seg in SEGS:
    for cam, cf in CAMADAS.items():
        a = con.execute(f"""
with x as (select pc.*, pc.qn + k.k q, w.w from pc join (values (1),(4),(8)) w(w) on true join range(0, 8) k(k) on k.k < w.w
           where tipo_unid = '{seg}' and {cf} and ganho_ok)
select q, w, case when hold2 < 3 then 0 when hold2 < 6 then 1 when hold2 <= 12 then 2 else 3 end b, count(*) n,
  100 * avg((ganho_real_pct < 0)::int) perda,
  quantile_cont(ganho_real_pct, [0.1, 0.25, 0.5, 0.75, 0.9]) r, quantile_cont(ganho_nominal_pct, [0.1, 0.25, 0.5, 0.75, 0.9]) nm,
  quantile_cont(excesso_cdi_pct, [0.1, 0.25, 0.5, 0.75, 0.9]) c, count(*) filter (where hold2 >= 6) na,
  quantile_cont(real_aa2, [0.1, 0.25, 0.5, 0.75, 0.9]) filter (where hold2 >= 6) a,
  quantile_cont(alfa_pct, [0.1, 0.25, 0.5, 0.75, 0.9]) xa
from x where q between {QD0} and {Q_FIM} group by 1, 2, 3""").df()
        by = {(r.q, r.w, r.b): r for r in a.itertuples(index=False)}
        for w in (1, 4, 8):
            rows = []
            for q in range(QD0, Q_FIM + 1):
                bl = []
                for b in range(4):
                    r = by.get((q, w, b))
                    if r is None:
                        bl.append([0, None, None, None, None, 0, None, None])
                        continue
                    qq = lambda v: [r1(x) for x in lst3_5(v)]
                    bl.append([int(r.n), r1(r.perda), qq(r.r), qq(r.nm), qq(r.c), int(r.na), qq(r.a) if r.na else None, qq(r.xa)])
                rows.append(bl)
            dist["t"][f"{seg}|{cam}|{w}"] = rows
n = dump(OUT / "dist.json", dist)
log(f"dist.json {n / 1e3:.0f} kB")

# ── 5. rankings: ruas (codlog) e prédios (condomínio) · janelas 8T e 20T até 2T2026 ──────────────────
con.execute(f"""create table i26 as select sql, codlog, logradouro, numero, complemento,
  case when lower(uso) like 'apartamento%' or lower(uso) like 'flat residencial%' then 'apto'
       when lower(uso) in ('residência','residencia') or lower(uso) like 'residência coletiva%' or lower(uso) like 'residência e outro%'
            or lower(uso) like 'cortiço%' then 'casa'
       when lower(uso) like 'escritório%' or lower(uso) like 'flat%' then 'sala' end tipo,
  case when try_cast(acc as int) >= 2023 then 'lancamento' else 'madura' end camada,
  case when condominio is not null and condominio not in ('00-0','') then substr(sql,1,6)||'0000'||substr(condominio,1,2)
       else substr(sql,1,10)||'00' end lot_id
from '{IPTU}/iptu_2026_slim.parquet'""")
con.execute("create table est_rua as select codlog, tipo, camada, count(*) n from i26 where tipo is not null group by 1,2,3")
con.execute("create table est_lot as select lot_id, tipo, camada, count(*) n from i26 where tipo is not null group by 1,2,3")
RUA_NOME = dict(con.execute("select codlog, mode(logradouro) from i26 group by 1").fetchall())
LOT_END = dict(con.execute("""select lot_id, mode(trim(logradouro) || ' ' || coalesce(ltrim(numero, '0'), '')) from i26
                              where substr(lot_id, 7, 4) = '0000' group by 1""").fetchall())
PERF = con.execute(f"""select setor||quadra||'0000'||c2 lot_id, n_unid, n_apto, pav, acc, padrao from '{ST}/condo_perfil_2026.parquet'""").df().set_index("lot_id")
log("IPTU 2026 (rua/prédio) ok")


def ranking(kind):
    key_p = "codlog" if kind == "rua" else "case when substr(lot_id, 7, 4) = '0000' then lot_id end"
    key_n = "codlog" if kind == "rua" else "case when substr(lot_id, 7, 4) = '0000' then lot_id end"
    est_t = "est_rua" if kind == "rua" else "est_lot"
    est_k = "codlog" if kind == "rua" else "lot_id"
    rows = []
    for seg in SEGS:
        for cam, cf in CAMADAS.items():
            ce = "true" if cam == "todas" else f"camada = '{cam}'"
            e = dict(con.execute(f"select {est_k}, sum(n) from {est_t} where tipo = '{seg}' and {ce} group by 1").fetchall())
            for w in (8, 20):
                lo = Q_FIM - w + 1
                for h in (12, 24):
                    a = con.execute(f"""select {key_p} k, count(*) filter (where hold2 <= {h}) n, count(*) filter (where hold2 < 3) rel,
                        count(*) filter (where hold2 <= {h} and ganho_ok) ng, median(hold2) filter (where hold2 <= {h}) hmed,
                        quantile_cont(ganho_real_pct, [0.25, 0.5, 0.75]) filter (where hold2 <= {h} and ganho_ok) rq,
                        100 * avg((excesso_cdi_pct > 0)::int) filter (where hold2 <= {h} and ganho_ok) bate,
                        mode(cd) cd, max(acc_ano_v) acc
                      from p where f24 and tipo_unid = '{seg}' and {cf} and qn between {lo} and {Q_FIM} and {key_p} is not null
                      group by 1 having count(*) filter (where hold2 <= {h}) >= 3""").df()
                    if a.empty:
                        continue
                    rv = dict(con.execute(f"""select {key_p}, count(*) from p where rv_ok and tipo_unid = '{seg}' and {cf}
                        and qn between {lo} and {Q_FIM} and {key_p} is not null group by 1""").fetchall())
                    ngc = dict(con.execute(f"""select {key_n}, count(*) from ng where tipo = '{seg}' and {cf}
                        and qn between {lo} and {Q_FIM} and {key_n} is not null group by 1""").fetchall())
                    for r in a.itertuples(index=False):
                        N = e.get(r.k)
                        N = float(N) if N is not None else None
                        rq = lst3(r.rq)
                        lb = wilson_lb(r.n, N) if N else None
                        rows.append({"seg": seg, "cam": cam, "w": w, "h": h, "k": r.k, "cd": r.cd, "n": int(r.n), "rel": int(r.rel),
                                     "ng": int(r.ng), "hmed": r1(r.hmed), "r25": r1(rq[0]), "r50": r1(rq[1]), "r75": r1(rq[2]),
                                     "bate": r1(r.bate), "est": ri(N), "rev": rv.get(r.k, 0), "neg": ngc.get(r.k, 0),
                                     "rate": r2(r.n / N * 1000 * 4 / w) if N else None, "lb": r2(lb * 1000 * 4 / w) if lb is not None else None,
                                     "acc": ri(r.acc)})
    return rows


FIELDS_R = ["k", "cd", "n", "rel", "ng", "hmed", "r25", "r50", "r75", "bate", "est", "rev", "neg", "rate", "lb"]
rr = ranking("rua")
ruas = {"f": FIELDS_R + ["nome"], "t": {}}
for r in rr:
    ruas["t"].setdefault(f"{r['seg']}|{r['cam']}|{r['w']}|{r['h']}", []).append([r[f] for f in FIELDS_R] + [RUA_NOME.get(r["k"])])
n = dump(OUT / "ruas.json", ruas)
log(f"ruas.json {n / 1e3:.0f} kB · {len(rr)} linhas")
pp = ranking("predio")
FIELDS_P = FIELDS_R + ["acc"]
pred = {"f": FIELDS_P + ["end", "unid", "pav", "padrao"], "t": {}}
for r in pp:
    pf = PERF.loc[r["k"]] if r["k"] in PERF.index else None
    pad = None
    if pf is not None and isinstance(pf.padrao, str):
        pad = pf.padrao.split("padrão")[-1].strip() if "padrão" in pf.padrao else None
    acc = ri(pf.acc) if pf is not None and pf.acc else r["acc"]
    row = [r[f] for f in FIELDS_R] + [acc, LOT_END.get(r["k"]), ri(pf.n_unid) if pf is not None else None,
                                      ri(pf.pav) if pf is not None else None, pad]
    pred["t"].setdefault(f"{r['seg']}|{r['cam']}|{r['w']}|{r['h']}", []).append(row)
n = dump(OUT / "predios.json", pred)
log(f"predios.json {n / 1e3:.0f} kB · {len(pp)} linhas")

# ── 6. tipologia: faixa × trimestre (8T) na cidade ─────────────────────────────────────────────────
TQ = list(range(Q_FIM - 7, Q_FIM + 1))
tip = {"q": [qlabel(q) for q in TQ], "dims": DIMS, "f": ["n", "neg", "rel"], "tot_f": ["n", "neg", "rev", "ng", "r25", "r50", "r75", "hmed", "rel"], "t": {}}
for seg in SEGS:
    for cam, cf in CAMADAS.items():
        for dim, fx in DIMS.items():
            if dim == "quartos" and seg != "apto":
                continue
            fp = f"f_{dim}"
            a = con.execute(f"""select {fp} fx, qn, count(*) filter (where f12) n12, count(*) filter (where f24) n24,
                count(*) filter (where f24 and hold2 < 3) rel from p where tipo_unid = '{seg}' and {cf} and qn between {TQ[0]} and {Q_FIM}
                and {fp} is not null group by 1, 2""").df()
            ngq = con.execute(f"""select {fp} fx, qn, count(*) neg from ng where tipo = '{seg}' and {cf} and qn between {TQ[0]} and {Q_FIM}
                and {fp} is not null group by 1, 2""").df()
            tot = con.execute(f"""select {fp} fx, count(*) filter (where f12) n12, count(*) filter (where f24) n24,
                count(*) filter (where rv_ok) rev, count(*) filter (where f12 and ganho_ok) ng12, count(*) filter (where f24 and ganho_ok) ng24,
                quantile_cont(ganho_real_pct, [0.25, 0.5, 0.75]) filter (where f12 and ganho_ok) r12,
                quantile_cont(ganho_real_pct, [0.25, 0.5, 0.75]) filter (where f24 and ganho_ok) r24,
                median(hold2) filter (where f12) h12, median(hold2) filter (where f24) h24, count(*) filter (where f24 and hold2 < 3) rel
                from p where tipo_unid = '{seg}' and {cf} and qn between {TQ[0]} and {Q_FIM} and {fp} is not null group by 1""").df().set_index("fx")
            ngt = ngq.groupby("fx").neg.sum()
            A = {(r.fx, r.qn): r for r in a.itertuples(index=False)}
            N = {(r.fx, r.qn): r.neg for r in ngq.itertuples(index=False)}
            for h in (12, 24):
                cells, tots = [], []
                for f in fx:
                    cells.append([[ri(getattr(A[(f, q)], f"n{h}")) if (f, q) in A else 0, ri(N.get((f, q), 0)),
                                   ri(A[(f, q)].rel) if (f, q) in A else 0] for q in TQ])
                    if f in tot.index:
                        t = tot.loc[f]
                        rq = lst3(t[f"r{h}"])
                        tots.append([ri(t[f"n{h}"]), ri(ngt.get(f, 0)), ri(t.rev), ri(t[f"ng{h}"]), r1(rq[0]), r1(rq[1]), r1(rq[2]), r1(t[f"h{h}"]), ri(t.rel)])
                    else:
                        tots.append([0, ri(ngt.get(f, 0)), 0, 0, None, None, None, None, 0])
                tip["t"][f"{seg}|{cam}|{h}|{dim}"] = {"c": cells, "tot": tots}
n = dump(OUT / "tipologia.json", tip)
log(f"tipologia.json {n / 1e3:.0f} kB")

# ── 7. planta: comprou na planta → revendeu, por prédio e na cidade ─────────────────────────────────
PL_Q = f"""(origem = 'planta→unidade' and not duas_etapas and revenda_valida) or (d_planta is not null and rv_ok)"""
pl = con.execute(f"""select lot_id, count(*) filter (where {PL_Q}) n_pl,
   count(*) filter (where origem = 'planta→unidade' and not duas_etapas and revenda_valida) n_pd,
   count(*) filter (where d_planta is not null and rv_ok) n_pc,
   count(*) filter (where duas_etapas) n_2e,
   count(*) filter (where ({PL_Q}) and hold2 <= 12) n_pl12,
   quantile_cont(hold2, [0.25, 0.5, 0.75]) filter (where {PL_Q}) hq,
   count(*) filter (where ({PL_Q}) and ganho_ok) ng,
   quantile_cont(ganho_real_pct, [0.25, 0.5, 0.75]) filter (where ({PL_Q}) and ganho_ok) rq,
   count(*) filter (where rv_ok and idade_predio_venda between 0 and 3) n_rev3,
   count(*) filter (where rv_ok and idade_predio_venda between 0 and 3 and hold2 <= 12) n_rev3_12,
   max(acc_ano_v) acc, min(d_c) filter (where planta_ev_c) d_pl0, max(d_v) d_last, mode(cd) cd
 from p where lot_id is not null group by 1
 having count(*) filter (where {PL_Q} or duas_etapas) > 0 or count(*) filter (where rv_ok and idade_predio_venda between 0 and 3) > 0""").df()
q3 = lst3
PF = ["cd", "acc", "unid", "n_pl", "n_pd", "n_pc", "n_2e", "n_pl12", "h25", "h50", "h75", "ng", "r25", "r50", "r75", "n_rev3", "n_rev3_12", "d_pl0", "d_last"]
plots = {}
for r in pl.itertuples(index=False):
    hq, rq = q3(r.hq), q3(r.rq)
    pf = PERF.loc[r.lot_id] if r.lot_id in PERF.index else None
    plots[r.lot_id] = [r.cd, ri(pf.acc) if pf is not None and pf.acc else ri(r.acc), ri(pf.n_unid) if pf is not None else None,
                       int(r.n_pl), int(r.n_pd), int(r.n_pc), int(r.n_2e), int(r.n_pl12), r1(hq[0]), r1(hq[1]), r1(hq[2]), int(r.ng),
                       r1(rq[0]), r1(rq[1]), r1(rq[2]), int(r.n_rev3), int(r.n_rev3_12),
                       None if pd.isna(r.d_pl0) else int((pd.Timestamp(r.d_pl0) - DAY0).days), int((pd.Timestamp(r.d_last) - DAY0).days)]
cid = con.execute(f"""select count(*) filter (where {PL_Q}) n_pl, count(*) filter (where origem = 'planta→unidade' and not duas_etapas and revenda_valida) n_pd,
   count(*) filter (where d_planta is not null and rv_ok) n_pc, count(*) filter (where duas_etapas) n_2e,
   count(*) filter (where ({PL_Q}) and hold2 <= 12) n_pl12,
   median(hold2) filter (where {PL_Q}) h50, quantile_cont(hold2, 0.25) filter (where {PL_Q}) h25, quantile_cont(hold2, 0.75) filter (where {PL_Q}) h75,
   count(*) filter (where ({PL_Q}) and ganho_ok) ng,
   median(ganho_real_pct) filter (where ({PL_Q}) and ganho_ok) r50, quantile_cont(ganho_real_pct, 0.25) filter (where ({PL_Q}) and ganho_ok) r25,
   quantile_cont(ganho_real_pct, 0.75) filter (where ({PL_Q}) and ganho_ok) r75,
   median(ganho_real_pct) filter (where ({PL_Q}) and ganho_ok and hold2 <= 12) r50_12, count(*) filter (where ({PL_Q}) and ganho_ok and hold2 <= 12) ng12,
   median(hold2) filter (where ({PL_Q}) and hold2 <= 12) h50_12,
   100 * avg((excesso_cdi_pct > 0)::int) filter (where ({PL_Q}) and ganho_ok) bate,
   count(*) filter (where rv_ok and idade_predio_venda between 0 and 3) n_rev3,
   count(*) filter (where rv_ok and idade_predio_venda between 0 and 3 and hold2 <= 12) n_rev3_12
 from p""").df().iloc[0].to_dict()
safra = con.execute(f"""select year(coalesce(d_planta, d_c)) safra, count(*) n, median(hold2) h50,
   count(*) filter (where ganho_ok) ng, median(ganho_real_pct) filter (where ganho_ok) r50
 from p where {PL_Q} group by 1 having count(*) >= 5 order by 1""").df()
ident = json.loads((ST / "fase2_identidade.json").read_text())
ponte = [{"ano": int(x["ano"]), "planta": int(x["planta"]), "ligadas": int(x["ligadas"]), "pct": float(x["pct_ligada"])} for x in ident["ponte_por_safra"]]
planta = {"f": PF, "lots": plots,
          "cidade": {k: (r1(v) if isinstance(v, float) else int(v)) for k, v in cid.items()},
          "safra": [[int(r.safra), int(r.n), r1(r.h50), int(r.ng), r1(r.r50)] for r in safra.itertuples(index=False)],
          "ponte": ponte}
n = dump(OUT / "planta.json", planta)
log(f"planta.json {n / 1e3:.0f} kB · {len(plots)} lotes · cidade {planta['cidade']}")

# ── 8. lotes/{cd}.json: resumo de 5 anos e cadeias por unidade ──────────────────────────────────────
MOT = [m for m in con.execute("select distinct motivo_fora_ganho from p where motivo_fora_ganho is not null order by 1").fetchall()]
MOT = [m[0] for m in MOT]
MIDX = {m: i for i, m in enumerate(MOT)}
FLAGS = ["flip ≤ 12 m", "revenda rápida ≤ 24 m", "revenda válida", "ganho calculável", "compra na planta",
         "registro em duas etapas (P-A2-8)", "holding desde a planta", "repasse planta → planta", "compra declarada no VVR",
         "compra financiada", "venda financiada", "cessão de direitos na venda (natureza 2)", "holding ≤ 90 dias",
         "venda registrada como planta após SQL próprio (colisão de unidades; fora)"]
D5 = (pd.Timestamp(ULTIMA) - pd.DateOffset(years=5) - DAY0).days
ent = con.execute(f"select * from '{ST}/fase2_entrega_predio.parquet'").df().set_index("lot_id")
con.execute("create table lab as select sql, any_value(complemento) cp from i26 where complemento is not null and trim(complemento) <> '' group by 1")
con.execute(f"""create table lab2 as select sql11 as "sql", arg_max(complemento, data_transacao) cp from '{ST}/itbi_negocios.parquet'
   where not planta and complemento is not null group by 1""")
con.execute(f"""create table lab3 as select sql_unid as "sql", arg_max(complemento, data_transacao) cp from '{ST}/itbi_negocios.parquet'
   where planta and sql_unid is not null and complemento is not null group by 1""")
L = con.execute(f"""select p.cd, p.lot_id, p.unit_key,
   trim(coalesce(l1.cp, l2.cp, l3.cp, case when p.usql is not null then 'SQL ' || p.usql else ltrim(split_part(p.unit_key, '|', 2), 'C') end)) lb,
   (date_diff('day', DATE '2006-01-01', p.d_c::date))::int dc, (date_diff('day', DATE '2006-01-01', p.d_v::date))::int dv,
   round(p.valor_compra / 100) * 100 vc, round(p.valor_venda / 100) * 100 vv, round(p.hold2, 1) h,
   case when p.ganho_ok then round(p.ganho_real_pct, 1) end gr, case when p.ganho_ok then round(p.ganho_nominal_pct, 1) end gn,
   (p.f12::int) + 2 * (p.f24::int) + 4 * (p.rv_ok::int) + 8 * (p.ganho_ok::int) + 16 * (p.planta_ev_c::int) + 32 * (p.duas_etapas::int)
     + 64 * ((p.d_planta is not null)::int) + 128 * (p.repasse_planta::int) + 256 * (coalesce(p.f_compra_no_vvr, false)::int)
     + 512 * ((coalesce(p.fin_c, 0) > 0)::int) + 1024 * ((coalesce(p.fin_v, 0) > 0)::int) + 2048 * (coalesce(p.f_cessao_na_venda, false)::int)
     + 4096 * (coalesce(p.f_holding_ate_90d, false)::int) + 8192 * (p.art_pl::int) fl,
   p.motivo_fora_ganho mot, case when p.vvr_c > 0 and not p.so_planta_c then round(p.valor100_c / p.vvr_c, 2) end cvvr
 from p left join lab l1 on l1.sql = p.usql left join lab2 l2 on l2.sql = p.usql left join lab3 l3 on l3.sql = p.usql
 where p.lot_id is not null and p.cd is not null order by p.cd, p.lot_id, lb, p.unit_key, p.d_c""").df()
S5 = con.execute(f"""select lot_id, count(*) filter (where f12 and d_v >= DATE '2006-01-01' + {D5}) n12,
   count(*) filter (where f24 and d_v >= DATE '2006-01-01' + {D5}) n24,
   count(*) filter (where f24 and hold2 < 3 and d_v >= DATE '2006-01-01' + {D5}) rel,
   median(hold2) filter (where f12 and d_v >= DATE '2006-01-01' + {D5}) hmed,
   median(ganho_real_pct) filter (where f12 and ganho_ok and d_v >= DATE '2006-01-01' + {D5}) gmed,
   count(*) filter (where f12 and ganho_ok and d_v >= DATE '2006-01-01' + {D5}) ng,
   count(*) npar, count(distinct unit_key) nun, count(*) filter (where rv_ok) nrev, count(*) filter (where f12) n12all
 from p where lot_id is not null and cd is not null group by 1""").df().set_index("lot_id")
S5d = {r.Index: [ri(r.n12), ri(r.n24), ri(r.rel), r1(r.hmed), r1(r.gmed), ri(r.ng), ri(r.npar), ri(r.nun), ri(r.nrev), ri(r.n12all)]
       for r in S5.itertuples()}
ENT = {r.Index: [ri(r.acc), ri(r.n_apto), r1(r.pct_1a), r1(r.pct_3a), r1(r.pct_nunca), r2(r.med_anos_1a_venda)] for r in ent.itertuples()}
cols = [L[c].to_numpy() for c in ("cd", "lot_id", "unit_key", "lb", "dc", "dv", "vc", "vv", "h", "gr", "gn", "fl", "mot", "cvvr")]
tot_kb, big, ncd = 0, (None, 0), 0


def flush(cd, lots, anel):
    global tot_kb, big, ncd
    if cd is None:
        return
    n = dump(OUT / "lotes" / f"{cd}.json", {"cd": cd, "lots": lots})
    dump(OUT / "anel" / f"{cd}.json", {"cd": cd, "f": ["n12", "n24", "rel", "hmed", "gmed", "ng"], "lots": anel})
    tot_kb += n / 1e3
    ncd += 1
    if n > big[1]:
        big = (cd, n)


cur_cd, lots, anel, cur_lot, cur_unit, ulist = None, {}, {}, None, None, None
for cd, lid, uk, lb, dc, dv, vc, vv, h, gr, gn, fl, mot, cvvr in zip(*cols):
    if cd != cur_cd:
        flush(cur_cd, lots, anel)
        cur_cd, lots, anel, cur_lot, cur_unit = cd, {}, {}, None, None
    if lid != cur_lot:
        cur_lot, cur_unit = lid, None
        sm = S5d.get(lid)
        lots[lid] = {"s": sm, "u": []}
        if lid in ENT:
            lots[lid]["e"] = ENT[lid]
        if sm and sm[1]:
            anel[lid] = sm[:6]
    if uk != cur_unit:
        cur_unit = uk
        ulist = []
        lots[lid]["u"].append([lb, ulist])
    ulist.append([int(dc), int(dv), rk(vc), rk(vv), r1(h), r1(gr), r1(gn), int(fl),
                  MIDX.get(mot) if isinstance(mot, str) else None, r2(cvvr)])
flush(cur_cd, lots, anel)
log(f"lotes/ e anel/: {ncd} distritos · {tot_kb / 1e3:.1f} MB · maior {big[0]} = {big[1] / 1e6:.2f} MB")

# giro anual por idade do prédio (cidade; A2_05): vendas de SQL próprio ÷ apartamentos, prédios ACC 2008–2019
giro = con.execute(f"""with un as (select sql, try_cast(acc as int) acc from '{IPTU}/iptu_2026_slim.parquet'
     where condominio not in ('00-0','') and lower(uso) like 'apartamento%' and try_cast(acc as int) between 2008 and 2019),
   s as (select n.sql11 as "sql", year(n.data_transacao) ano from '{ST}/itbi_negocios.parquet' n where not n.planta)
 select least(s.ano - un.acc, 10) idade, round(100.0 * count(*) / (select count(*) from un), 2) giro
 from s join un using (sql) where s.ano between un.acc and un.acc + 10 and s.ano <= 2025 group by 1 order by 1""").fetchall()
hz = con.execute(f"select m, hazard_pct, excesso_pct from '{ST}/fase2_hazard.parquet' where m < 37 order by m").fetchall()

meta = {
    "definicao": ("Flip = a mesma unidade (SQL) comprada e revendida (natureza compra e venda) com holding ≤ 12 meses, em par válido "
                  "(sem valor simbólico, retificação, mesmo valor exato, proporção parcial, colisão ou vários negócios no dia), fora do "
                  "repasse planta → planta, do registro em duas etapas (planta → 1ª guia do SQL em ≤ 12 m com valor 0,85–1,15×; holding "
                  "da revenda seguinte medido desde a planta) e da venda registrada como planta após SQL próprio. Revenda rápida = ≤ 24 m. "
                  "Relâmpago = < 3 m (maior risco de artefato). Ganho = valor declarado nas guias (bruto)."),
    "alfa": ALFA,
    "fonte": "Guias de ITBI (natureza compra e venda) 2006 a 07/08/2026; IPTU 2010–2026; IPCA (SGS 433) e CDI (SGS 4391) do BCB. Pares compra → venda da mesma unidade: A2 (research/fase2/A2_flips.md).",
    "ultima_data": ULTIMA, "q_fim": qlabel(Q_FIM), "q_cubo": [qlabel(q) for q in range(Q0C, Q_FIM + 1)], "n_sel": 20,
    "custos": CUSTOS, "fator_liq": round((1 - CUSTOS["corretagem"]) / (1 + CUSTOS["itbi"] + CUSTOS["cartorio_registro"]), 6),
    "zonas": ZONAS, "segs": list(SEGS), "dims": DIMS, "motivos": MOT, "flags": FLAGS, "d5": int(D5),
    "p_a2_8": EFF, "cubo_cidade_8T": CUBE_CHECK,
    "regras": {"n_cor": 10, "dist_rank_8T": 30, "rua_n": 8, "rua_est": 300, "predio_n8": 5, "predio_n20": 8},
    "ponte": ponte, "hazard": [[m, round(h, 3), round(e, 3)] for m, h, e in hz], "giro_idade": [[int(i), float(g)] for i, g in giro],
    "planta_cidade": planta["cidade"],
}
n = dump(OUT / "meta.json", meta)
log(f"meta.json {n / 1e3:.0f} kB · pronto")
con.close()
import shutil
shutil.rmtree(TMP, ignore_errors=True)
