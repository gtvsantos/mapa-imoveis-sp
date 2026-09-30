"""Etapa 6 — tabela analítica: 1 linha por NEGÓCIO de compra e venda, com flags, estratos e lote.

Aplica as decisões de DECISOES.md (I-003..I-013). Nada é apagado: toda exclusão do preço vira flag com
motivo (`motivo_fora_preco`). Saída: stage/itbi_negocios.parquet  (+ imprime o funil com contagens).

Negócio = (SQL, data do instrumento, matrícula — ou complemento se sem matrícula). Guias idênticas com prop 100 → 1 (duplicidade, F9).
Vários compradores → soma valor e proporção (F8). Retificação (mesmo SQL integral, ≤90 d, ±5%) → 1 (F10).
Planta (I-006): prop<10 e (fração=1 ou prop<1) — entra no VOLUME, nunca no R$/m².
Tipos e base do preço (I-036, 30/09/2026): apto · casa · sala/loja/escr (grupo comercial) · galpao (uso 50/51) em R$/m² de área
CONSTRUÍDA; terreno em R$/m² de área de TERRENO; vaga em R$/UNIDADE. Coluna `preco` = valor na base do tipo; `rsm2` segue sendo
R$/m² construído (compatibilidade). Faixas de tamanho próprias para terreno (m² de terreno) e galpão.
"""
import duckdb, numpy as np, pandas as pd, os

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
con = duckdb.connect()
T = con.execute("select * from 'stage/itbi_typed.parquet' where natureza_cod=1").df()
G = pd.read_parquet("stage/itbi_geo.parquet").rename(columns={"rid": "uid"})
T = T.merge(G[["uid", "geo_nivel", "planta", "lon", "lat", "distrito", "cd_distrito", "condominio", "lote_key",
               "condo_key", "condo_planta", "sql_unid", "iptu_ex"]], on="uid", how="left")
funil = [("guias compra e venda (natureza 1)", len(T))]
# F1 linhas deslocadas
bad = T.data_transacao.isna() | T.valor_transacao.isna()
T = T[~bad].copy(); funil.append(("− F1 linhas deslocadas (excluídas)", int(bad.sum())))
# F9 duplicidade exata com prop 100
DTI = ["sql11", "natureza", "valor_transacao", "data_transacao", "prop_transmitida", "tipo_financiamento",
       "valor_financiado", "cartorio", "matricula"]
