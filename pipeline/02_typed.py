"""Etapa 2 — bruto (texto) → tipado, SEM remover nada além das linhas de cabeçalho.

Cada falha de conversão é contada por coluna/ano (typing_report.csv) — nada some em silêncio.
Saída: stage/itbi_typed.parquet (todas as naturezas, todos os anos de arquivo).

Convenções: R$ cheio; % 0–100; ausente = NaN/None (nunca 0 inventado — mas 0 da FONTE é mantido
como 0 e contado, pois na fonte 0 às vezes significa 'não calculado', ver relatório).
"""
from __future__ import annotations
import glob, os, re
import numpy as np, pandas as pd

HERE = os.path.dirname(__file__)
ST = os.path.join(HERE, "stage")
NUM = ["numero","cep","valor_transacao","vvr","prop_transmitida","vvr_proporcional","base_calculo",
       "valor_financiado","matricula","area_terreno","testada","fracao_ideal","area_construida",
       "uso_cod","padrao_cod","acc_ano"]
MES = {m: i+1 for i, m in enumerate(["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"])}


def sql_dv(s10: str) -> int:
    """Dígito verificador do SQL. Inferido dos dados (pares de SQL vizinhos): pesos
    [10,1,2,…,9] sobre os 10 dígitos, mod 11, resto 10 → 1. Valida 100% dos SQL únicos
    2006–2026 (a Fazenda valida na entrada; SQL errado só pode ser OUTRO SQL válido)."""
    w = (10, 1, 2, 3, 4, 5, 6, 7, 8, 9)
    tot = sum(int(c) * w[i] for i, c in enumerate(s10))
    d = tot % 11
    return 1 if d == 10 else d


def main():
    parts = [pd.read_parquet(f) for f in sorted(glob.glob(os.path.join(ST, "itbi_raw_*.parquet")))]
    raw = pd.concat(parts, ignore_index=True)
    rep = []
    hdr = raw["is_header"]
    rep.append(dict(etapa="header", coluna="sql", n=int(hdr.sum()), obs="linhas de cabeçalho removidas"))
    df = raw[~hdr].copy()
    df["mes_pagamento"] = df["aba"].str[:3].str.upper().map(MES)
    df["ano_pagamento"] = df["aba"].str[-4:].astype(int)
    # SQL: texto de dígitos → zfill(11)
    s = df["sql"].str.replace(r"\.0$", "", regex=True).str.strip()
    df["sql_len_raw"] = s.str.len()
    df["sql11"] = s.str.zfill(11)
    df["setor"] = df["sql11"].str[:3]; df["quadra"] = df["sql11"].str[3:6]
    df["lote"] = df["sql11"].str[6:10]; df["dv"] = df["sql11"].str[10].astype(int)
    df["dv_ok"] = [sql_dv(x[:10]) == d for x, d in zip(df["sql11"], df["dv"])]
    for c in NUM:
        v = df[c]
        t = pd.to_numeric(v.str.replace(",", ".", regex=False), errors="coerce")
        bad = v.notna() & v.str.strip().ne("") & t.isna()
        if bad.any():
            rep.append(dict(etapa="to_numeric", coluna=c, n=int(bad.sum()),
                            obs="exemplos: " + "; ".join(v[bad].astype(str).unique()[:5])))
        df[c] = t
    d = pd.to_datetime(df["data_transacao"], errors="coerce")
    bad = df["data_transacao"].notna() & d.isna()
    rep.append(dict(etapa="to_datetime", coluna="data_transacao", n=int(bad.sum()),
                    obs="exemplos: " + "; ".join(df.loc[bad, "data_transacao"].astype(str).unique()[:8])))
    df["data_raw"] = df["data_transacao"]
    df["data_transacao"] = d
    df["natureza_cod"] = pd.to_numeric(df["natureza"].str.extract(r"^\s*(\d+)")[0], errors="coerce")
    for c in ["logradouro","complemento","bairro","referencia","natureza","tipo_financiamento",
              "cartorio","situacao_sql","uso_desc","padrao_desc"]:
        df[c] = df[c].where(df[c].isna(), df[c].str.strip()).replace("", None)
    df = df.reset_index(drop=True)
    df.insert(0, "uid", range(len(df)))  # id estável da guia (ordem do arquivo/aba/linha) — chave de TODAS as junções
    df.to_parquet(os.path.join(ST, "itbi_typed.parquet"), index=False)
    pd.DataFrame(rep).to_csv(os.path.join(HERE, "typing_report.csv"), index=False)
    print(pd.DataFrame(rep).to_string())
    print(len(df), "linhas tipadas")


if __name__ == "__main__":
    main()
