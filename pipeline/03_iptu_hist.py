"""IPTU histórico (zip GeoSampa) → parquet enxuto por ano, via DuckDB.

O CSV é extraído para o scratch, lido e APAGADO (o zip é a cópia-fonte). Colunas mantidas: as que
caracterizam a unidade/prédio + identificação. 2026 já existe completo (raw/iptu/iptu_2026.parquet).

    python3.12 03_iptu_hist.py 2010 2015 2020 2025
"""
import os, sys, subprocess, tempfile, duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "raw", "iptu")
KEEP = {
    "NUMERO DO CONTRIBUINTE": "contribuinte", "NUMERO DO CONDOMINIO": "condominio",
    "CODLOG DO IMOVEL": "codlog", "NOME DE LOGRADOURO DO IMOVEL": "logradouro",
    "NUMERO DO IMOVEL": "numero", "COMPLEMENTO DO IMOVEL": "complemento",
    "REFERENCIA DO IMOVEL": "referencia", "CEP DO IMOVEL": "cep", "FRACAO IDEAL": "fracao_ideal",
    "AREA DO TERRENO": "area_terreno", "AREA CONSTRUIDA": "area_construida", "AREA OCUPADA": "area_ocupada",
    "VALOR DO M2 DO TERRENO": "vm2_terreno", "VALOR DO M2 DE CONSTRUCAO": "vm2_construcao",
    "ANO DA CONSTRUCAO CORRIGIDO": "acc", "QUANTIDADE DE PAVIMENTOS": "pavimentos",
    "TIPO DE USO DO IMOVEL": "uso", "TIPO DE PADRAO DA CONSTRUCAO": "padrao",
    "ANO DE INICIO DA VIDA DO CONTRIBUINTE": "ano_vida",
}


def conv(ano: int):
    out = os.path.join(RAW, f"iptu_{ano}_slim.parquet")
    if os.path.exists(out):
        print(ano, "já existe"); return
    tmp = tempfile.mkdtemp(dir=os.environ.get("TMPDIR"))
    subprocess.run(["unzip", "-o", "-q", os.path.join(RAW, f"IPTU_{ano}.zip"), "-d", tmp], check=True)
    csv = [os.path.join(tmp, f) for f in os.listdir(tmp) if f.lower().endswith(".csv")][0]
    con = duckdb.connect()
    # 2021–2023 vêm em latin-1 (acentos como bytes 0xE3...); os demais em UTF-8 (com ou sem BOM).
    enc = "utf-8"
    try:
        con.execute(f"select count(*) from read_csv('{csv}', delim=';', header=true, all_varchar=true)").fetchone()
    except duckdb.Error:
        enc = "latin-1"
    rc = f"read_csv('{csv}', delim=';', header=true, all_varchar=true, encoding='{enc}')"
    cols = [c[0] for c in con.execute(f"describe select * from {rc}").fetchall()]
    norm = {c.replace("﻿", "").strip(): c for c in cols}
    sel = ", ".join(f'trim("{norm[k]}") as {v}' for k, v in KEEP.items() if k in norm)
    con.execute(f"""copy (select lpad(replace(replace(trim("{norm['NUMERO DO CONTRIBUINTE']}"),'-',''),'.',''),11,'0') as sql,
                     {ano} as exercicio, {sel}
                     from {rc})
                   to '{out}' (format parquet, compression zstd)""")
    n = con.execute(f"select count(*), count(distinct sql) from '{out}'").fetchone()
    os.remove(csv); os.rmdir(tmp)
    print(ano, enc, "linhas", n[0], "sql distintos", n[1], "colunas ausentes:", [k for k in KEEP if k not in norm])


if __name__ == "__main__":
    for a in sys.argv[1:]:
        conv(int(a))
