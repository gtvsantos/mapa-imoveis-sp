"""Etapa 1 — xlsx anual do ITBI → parquet bruto (tudo texto), sem nenhuma limpeza.

Cada linha de cada aba mensal vira uma linha, com procedência:
  arquivo_ano, aba (mês de PAGAMENTO da guia), linha (1-based na aba), n_cols (largura real da linha).
As 28 colunas são posicionais (o cabeçalho de 2019–2022 rotula a col 26 como "ACC" por engano).
Colunas além da 28ª são preservadas em `extra` (texto) para auditoria.
Linhas de cabeçalho NÃO são removidas aqui: `is_header` marca (SQL não numérico na col 0).

Uso: python3.12 01_stage_raw.py [anos...]   (paralelo por ano)
"""
from __future__ import annotations
import sys, glob, os, datetime as dt
from concurrent.futures import ProcessPoolExecutor
import openpyxl, pandas as pd

RAW = os.path.join(os.path.dirname(__file__), "..", "raw")
OUT = os.path.join(os.path.dirname(__file__), "stage")
COLS = ["sql","logradouro","numero","complemento","bairro","referencia","cep",
        "natureza","valor_transacao","data_transacao","vvr","prop_transmitida",
        "vvr_proporcional","base_calculo","tipo_financiamento","valor_financiado",
        "cartorio","matricula","situacao_sql","area_terreno","testada","fracao_ideal",
        "area_construida","uso_cod","uso_desc","padrao_cod","padrao_desc","acc_ano"]
MESES = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"]


def _s(v):
    if v is None:
        return None
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def stage(path: str) -> str:
    ano = int(os.path.basename(path)[5:9])
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    recs = []
    for ws in wb.worksheets:
        if ws.title[:3].upper() not in MESES:
            continue
        for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
            # largura real = última célula não-vazia
            n = len(row)
            while n and (row[n-1] is None or (isinstance(row[n-1], str) and not row[n-1].strip())):
                n -= 1
            if n == 0:
                continue
            vals = [_s(v) for v in row[:28]] + [None] * max(0, 28 - len(row))
            extra = [_s(v) for v in row[28:n]]
            rec = dict(zip(COLS, vals))
            rec.update(arquivo_ano=ano, aba=ws.title, linha=i, n_cols=n,
                       extra="|".join(e or "" for e in extra) if extra else None,
                       tipo_data_raw=type(row[9]).__name__ if len(row) > 9 else None,
                       tipo_valor_raw=type(row[8]).__name__ if len(row) > 8 else None)
            recs.append(rec)
    wb.close()
    df = pd.DataFrame.from_records(recs)
    df["is_header"] = ~df["sql"].fillna("").str.strip().str.fullmatch(r"\d+(\.0)?")
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f"itbi_raw_{ano}.parquet")
    df.to_parquet(out, index=False)
    return f"{ano}: {len(df)} linhas, header={int(df.is_header.sum())}, extra={int(df.extra.notna().sum())}"


if __name__ == "__main__":
    anos = sys.argv[1:]
    files = sorted(glob.glob(os.path.join(RAW, "ITBI_*.xlsx")))
    if anos:
        files = [f for f in files if any(a in f for a in anos)]
    with ProcessPoolExecutor(max_workers=7) as ex:
        for msg in ex.map(stage, files):
            print(msg, flush=True)
