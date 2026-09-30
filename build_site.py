#!/usr/bin/env python3
"""Monta o site estático "Mapa Imóveis São Paulo" a partir do protótipo Radar ITBI (somente leitura no protótipo).

O protótipo (data/cache/itbi/proto) tem um núcleo + módulos e uma fonte licenciada de lançamentos, de uso
interno, que NUNCA pode ir a este site: nem arquivos, nem a palavra que a identifica em nome ou conteúdo de
qualquer arquivo desta pasta. Este build faz a cópia seletiva e, no fim, varre a pasta inteira e FALHA
(código 1) se encontrar qualquer ocorrência.

Passos:
  (a) src/          ← proto/src, sem o módulo licenciado (js + css) e sem .DS_Store; apaga o que sumiu na origem
  (b) data.json     ← proto/data.json
  (c) dist/ flips/ contexto/ aluguel/ terrenos/  ← sincronizadas (só quando tamanho/mtime diferem), excluindo
      terrenos/por_ref*.json (elo com a fonte licenciada), duplicatas do Finder ("meta 2.json") e .DS_Store;
      apaga no destino o que sumiu da origem. Nada da pasta da fonte licenciada, de proto/logos, proto/_bak
      nem dos *.html do proto.
  (d) pipeline/     ← cópia de referência dos scripts públicos da cadeia (research/0*.py, build_*.py públicos,
      assemble.py, check.py, serve.py → serve_proto.py). Um script que cite a fonte licenciada NÃO é copiado
      (fica o aviso no log; quem orquestra decide).
  (e) index.html    ← proto/assemble.py --src src --data data.json --exclude <módulos> --brand ... --flag publico
  (f) verificação   — nome ou conteúdo com a palavra proibida; arquivos > 95 MB (GitHub recusa 100 MB);
      tamanho total e nº de arquivos. Qualquer ocorrência → código de saída 1.
  (g) build_info.json — {montado_em, proto, modulos, tamanho_mb, arquivos}

    python3 build_site.py                      # tudo (≈1 min sem cópia; a 1ª cópia dos ~400 MB demora mais)
    python3 build_site.py --no-data            # não sincroniza as pastas pesadas (só src, data.json, pipeline, html)
    python3 build_site.py --check-only         # só a verificação (f)
    python3 build_site.py --proto /outro/proto --brand "Outro nome" --quiet
    PROTO_DIR=/outro/proto python3 build_site.py

Códigos de saída: 0 ok · 1 verificação encontrou ocorrência (ou arquivo > 95 MB) · 2 assemble.py falhou
(o núcleo pode estar no meio de uma edição; a verificação ainda roda).

Observação: a palavra proibida é montada por partes neste arquivo (constante PROIBIDO) para que o próprio
build_site.py passe na verificação que ele aplica.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent
PROTO_PADRAO = (SITE.parent / "data" / "cache" / "itbi" / "proto").resolve()
BRAND_PADRAO = "Mapa Imóveis São Paulo"

# A palavra proibida, em partes: este arquivo também é verificado (passo f).
PROIBIDO = "".join(("r", "m", "z"))
MODULO_LICENCIADO = "m_" + PROIBIDO

PASTAS_DADOS = ("dist", "flips", "contexto", "aluguel", "terrenos")
DUPLICATA_FINDER = re.compile(r" \d+\.json$")           # "meta 2.json", "radar 2.json" …
LIMITE_GITHUB = 95 * 1024 * 1024                       # 100 MB é o limite duro; 95 dá folga
IGNORAR_NA_VERIFICACAO = {".git", "__pycache__", ".venv"}   # todos fora do repositório (.gitignore)

# (d) scripts de referência: (origem relativa a itbi/, nome no destino)
PIPELINE = [
    ("research/01_stage_raw.py", "01_stage_raw.py"),
    ("research/02_typed.py", "02_typed.py"),
    ("research/03_iptu_hist.py", "03_iptu_hist.py"),
    ("research/05_geo.py", "05_geo.py"),
    ("research/06_analitico.py", "06_analitico.py"),
    ("proto/build_data.py", "build_data.py"),
    ("proto/build_flips.py", "build_flips.py"),
    ("proto/build_aluguel.py", "build_aluguel.py"),
    ("proto/build_contexto.py", "build_contexto.py"),
    ("proto/assemble.py", "assemble.py"),
    ("proto/check.py", "check.py"),
    ("proto/serve.py", "serve_proto.py"),
]

QUIET = False


def log(*a):
    if not QUIET:
        print(*a, flush=True)


def aviso(*a):
    print("AVISO:", *a, flush=True)


# ───────────────────────────── utilitários de cópia ─────────────────────────────
def igual(src: Path, dst: Path) -> bool:
    """Mesmo tamanho e mesmo mtime (ao segundo) → não copia de novo."""
    if not dst.exists():
        return False
    s, d = src.stat(), dst.stat()
    return s.st_size == d.st_size and int(s.st_mtime) == int(d.st_mtime)


def copiar(src: Path, dst: Path, stats: dict):
    if igual(src, dst):
        stats["iguais"] += 1
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    stats["copiados"] += 1
    stats["bytes"] += src.stat().st_size


def sincronizar(origem: Path, destino: Path, excluir, stats: dict):
    """Espelha origem → destino (recursivo). `excluir(rel: str, nome: str) -> bool` decide o que fica fora.
    Apaga no destino o que não existe (ou passou a ser excluído) na origem."""
    esperados: set[str] = set()
    if origem.is_dir():
        for raiz, dirs, files in os.walk(origem):
            dirs[:] = sorted(d for d in dirs if d not in IGNORAR_NA_VERIFICACAO)
            for f in sorted(files):
                rel = str(Path(raiz, f).relative_to(origem))
                if excluir(rel, f):
                    stats["excluidos"] += 1
                    continue
                esperados.add(rel)
                copiar(Path(raiz, f), destino / rel, stats)
    else:
        aviso(f"origem inexistente: {origem}")
    if destino.is_dir():
        for raiz, dirs, files in os.walk(destino, topdown=False):
            for f in files:
                rel = str(Path(raiz, f).relative_to(destino))
                if rel not in esperados:
                    Path(raiz, f).unlink()
                    stats["apagados"] += 1
            for d in dirs:
                p = Path(raiz, d)
                if not any(p.iterdir()):
                    p.rmdir()
    return stats


def novo_stats() -> dict:
    return {"copiados": 0, "iguais": 0, "apagados": 0, "excluidos": 0, "bytes": 0}


def resumo_stats(nome: str, s: dict) -> str:
    return (f"{nome}: {s['copiados']} copiados ({s['bytes'] / 1e6:.1f} MB), {s['iguais']} já iguais, "
            f"{s['apagados']} apagados no destino, {s['excluidos']} excluídos por regra")


# ───────────────────────────── passos ─────────────────────────────
def passo_src(proto: Path, excluidos: list[str]) -> dict:
    nomes_fora = {f"{m}{ext}" for m in excluidos for ext in (".js", ".css")} | {".DS_Store"}

    def excluir(rel, nome):
        return nome in nomes_fora or PROIBIDO in nome.lower()

    return sincronizar(proto / "src", SITE / "src", excluir, novo_stats())


def passo_data_json(proto: Path) -> dict:
    """data.json (agregados, também embutido no index.html) e ruas.json (índice da busca por rua, I-037)."""
    s = novo_stats()
    for nome in ("data.json", "ruas.json"):
        src = proto / nome
        if not src.exists():
            aviso(f"{src} não existe (rode build_data.py no protótipo); mantendo o {nome} atual, se houver")
            continue
        copiar(src, SITE / nome, s)
    return s


def passo_dados(proto: Path) -> dict[str, dict]:
    def excluir(rel, nome):
        low = nome.lower()
        if nome == ".DS_Store" or DUPLICATA_FINDER.search(nome):
            return True
        if PROIBIDO in low:
            return True
        # terrenos/por_ref*.json: elo com a fonte licenciada
        if low.startswith("por_ref") and low.endswith(".json"):
            return True
        return False

    out = {}
    for pasta in PASTAS_DADOS:
        out[pasta] = sincronizar(proto / pasta, SITE / pasta, excluir, novo_stats())
    return out


def contem_proibido(p: Path) -> bool:
    try:
        return PROIBIDO.encode() in p.read_bytes().lower()
    except OSError:
        return False


def passo_pipeline(proto: Path) -> tuple[list[str], list[str]]:
    itbi = proto.parent
    dest = SITE / "pipeline"
    dest.mkdir(exist_ok=True)
    copiados, pulados = [], []
    s = novo_stats()
    for rel, nome in PIPELINE:
        src = itbi / rel
        alvo = dest / nome
        if not src.exists():
            aviso(f"pipeline: {rel} não existe na origem")
            pulados.append(nome)
            continue
        if contem_proibido(src):
            aviso(f"pipeline: {rel} cita a fonte licenciada — NÃO copiado (decisão do orquestrador)")
            pulados.append(nome)
            if alvo.exists():
                alvo.unlink()
            continue
        copiar(src, alvo, s)
        copiados.append(nome)
    # nada além da lista fica em pipeline/ (uma cópia antiga poderia reprovar na verificação)
    for p in dest.iterdir():
        if p.is_file() and p.name not in copiados:
            p.unlink()
        elif p.is_dir() and p.name == "__pycache__":
            shutil.rmtree(p, ignore_errors=True)
    log(resumo_stats("pipeline", s))
    return copiados, pulados


def passo_assemble(proto: Path, excluidos: list[str], brand: str) -> tuple[bool, list[str]]:
    cmd = [sys.executable, str(proto / "assemble.py"),
           "--src", str(SITE / "src"), "--data", str(SITE / "data.json"),
           "--exclude", ",".join(excluidos), "--brand", brand, "--flag", "publico",
           "--out", str(SITE / "index.html")]
    r = subprocess.run(cmd, capture_output=True, text=True)
    saida = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        aviso(f"assemble.py falhou (código {r.returncode}); o núcleo pode estar no meio de uma edição:\n{saida}")
        return False, []
    log("assemble:", saida)
    m = re.search(r"módulos:\s*(.*?)(?:\s+·\s+flags|$)", saida)
    mods = [x.strip() for x in m.group(1).split(",")] if m and m.group(1).strip() and m.group(1).strip() != "nenhum" else []
    return True, mods


TEXTO_EXT = {".js", ".css", ".html", ".md", ".py", ".json", ".txt", ".yml", ".yaml", ".log", ".gitignore", ""}


def linhas_com_proibido(p: Path, max_linhas=5) -> list[str]:
    """Para arquivos de texto, devolve 'linha: trecho' das primeiras ocorrências (ajuda a achar a fonte)."""
    if p.suffix.lower() not in TEXTO_EXT:
        return []
    out = []
    try:
        with p.open("rb") as fh:
            for i, linha in enumerate(fh, 1):
                low = linha.lower()
                j = low.find(PROIBIDO.encode())
                if j >= 0:
                    ini = max(0, j - 60)
                    trecho = linha[ini:j + 60].decode("utf-8", "replace").strip()
                    out.append(f"      linha {i}: …{trecho}…")
                    if len(out) >= max_linhas:
                        break
    except OSError:
        pass
    return out


def passo_verificacao() -> tuple[bool, int, int]:
    """Varre SITE inteiro (menos .git/__pycache__/.venv). Devolve (ok, total_bytes, n_arquivos)."""
    ocorr_nome, ocorr_conteudo, grandes = [], [], []
    total, n = 0, 0
    for raiz, dirs, files in os.walk(SITE):
        dirs[:] = sorted(d for d in dirs if d not in IGNORAR_NA_VERIFICACAO)
        for f in sorted(files):
            p = Path(raiz, f)
            rel = str(p.relative_to(SITE))
            try:
                tam = p.stat().st_size
            except OSError:
                continue
            n += 1
            total += tam
            if PROIBIDO in rel.lower():
                ocorr_nome.append(rel)
            if tam > LIMITE_GITHUB:
                grandes.append((rel, tam))
            if contem_proibido(p):
                ocorr_conteudo.append(rel)
    print(f"verificação: {n} arquivos, {total / 1e6:.1f} MB")
    if grandes:
        print(f"  ARQUIVOS > 95 MB ({len(grandes)}):")
        for rel, tam in grandes:
            print(f"    {rel}  {tam / 1e6:.1f} MB")
    if ocorr_nome:
        print(f"  NOME com a palavra proibida ({len(ocorr_nome)}):")
        for rel in ocorr_nome:
            print("    " + rel)
    if ocorr_conteudo:
        print(f"  CONTEÚDO com a palavra proibida ({len(ocorr_conteudo)}):")
        for rel in ocorr_conteudo:
            print("    " + rel)
            for l in linhas_com_proibido(SITE / rel):
                print(l)
    ok = not (ocorr_nome or ocorr_conteudo or grandes)
    print("verificação:", "OK — nenhuma ocorrência" if ok else "FALHOU")
    return ok, total, n


def gravar_build_info(proto: Path, mods: list[str], total: int, n: int):
    info = {"montado_em": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "proto": str(proto), "modulos": mods,
            "tamanho_mb": round(total / 1e6, 1), "arquivos": n}
    (SITE / "build_info.json").write_text(json.dumps(info, ensure_ascii=False, indent=1) + "\n")
    log("build_info.json:", json.dumps(info, ensure_ascii=False))


# ───────────────────────────── main ─────────────────────────────
def main() -> int:
    global QUIET
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--proto", default=os.environ.get("PROTO_DIR", str(PROTO_PADRAO)),
                    help=f"pasta do protótipo (padrão: env PROTO_DIR ou {PROTO_PADRAO})")
    ap.add_argument("--brand", default=BRAND_PADRAO, help=f"nome no cabeçalho e <title> (padrão: {BRAND_PADRAO!r})")
    ap.add_argument("--exclude", default=MODULO_LICENCIADO,
                    help=f"módulos a deixar fora (lista separada por vírgula; {MODULO_LICENCIADO} fica sempre fora)")
    ap.add_argument("--no-data", action="store_true", help="não sincroniza dist/ flips/ contexto/ aluguel/ terrenos/")
    ap.add_argument("--check-only", action="store_true", help="só a verificação (f)")
    ap.add_argument("--quiet", action="store_true", help="só avisos e o resumo final")
    a = ap.parse_args()
    QUIET = a.quiet

    proto = Path(a.proto).expanduser().resolve()
    if a.check_only:
        ok, _, _ = passo_verificacao()
        return 0 if ok else 1

    if not (proto / "assemble.py").exists() or not (proto / "src").is_dir():
        print(f"ERRO: protótipo não encontrado em {proto} (esperava assemble.py e src/)", file=sys.stderr)
        return 3
    excluidos = sorted({m.strip() for m in a.exclude.split(",") if m.strip()} | {MODULO_LICENCIADO})
    t0 = dt.datetime.now()
    log(f"proto: {proto}\nsite:  {SITE}\nmódulos fora: {', '.join(excluidos)}")

    log(resumo_stats("src", passo_src(proto, excluidos)))                       # (a)
    log(resumo_stats("data.json + ruas.json", passo_data_json(proto)))                      # (b)
    if a.no_data:                                                               # (c)
        log("dados: pulados (--no-data)")
    else:
        for pasta, s in passo_dados(proto).items():
            log(resumo_stats(pasta, s))
    copiados, pulados = passo_pipeline(proto)                                   # (d)
    if pulados:
        log("pipeline: não copiados →", ", ".join(pulados))

    # antes de montar, aponta o que no src ainda cita a fonte licenciada (é o que vai reprovar em (f))
    sujos = [p for p in sorted((SITE / "src").glob("*")) if p.is_file() and contem_proibido(p)]
    for p in sujos:
        aviso(f"src/{p.name} cita a fonte licenciada — o index.html montado herda isso:")
        for l in linhas_com_proibido(p, 3):
            print(l)

    ok_asm, mods = passo_assemble(proto, excluidos, a.brand)                    # (e)
    ok_ver, total, n = passo_verificacao()                                      # (f)
    gravar_build_info(proto, mods, total, n)                                    # (g)
    log(f"tempo: {(dt.datetime.now() - t0).total_seconds():.0f} s")
    if not ok_ver:
        return 1
    if not ok_asm:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