dup = T.duplicated(DTI, keep="first") & (T.prop_transmitida >= 99.5)
T = T[~dup].copy(); funil.append(("− F9 guias duplicadas (prop 100, idênticas)", int(dup.sum())))
T["ano"] = T.data_transacao.dt.year
T["tri"] = T.ano.astype(str) + "T" + ((T.data_transacao.dt.month - 1) // 3 + 1).astype(str)
# lote do negócio (chave cadastral do polígono)
T["lot_lote"] = np.where(T.geo_nivel == "lote_planta", "0000", T.lote_key)
T["lot_condo"] = np.where(T.geo_nivel == "lote_planta", T.condo_planta.str[:2], T.condo_key)
T["lot_id"] = np.where(T.geo_nivel.isin(["lote", "lote_planta", "lote_mae"]),
                       T.setor + T.quadra + T.lot_lote.fillna("") + T.lot_condo.fillna(""), None)

# ── agrega guias em negócios ─────────────────────────────────────────────
agg = dict(uid=("uid", "min"), n_guias=("uid", "size"), valor=("valor_transacao", "sum"), valor_max=("valor_transacao", "max"),
           prop=("prop_transmitida", "sum"), prop_max=("prop_transmitida", "max"),
           vvr=("vvr", "max"), fin=("valor_financiado", "sum"), tipo_fin=("tipo_financiamento", "first"),
           arquivo_ano=("arquivo_ano", "min"))
keep = ["ano", "tri", "setor", "quadra", "lote", "logradouro", "numero", "complemento", "referencia", "cep",
        "situacao_sql", "area_terreno", "fracao_ideal", "area_construida", "uso_cod", "padrao_cod", "acc_ano",
        "geo_nivel", "planta", "lon", "lat", "distrito", "cd_distrito", "condominio", "lot_id", "sql_unid"]
for k in keep:
    agg[k] = (k, "first")   # 1º não-nulo do grupo (guias do mesmo SQL/data têm os mesmos atributos IPTU)
# a UNIDADE é a matrícula (várias unidades da planta — ou de um prédio sem condomínio — dividem o mesmo SQL e data);
# sem matrícula (0/vazia, comum em 2006–10), usa o complemento
# na PLANTA a matrícula declarada é a do lote-mãe (a da unidade ainda não existe) → a unidade é o complemento
comp = "C" + T.complemento.fillna("").str.upper().str.replace(r"[^A-Z0-9]+", "", regex=True)
T["unid"] = np.where(T.planta.fillna(False) | ~(T.matricula.fillna(0) > 0), comp,
                     "M" + T.matricula.fillna(0).astype("int64").astype(str))
N = T.groupby(["sql11", "data_transacao", "unid"], sort=False).agg(**agg).reset_index()
funil.append(("= negócios (SQL + data + matrícula)", len(N)))
# proporções somando >100% (ex.: 100+100 com a 2ª guia irrisória — menor/maior = 0,007 na mediana; o MAIOR
# valor ÷ VVR = 1,149, igual ao mercado, e a soma daria 1,332): vale o maior valor, como transmissão integral
N["prop_resolvida_max"] = N.prop > 100.5
N.loc[N.prop_resolvida_max, "valor"] = N.loc[N.prop_resolvida_max, "valor_max"]
N.loc[N.prop_resolvida_max, "prop"] = N.loc[N.prop_resolvida_max, "prop_max"].clip(upper=100)
N["prop_c"] = N.prop.clip(upper=100)
N["prop_incoerente"] = False
# F10 retificação: mesmo SQL integral, ≤90 d, valor ±5% → mantém o 1º
N = N.sort_values(["sql11", "data_transacao"]).reset_index(drop=True)
integ = N.prop_c >= 99.5
same = N.sql11.eq(N.sql11.shift()) & integ & integ.shift(fill_value=False)
gap = (N.data_transacao - N.data_transacao.shift()).dt.days
rel = (N.valor - N.valor.shift()).abs() / np.maximum(N.valor, N.valor.shift())
retif = same & (gap <= 90) & (rel <= 0.05)
N = N[~retif].copy(); funil.append(("− F10 retificações ≤90 d ±5% (colapsadas)", int(retif.sum())))

# ── classes e estratos ───────────────────────────────────────────────────
u = N.uso_cod
# tipo bruto pelo uso do IPTU que vem na guia (I-036): 31 = prédio de escritório não em condomínio (escr);
# 50 indústria e 51 armazéns/depósitos = galpão (o padrão do IPTU desses usos é "Oficina/Armazém/Depósito/Indústria")
N["tipo"] = np.select([u.isin([20, 25]), u.isin([10, 12, 13, 14]), u.isin([30, 85]), u.isin([40, 41, 42]), u.eq(31),
                       u.isin([23, 24, 62, 63]), u.eq(0), u.isin([50, 51])],
                      ["apto", "casa", "sala", "loja", "escr", "vaga", "terreno", "galpao"], "outros")
N.loc[N.planta, "tipo"] = "planta"
# grupo do seletor de tipo (I-036): o id `sala` do grupo comercial é mantido por compatibilidade com os módulos
GRUPO = {"apto": "apto", "casa": "casa", "sala": "sala", "loja": "sala", "escr": "sala", "vaga": "vaga", "terreno": "terreno", "galpao": "galpao"}
N["grupo"] = N.tipo.map(GRUPO)
N["valor100"] = np.where(N.prop_c >= 10, N.valor / (N.prop_c / 100), np.nan)
N["rsm2"] = N.valor100 / N.area_construida.where(N.area_construida > 0)
# base do preço (I-036): m² construído (m2c), m² de terreno (m2t) ou unidade (unid)
N["base_preco"] = np.select([N.tipo.eq("terreno"), N.tipo.eq("vaga")], ["m2t", "unid"], "m2c")
N["preco"] = np.select([N.base_preco.eq("m2t"), N.base_preco.eq("unid")],
                       [N.valor100 / N.area_terreno.where(N.area_terreno > 0), N.valor100], N.rsm2)
N["idade"] = (N.ano - N.acc_ano).where(N.acc_ano > 0)
N["acc_anacronico"] = N.idade < -1
N["idade"] = N.idade.clip(lower=0)
# faixas de tamanho por tipo (I-036): construída (padrão), construída de galpão, terreno; vaga não tem faixa de tamanho
N["f_area"] = None
mt = N.tipo.eq("terreno"); mg = N.tipo.eq("galpao"); mc = ~N.tipo.isin(["terreno", "galpao", "vaga"])
N.loc[mc, "f_area"] = pd.cut(N.area_construida[mc], [0, 45, 70, 100, 150, 250, 1e9],
                             labels=["≤45", "45–70", "70–100", "100–150", "150–250", ">250"]).astype(object)
N.loc[mg, "f_area"] = pd.cut(N.area_construida[mg], [0, 300, 600, 1200, 2500, 1e9],
                             labels=["≤300", "300–600", "600–1.200", "1.200–2.500", ">2.500"]).astype(object)
N.loc[mt, "f_area"] = pd.cut(N.area_terreno[mt], [0, 150, 250, 500, 1000, 5000, 1e9],
                             labels=["≤150", "150–250", "250–500", "500–1.000", "1.000–5.000", ">5.000"]).astype(object)
N["f_area"] = N.f_area.where(N.f_area.notna(), None)
N["f_idade"] = pd.cut(N.idade, [-1, 3, 10, 20, 35, 1e4], labels=["≤3", "4–10", "11–20", "21–35", ">35"]).astype(object)
# padrão A–F = último dígito do código (1x residencial horizontal, 2x vertical, 3x/4x comercial, 8x oficina/armazém/indústria)
pc = N.padrao_cod.fillna(-1).astype(int)
N["f_padrao"] = np.where(pc.between(10, 99) & (pc % 10 <= 5), pd.Series(pc % 10).map({0: "A", 1: "B", 2: "C", 3: "D", 4: "E", 5: "F"}), None)
# bloco: ≥5 SQL distintos do mesmo condomínio (lote) na mesma data
own = ~N.planta & N.lot_id.notna()
b = N[own].groupby(["lot_id", "data_transacao"]).sql11.transform("nunique")
N["bloco"] = False; N.loc[b.index, "bloco"] = b >= 5
N["fin_flag"] = N.fin.fillna(0) > 0

# ── quartos estimados (I-013): só dentro do prédio, via anúncios QuintoAndar no lote ─────────
qa = pd.read_parquet("stage/qa_lote.parquet")
qa = qa[qa.tipo.isin(["Apartamento", "StudioOuKitchenette"]) & (qa.lote == "0000") & qa.area.notna() & qa.quartos.notna()].copy()
qa["lot_id"] = qa.setor + qa.quadra + "0000" + qa.condominio
qa["area"] = qa.area.astype(float)
cp = con.execute("""select substr(sql,1,6)||'0000'||substr(condominio,1,2) lot_id,
   median(case when uso ilike 'Apartamento%' then try_cast(area_construida as double) end) apto_med
   from '../raw/iptu/iptu_2026_slim.parquet' where condominio<>'00-0' group by 1""").df()
r = qa.groupby("lot_id").area.median().rename("qa_med").to_frame().join(cp.set_index("lot_id"))
r["ratio"] = (r.apto_med / r.qa_med).where(lambda x: x.between(1.0, 2.5), 1.64)
qa = qa.join(r.ratio, on="lot_id")
ap = N[(N.tipo == "apto") & N.lot_id.isin(qa.lot_id.unique()) & (N.area_construida > 0)]
qg = {k: (g.area.values, g.quartos.values, g.ratio.iloc[0]) for k, g in qa.groupby("lot_id")}
qh, qd = [], []
for lid, a in zip(ap.lot_id.values, ap.area_construida.values):
    ar, qq, rt = qg[lid]
    est = a / rt
    d = np.abs(ar - est) / est
    j = d.argmin(); qh.append(qq[j]); qd.append(d[j])
N["quartos_est"] = np.nan; N["quartos_dist"] = np.nan
N.loc[ap.index, "quartos_est"] = qh; N.loc[ap.index, "quartos_dist"] = qd
N.loc[N.quartos_dist > 0.2, "quartos_est"] = np.nan   # casamento frouxo demais (acerto < 73%) → sem quartos
N["f_quartos"] = N.quartos_est.map(lambda q: None if pd.isna(q) else ("1" if q <= 1 else "2" if q == 2 else "3" if q == 3 else "4+"))

# ── elegibilidade para o PREÇO (motivo do 1º filtro que reprova) ───────────────
m = pd.Series(None, index=N.index, dtype=object)
def rule(mask, why):
    sel = m.isna() & mask
    m.loc[sel] = why
PRECO_TIPOS = ["apto", "casa", "sala", "loja", "escr", "galpao", "terreno", "vaga"]   # I-036
rule(N.planta, "planta (unidade sobre SQL do terreno)")
rule(~N.tipo.isin(PRECO_TIPOS), "tipo fora do preço (outros usos)")
rule(N.prop_c < 10, "cota < 10%")
rule(N.valor <= 1000, "valor ≤ R$1.000 (simbólico)")
rule(N.base_preco.eq("m2c") & ~(N.area_construida > 0), "sem área construída")
rule(N.base_preco.eq("m2t") & ~(N.area_terreno > 0), "sem área de terreno")
rule((N.vvr > 0) & (N.valor100 < 0.3 * N.vvr), "valor < 30% do VVR")
rule(N.base_preco.eq("m2c") & ~N.preco.between(500, 60000), "R$/m² fora de 500–60.000")
rule(N.base_preco.eq("m2t") & ~N.preco.between(30, 100000), "R$/m² de terreno fora de 30–100.000")
rule(N.base_preco.eq("unid") & ~N.preco.between(3000, 1500000), "R$/vaga fora de 3.000–1.500.000")
rule(N.bloco, "venda em bloco (≥5 unid.)")
# MAD 3,5 dentro de distrito × tipo × faixa de área × ano (célula ≥ 20), no log do preço na base do tipo
ok = m.isna() & N.distrito.notna()
lr = np.log(N.preco.where(ok))
grp = [N.distrito, N.tipo, N.f_area.fillna("*"), N.ano]
medv = lr.groupby(grp).transform("median")
mad = (lr - medv).abs().groupby(grp).transform("median") * 1.4826
cnt = lr.groupby(grp).transform("count")
rule(ok & (cnt >= 20) & ((lr - medv).abs() > 3.5 * mad.clip(lower=0.05)), "fora de 3,5·MAD (distrito×tipo×área×ano)")
rule(N.distrito.isna(), "sem distrito (sem geo)")
N["motivo_fora_preco"] = m
N["preco_ok"] = m.isna()
N.to_parquet("stage/itbi_negocios.parquet", index=False)

for k, v in funil:
    print(f"{k:55s} {v:>10,}".replace(",", "."))
print("\nnegócios por tipo:", N.tipo.value_counts().to_dict())
print("negócios por grupo (no preço):", N[N.preco_ok].grupo.value_counts().to_dict())
print("\nmotivo fora do preço:")
print(N.motivo_fora_preco.fillna("✓ entra no preço").value_counts().to_string())
print("\nquartos estimados (aptos SQL próprio):", round(100 * N.loc[N.tipo == "apto", "quartos_est"].notna().mean(), 1), "%")
print("anacronismo ACC:", int(N.acc_anacronico.sum()))
