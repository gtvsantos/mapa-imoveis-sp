"""Geolocalização 100% cadastral: SQL → IPTU (código de condomínio) → polígono do lote GeoSampa.

Nenhum geocoder por nome de rua. Níveis (coluna geo_nivel), do mais ao menos preciso:
  lote        — polígono do lote (não-condomínio) ou do lote-condomínio (lote 0000 + cód. condomínio)
  lote_planta — unidade na planta ligada ao condomínio individualizado (IPTU 2026, mesma quadra fiscal)
  lote_mae    — lote do SQL-mãe ainda existente nos lotes 2026 (unidade na planta não individualizada)
  quadra      — só a quadra fiscal (setor+quadra): NÃO entra no mapa de lotes, só em agregados
  sem_geo     — nem a quadra existe nos lotes 2026

Exercício do IPTU usado para o código de condomínio: o mais recente que contém o SQL.
Saída: stage/itbi_geo.parquet (1 linha por guia de compra e venda, com lon/lat/distrito/nível).
"""
import duckdb, pandas as pd, numpy as np, os

HERE = os.path.dirname(os.path.abspath(__file__))
con = duckdb.connect()
con.execute(f"set temp_directory='{HERE}/stage/_duck_tmp'")
con.execute("create view t as select uid as rid, * from 'stage/itbi_typed.parquet' where natureza_cod=1")
con.execute("""create table iptu_last as
  select sql, arg_max(condominio, exercicio) condominio, max(exercicio) exercicio
  from '../raw/iptu/iptu_*_slim.parquet' group by sql""")
con.execute("""create table lotes as
  select setor, quadra, lote, condominio, arg_min(lon, case tp_lote when 'F' then 0 else 1 end) lon,
         arg_min(lat, case tp_lote when 'F' then 0 else 1 end) lat,
         arg_min(distrito, case tp_lote when 'F' then 0 else 1 end) distrito,
         arg_min(cd_distrito, case tp_lote when 'F' then 0 else 1 end) cd_distrito
  from 'stage/lotes_centroides.parquet' group by 1,2,3,4""")
con.execute("""create table quadras as select setor, quadra, avg(lon) lon, avg(lat) lat,
  mode(distrito) distrito, mode(cd_distrito) cd_distrito from 'stage/lotes_centroides.parquet' where tp_lote='F' group by 1,2""")
pl = pd.read_parquet("stage/_planta_match.parquet")
con.execute("""create table g as
select t.rid, t.arquivo_ano, t.sql11, t.setor, t.quadra, t.lote, t.data_transacao, t.complemento, t.valor_transacao,
       t.prop_transmitida, t.fracao_ideal, i.condominio, i.exercicio iptu_ex,
       case when i.condominio is not null and i.condominio<>'00-0' then '0000' else t.lote end lote_key,
       case when i.condominio is not null and i.condominio<>'00-0' then substr(i.condominio,1,2) else '00' end condo_key
from t left join iptu_last i on i.sql=t.sql11""")
con.execute("""create table g2 as select g.*, l.lon, l.lat, l.distrito, l.cd_distrito
from g left join lotes l on l.setor=g.setor and l.quadra=g.quadra and l.lote=g.lote_key and l.condominio=g.condo_key""")
g = con.execute("select * from g2").df()
# unidade na planta ligada a condomínio 2026 (único ou vários do mesmo condomínio)
i26 = pd.read_parquet("stage/_iptu26_condo_units.parquet")[["setor", "quadra", "ap", "tr", "condominio", "ano_vida", "sql"]]
pk = pl[pl.status.isin(["único", "vários_mesmo_condo"])].copy()
mm = pk.merge(i26[i26.ap.notna()], on=["setor", "quadra", "ap"], suffixes=("", "_i"))
mm = mm[(mm.ano_vida >= mm.data_transacao.dt.year - 1) & (mm.tr.isna() | mm.tr_i.isna() | (mm.tr == mm.tr_i))]
cond = mm.groupby(["sql11", "data_transacao", "complemento", "valor_transacao"]).agg(
    condo_planta=("condominio", "first"), sql_unid=("sql", lambda s: s.iloc[0] if s.nunique() == 1 else None)).reset_index()
g = g.merge(cond, on=["sql11", "data_transacao", "complemento", "valor_transacao"], how="left")
lot = con.execute("select * from lotes").df().set_index(["setor", "quadra", "lote", "condominio"])
q = con.execute("select * from quadras").df().set_index(["setor", "quadra"])
planta = (g.prop_transmitida < 10) & ((g.fracao_ideal >= 0.999) | (g.prop_transmitida < 1))
g["planta"] = planta
g["geo_nivel"] = np.where(g.lon.notna(), np.where(planta, "lote_mae", "lote"), None)
# planta ligada → substitui pelo lote-condomínio
idx = g.condo_planta.notna()
keys = list(zip(g.loc[idx, "setor"], g.loc[idx, "quadra"], ["0000"] * idx.sum(), g.loc[idx, "condo_planta"].str[:2]))
hit = [lot.loc[k] if k in lot.index else None for k in keys]
for j, (ri, h) in enumerate(zip(g.index[idx], hit)):
    if h is not None:
        g.at[ri, "lon"], g.at[ri, "lat"], g.at[ri, "distrito"], g.at[ri, "cd_distrito"] = h.lon, h.lat, h.distrito, h.cd_distrito
        g.at[ri, "geo_nivel"] = "lote_planta"
# quadra fallback
miss = g.geo_nivel.isna()
qk = list(zip(g.loc[miss, "setor"], g.loc[miss, "quadra"]))
qin = [k in q.index for k in qk]
g.loc[g.index[miss][qin], "geo_nivel"] = "quadra"
qq = q.loc[[k for k, b in zip(qk, qin) if b]]
g.loc[g.index[miss][qin], ["lon", "lat", "distrito", "cd_distrito"]] = qq[["lon", "lat", "distrito", "cd_distrito"]].values
g["geo_nivel"] = g.geo_nivel.fillna("sem_geo")
g.to_parquet("stage/itbi_geo.parquet", index=False)
print(pd.crosstab(g.arquivo_ano, g.geo_nivel, margins=True).to_string())
print((pd.crosstab(g.arquivo_ano, g.geo_nivel, normalize="index") * 100).round(1).to_string())
print("iptu exercício usado:", g.iptu_ex.value_counts(dropna=False).to_dict())
