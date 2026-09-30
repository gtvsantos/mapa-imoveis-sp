#!/usr/bin/env python3
"""Atualiza os dados públicos do ITBI (e, opcionalmente, o IPTU do GeoSampa) e regenera o site.

Lógica:
  1. Baixa a página de listagem da Secretaria da Fazenda e extrai os links .xlsx que contenham "itbi"
     (um por ano; o do ano corrente traz só a data de geração no nome). Ignora .ods.
  2. Compara com o manifesto raw/itbi_manifest.json (url, nome, tamanho via HEAD, last-modified).
     Novo = ano ausente no manifesto, ou url/nome/tamanho/last_modified diferentes.
  3. Baixa só o que é novo, educadamente (User-Agent de navegador, 1 por vez, 8 s de pausa, para .part e
     renomeia; valida o zip/xlsx). Antes de sobrescrever raw/ITBI_{ano}.xlsx, arquiva a geração anterior em
     raw/_geracoes/ITBI_{ano}_{aaaammdd}.xlsx (decisão I-026 do DECISOES.md: a Prefeitura regera os arquivos;
     cada geração é guardada).
  4. Roda a cadeia, em ordem e com o cwd de cada script (os caminhos são relativos ao próprio arquivo):
     research/01_stage_raw.py <anos alterados> → 02_typed.py → 05_geo.py → 06_analitico.py → proto/build_data.py →
     proto/build_flips.py, build_aluguel.py, build_contexto.py, build_terrenos.py (opcionais: falha vira aviso) →
     build_site.py (aqui).
     Com --iptu: consulta o GeoSampa (TreeGeneric layerId=352), baixa um exercício IPTU_{ano}.zip que ainda não
     exista em raw/iptu/ e roda research/03_iptu_hist.py <ano> antes do 05_geo.py.
  5. Log em atualizacoes.log (append, com data) e resumo no stdout. Sem novidade e sem --force: só informa e sai 0.

    python3 atualizar_dados.py --dry-run           # mostra anos/URLs detectados e o que faria; nada é baixado
    python3 atualizar_dados.py --dry-run --head    # idem, conferindo tamanho/last-modified por HEAD
    python3 atualizar_dados.py                     # baixa o que mudou e roda a cadeia
    python3 atualizar_dados.py --anos 2025 2026    # só estes anos
    python3 atualizar_dados.py --so-baixar         # baixa e para
    python3 atualizar_dados.py --so-site           # só remonta o site (build_site.py)
    python3 atualizar_dados.py --publicar          # ao final, git add/commit/push do site (o GitHub Pages republica)
    python3 atualizar_dados.py --force             # rebaixa tudo e roda tudo
    python3 atualizar_dados.py --iptu              # também procura exercício novo do IPTU no GeoSampa

Regra do ano no nome do arquivo:
  - 4 dígitos isolados entre 2006 e 2100 → ano (ex.: guias_de_itbi_pagas_2018.xlsx, GUIAS_DE_ITBI_PAGAS_12-2022.xlsx);
  - senão, ddmmaaaa (8 dígitos) → data_ref = a data e ano = aaaa; MAS se a data cai em janeiro ou fevereiro, o arquivo
    é o fechamento do ano anterior (ano = aaaa − 1): "GUIAS DE ITBI PAGAS (28012026) XLS.xlsx" é 2025 fechado, e
    "guias-de-itbi-pagas-27082026-xls-xlsx" é o ano corrente 2026. Sem esse ajuste os dois cairiam em 2026.
  - Se dois links disputam o mesmo ano, o de ano explícito vence; o de data vai para o próprio aaaa (se livre).
    Conflitos não resolvidos param com aviso — ninguém sobrescreve um ano por engano.

Página de listagem (--pagina): sem argumento, tenta na ordem as candidatas em PAGINAS e fica com a primeira que
responde com links. Em 30/09/2026 só a primeira (og:url da página salva em raw/page_31501.html) respondia; as
duas seguintes, indicadas na especificação, redirecionam para 404 no portal novo (Liferay).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

SITE = Path(__file__).resolve().parent
ITBI_PADRAO = (SITE.parent / "data" / "cache" / "itbi").resolve()
LOG = SITE / "atualizacoes.log"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")
PAGINAS = [
    # og:url da página salva em raw/page_31501.html — respondia 200 com 21 links xlsx em 30/09/2026
    "https://prefeitura.sp.gov.br/web/fazenda/w/acesso_a_informacao/31501",
    # endereços da especificação: em 30/09/2026 ambos redirecionavam para uma página 404 do portal novo
    "https://www.prefeitura.sp.gov.br/cidade/secretarias/fazenda/servicos/itbi/index.php?p=31501",
    "https://capital.sp.gov.br/web/fazenda/w/servicos/itbi/dados_das_transacoes_imobiliarias",
]
PAUSA = 8            # segundos entre downloads
TIMEOUT = 60
ANO_MIN, ANO_MAX = 2006, 2100

# GeoSampa (ver raw/FONTES.md): lista e download genérico da camada 352 (Lote → pasta "IPTU")
GEOSAMPA = "https://novogeosampa.prefeitura.sp.gov.br"
IPTU_TREE = GEOSAMPA + "/Download/Nas/TreeGeneric?layerId=352&path=&depth=1&includeFiles=true"
IPTU_DOWNLOAD = GEOSAMPA + "/Download/DownloadGeneric"
IPTU_BASE = r"\\nas.prodam\du0110_download\GEOPORTAL_DOWNLOAD_SEM_INTERACAO\12_Cadastro\IPTU_INTER"
IPTU_ANO_MIN = 2010  # a cadeia usa o histórico de 2010 em diante


# ───────────────────────────── log ─────────────────────────────
class Log:
    def __init__(self, gravar: bool):
        self.gravar = gravar
        self.linhas: list[str] = []

    def __call__(self, *a):
        msg = " ".join(str(x) for x in a)
        print(msg, flush=True)
        self.linhas.append(msg)
        if self.gravar:
            with LOG.open("a", encoding="utf-8") as fh:
                fh.write(f"[{dt.datetime.now().astimezone().isoformat(timespec='seconds')}] {msg}\n")


# ───────────────────────────── HTTP ─────────────────────────────
def _instalar_ssl():
    """Certificados: o Python do python.org vem sem a cadeia do sistema (erro CERTIFICATE_VERIFY_FAILED). Usa o
    pacote certifi quando existir; senão, o padrão do interpretador. Com proxy corporativo que reassina TLS, rode
    com o python3 do Miniforge (que enxerga a cadeia) ou exporte SSL_CERT_FILE apontando para o CA do proxy."""
    import ssl
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:   # noqa: BLE001
        ctx = ssl.create_default_context()
    urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx)))


_instalar_ssl()


def _req(url: str, metodo="GET", dados: bytes | None = None, extra: dict | None = None) -> urllib.request.Request:
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "pt-BR,pt;q=0.9"}
    if extra:
        h.update(extra)
    return urllib.request.Request(url, data=dados, headers=h, method=metodo)


def http_get(url: str, timeout=TIMEOUT, extra: dict | None = None) -> tuple[int, bytes, dict, str]:
    """(status, corpo, cabeçalhos, url final). Erros HTTP voltam como status (não levantam)."""
    try:
        with urllib.request.urlopen(_req(url, extra=extra), timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read() if e.fp else b"", dict(e.headers or {}), url


def http_head(url: str, timeout=TIMEOUT) -> dict:
    """{tamanho, last_modified, etag, status}. Se HEAD não for aceito, tenta GET com Range 0-0 (sem baixar)."""
    meta = {"tamanho": None, "last_modified": None, "etag": None, "status": None}
    try:
        with urllib.request.urlopen(_req(url, "HEAD"), timeout=timeout) as r:
            h, meta["status"] = r.headers, r.status
    except urllib.error.HTTPError as e:
        if e.code in (403, 405, 501):
            try:
                with urllib.request.urlopen(_req(url, extra={"Range": "bytes=0-0"}), timeout=timeout) as r:
                    h, meta["status"] = r.headers, r.status
                    cr = h.get("Content-Range", "")
                    if "/" in cr and cr.rsplit("/", 1)[1].isdigit():
                        meta["tamanho"] = int(cr.rsplit("/", 1)[1])
            except (urllib.error.URLError, OSError) as e2:
                meta["erro"] = str(e2); return meta
        else:
            meta["status"], meta["erro"] = e.code, str(e); return meta
    except (urllib.error.URLError, OSError) as e:
        meta["erro"] = str(e); return meta
    if meta["tamanho"] is None and h.get("Content-Length", "").isdigit():
        meta["tamanho"] = int(h["Content-Length"])
    meta["last_modified"] = h.get("Last-Modified")
    meta["etag"] = h.get("ETag")
    return meta


def baixar_para(url: str, dest: Path, log: Log, dados: bytes | None = None, extra: dict | None = None) -> int:
    """Baixa em blocos para dest (o chamador passa o .part). Devolve os bytes gravados."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = _req(url, "POST" if dados is not None else "GET", dados, extra)
    t0 = time.time()
    n = 0
    with urllib.request.urlopen(req, timeout=300) as r, dest.open("wb") as fh:
        total = int(r.headers.get("Content-Length") or 0)
        while True:
            bloco = r.read(1 << 20)
            if not bloco:
                break
            fh.write(bloco); n += len(bloco)
            if total and n % (20 << 20) < (1 << 20):
                print(f"    {n / 1e6:.0f}/{total / 1e6:.0f} MB", end="\r", flush=True)
    log(f"    {n / 1e6:.1f} MB em {time.time() - t0:.0f} s")
    return n


def xlsx_valido(p: Path) -> bool:
    try:
        with zipfile.ZipFile(p) as z:
            if z.testzip() is not None:
                return False
            return any(n.startswith("xl/") for n in z.namelist())
    except (zipfile.BadZipFile, OSError):
        return False


def zip_valido(p: Path) -> bool:
    try:
        with zipfile.ZipFile(p) as z:
            return z.testzip() is None and bool(z.namelist())
    except (zipfile.BadZipFile, OSError):
        return False


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for bloco in iter(lambda: fh.read(1 << 22), b""):
            h.update(bloco)
    return h.hexdigest()


# ───────────────────────────── listagem ─────────────────────────────
RE_HREF = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.I)
RE_ANO = re.compile(r"(?<!\d)(20\d\d)(?!\d)")
RE_DATA = re.compile(r"(?<!\d)(\d{2})(\d{2})(20\d{2})(?!\d)")


def ano_do_nome(nome: str) -> tuple[int | None, str | None, str]:
    """(ano, data_ref ISO ou None, origem 'ano'|'data'|'?'). Regra documentada no cabeçalho."""
    anos = [int(a) for a in RE_ANO.findall(nome) if ANO_MIN <= int(a) <= ANO_MAX]
    if anos:
        return anos[-1], None, "ano"
    m = RE_DATA.search(nome)
    if m:
        d, mth, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            data = dt.date(a, mth, d)
        except ValueError:
            return None, None, "?"
        ano = a - 1 if mth <= 2 else a      # gerado em jan/fev → fechamento do ano anterior
        return ano, data.isoformat(), "data"
    return None, None, "?"


def extrair_links(pagina_html: str, base: str) -> list[dict]:
    vistos, itens = set(), []
    for href in RE_HREF.findall(pagina_html):
        href = html.unescape(href).strip()
        low = href.lower()
        if "itbi" not in low or "xlsx" not in low or ".ods" in low:
            continue
        url = urllib.parse.urljoin(base, href)
        # espaços literais → %20, sem reescrever os %28 já codificados
        url = urllib.parse.quote(url, safe=":/%()?=&+,;@$!*'_-.~")
        if url in vistos:
            continue
        vistos.add(url)
        nome = urllib.parse.unquote(url.rstrip("/").rsplit("/", 1)[-1])
        ano, data_ref, origem = ano_do_nome(nome)
        if ano is None:
            ano, data_ref, origem = ano_do_nome(urllib.parse.unquote(url))
        itens.append({"ano": ano, "url": url, "nome": nome, "data_ref": data_ref, "origem": origem})
    return itens


def resolver_conflitos(itens: list[dict], log: Log) -> dict[int, dict]:
    """Um item por ano. Explícito vence data; item de data que perde vai para o próprio aaaa se estiver livre."""
    por_ano: dict[int, dict] = {}
    pendentes = []
    for it in sorted(itens, key=lambda x: (x["origem"] != "ano", x["data_ref"] or "")):
        if it["ano"] is None:
            log(f"  AVISO: sem ano reconhecível, ignorado: {it['nome']}  {it['url']}")
            continue
        if it["ano"] not in por_ano:
            por_ano[it["ano"]] = it
        else:
            pendentes.append(it)
    for it in pendentes:
        alt = int(it["data_ref"][:4]) if it["data_ref"] else None
        if alt and alt not in por_ano:
            log(f"  AVISO: {it['nome']} disputava {it['ano']} com {por_ano[it['ano']]['nome']}; vai para {alt}")
            it["ano"] = alt
            por_ano[alt] = it
        else:
            raise SystemExit(f"ERRO: dois arquivos para o ano {it['ano']}: {por_ano[it['ano']]['nome']} × {it['nome']} "
                             f"— ajuste a regra do ano (ano_do_nome) antes de baixar")
    return dict(sorted(por_ano.items()))


def descobrir_pagina(candidatas: list[str], log: Log) -> tuple[str, list[dict]]:
    for url in candidatas:
        st, corpo, _, final = http_get(url)
        if st != 200:
            log(f"  listagem {url} → HTTP {st} (final: {final})")
            continue
        itens = extrair_links(corpo.decode("utf-8", "replace"), final)
        if not itens:
            log(f"  listagem {url} → 200, mas sem links xlsx de ITBI")
            continue
        return final, itens
    raise SystemExit("ERRO: nenhuma página de listagem respondeu com links; passe --pagina URL")


# ───────────────────────────── manifesto e conferência ─────────────────────────────
def carregar_manifesto(p: Path) -> dict:
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise SystemExit(f"ERRO: manifesto ilegível {p}: {e}")
    return {"anos": {}}


def salvar_manifesto(p: Path, m: dict, pagina: str):
    m["pagina"] = pagina
    m["atualizado_em"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    m["anos"] = dict(sorted(m["anos"].items()))
    p.write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def conferir(item: dict, manifesto: dict, raw: Path, fazer_head: bool, force: bool) -> tuple[bool, str, dict]:
    """(novo?, motivo, meta do HEAD). Sem manifesto para o ano, um arquivo local do mesmo tamanho vale como atual."""
    ano = str(item["ano"])
    reg = manifesto["anos"].get(ano)
    local = raw / f"ITBI_{ano}.xlsx"
    meta = http_head(item["url"]) if fazer_head else {}
    if force:
        return True, "--force", meta
    if reg is None:
        if not local.exists():
            return True, "ano sem manifesto e sem arquivo local", meta
        if not fazer_head:
            return False, "sem manifesto; arquivo local existe (seria conferido por HEAD)", meta
        if meta.get("tamanho") is None:
            return False, "sem manifesto; servidor sem Content-Length → arquivo local assumido atual (use --force)", meta
        if meta["tamanho"] == local.stat().st_size:
            return False, "sem manifesto; arquivo local tem o tamanho do servidor → registrado como atual", meta
        return True, f"sem manifesto; tamanho difere (local {local.stat().st_size} × servidor {meta['tamanho']})", meta
    if reg.get("url") != item["url"]:
        return True, f"url mudou ({reg.get('url')} → {item['url']})", meta
    if reg.get("nome") != item["nome"]:
        return True, f"nome mudou ({reg.get('nome')} → {item['nome']})", meta
    if fazer_head:
        if meta.get("tamanho") is not None and reg.get("tamanho") is not None and meta["tamanho"] != reg["tamanho"]:
            return True, f"tamanho mudou ({reg['tamanho']} → {meta['tamanho']})", meta
        if meta.get("last_modified") and reg.get("last_modified") and meta["last_modified"] != reg["last_modified"]:
            return True, f"last-modified mudou ({reg['last_modified']} → {meta['last_modified']})", meta
    if not local.exists():
        return True, "manifesto tem o ano, mas raw/ITBI_{ano}.xlsx sumiu", meta
    return False, "igual ao manifesto", meta


def registrar(manifesto: dict, item: dict, meta: dict, arquivo: Path, calcular_sha: bool = True):
    st = arquivo.stat()
    manifesto["anos"][str(item["ano"])] = {
        "url": item["url"], "nome": item["nome"],
        "tamanho": meta.get("tamanho") or st.st_size,
        "last_modified": meta.get("last_modified"), "etag": meta.get("etag"),
        "data_ref": item["data_ref"],
        "baixado_em": dt.datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(timespec="seconds"),
        "sha256": sha256(arquivo) if calcular_sha else None,
    }


def arquivar_geracao(raw: Path, ano: int, log: Log):
    atual = raw / f"ITBI_{ano}.xlsx"
    if not atual.exists():
        return
    carimbo = dt.datetime.fromtimestamp(atual.stat().st_mtime).strftime("%Y%m%d")
    dest = raw / "_geracoes" / f"ITBI_{ano}_{carimbo}.xlsx"
    dest.parent.mkdir(exist_ok=True)
    if dest.exists():   # duas gerações no mesmo dia: acrescenta a hora
        dest = dest.with_name(f"ITBI_{ano}_{dt.datetime.fromtimestamp(atual.stat().st_mtime).strftime('%Y%m%d_%H%M%S')}.xlsx")
    shutil.move(str(atual), str(dest))
    log(f"    geração anterior arquivada em {dest.relative_to(raw)}")


def baixar_itbi(item: dict, raw: Path, log: Log) -> bool:
    ano = item["ano"]
    part = raw / f"ITBI_{ano}.xlsx.part"
    log(f"  baixando {ano}: {item['nome']}")
    try:
        baixar_para(item["url"], part, log)
    except (urllib.error.URLError, OSError) as e:
        log(f"    ERRO no download: {e}")
        part.unlink(missing_ok=True)
        return False
    if not xlsx_valido(part):
        log("    ERRO: o arquivo baixado não é um xlsx válido (zip corrompido ou página HTML); descartado")
        part.unlink(missing_ok=True)
        return False
    arquivar_geracao(raw, ano, log)
    part.rename(raw / f"ITBI_{ano}.xlsx")
    return True


# ───────────────────────────── IPTU (GeoSampa) ─────────────────────────────
def iptu_listar(log: Log) -> list[dict]:
    st, corpo, _, _ = http_get(IPTU_TREE, extra={"Referer": GEOSAMPA + "/", "Accept": "application/json"})
    if st != 200:
        log(f"  GeoSampa TreeGeneric → HTTP {st}; IPTU não conferido")
        return []
    try:
        arvore = json.loads(corpo)
    except json.JSONDecodeError:
        log("  GeoSampa TreeGeneric: resposta não é JSON; IPTU não conferido")
        return []
    itens = []
    for f in arvore.get("node", {}).get("children", []):
        m = re.fullmatch(r"IPTU_(\d{4})\.zip", f.get("name", ""))
        if f.get("type") == "file" and m:
            itens.append({"ano": int(m.group(1)), "nome": f["name"], "relativePath": f.get("relativePath"),
                          "tamanho": f.get("size"), "modificado": f.get("modified")})
    return sorted(itens, key=lambda x: x["ano"])


def iptu_novos(itens: list[dict], raw_iptu: Path) -> list[dict]:
    novos = []
    for it in itens:
        if it["ano"] < IPTU_ANO_MIN:
            continue
        if (raw_iptu / it["nome"]).exists() or (raw_iptu / f"iptu_{it['ano']}_slim.parquet").exists():
            continue
        novos.append(it)
    return novos


def iptu_baixar(it: dict, raw_iptu: Path, log: Log) -> bool:
    part = raw_iptu / (it["nome"] + ".part")
    corpo = json.dumps({"IdLayer": 352, "RelativePathAndFile": it["relativePath"], "FileName": it["nome"],
                        "BasePath": IPTU_BASE}).encode()
    log(f"  baixando IPTU {it['ano']}: {it['nome']} ({(it['tamanho'] or 0) / 1e6:.0f} MB)")
    try:
        baixar_para(IPTU_DOWNLOAD, part, log, dados=corpo,
                    extra={"Content-Type": "application/json", "Referer": GEOSAMPA + "/"})
    except (urllib.error.URLError, OSError) as e:
        log(f"    ERRO no download: {e}")
        part.unlink(missing_ok=True)
        return False
    if not zip_valido(part):
        log("    ERRO: zip inválido; descartado")
        part.unlink(missing_ok=True)
        return False
    part.rename(raw_iptu / it["nome"])
    return True


# ───────────────────────────── cadeia ─────────────────────────────
def escolher_python(pedido: str | None) -> str:
    if pedido:
        return pedido
    for cand in (shutil.which("python3.12"), "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"):
        if cand and Path(cand).exists():
            return cand
    return sys.executable


def rodar(py: str, script: Path, args: list[str], log: Log, tempos: dict, opcional=False) -> bool:
    nome = script.name
    if not script.exists():
        log(f"  {'AVISO' if opcional else 'ERRO'}: {script} não existe")
        if opcional:
            return False
        raise SystemExit(1)
    log(f"→ {nome} {' '.join(args)}".rstrip())
    t0 = time.time()
    r = subprocess.run([py, str(script), *args], cwd=str(script.parent))
    tempos[nome] = time.time() - t0
    if r.returncode != 0:
        msg = f"  {nome} terminou com código {r.returncode} após {tempos[nome]:.0f} s"
        if opcional:
            log("  AVISO (opcional):" + msg)
            return False
        log("  ERRO:" + msg)
        raise SystemExit(r.returncode)
    log(f"  ok em {tempos[nome]:.0f} s")
    return True


def tamanho_site() -> str:
    total = n = 0
    for raiz, dirs, files in os.walk(SITE):
        dirs[:] = [d for d in dirs if d not in {".git", "__pycache__", ".venv"}]
        for f in files:
            try:
                total += Path(raiz, f).stat().st_size; n += 1
            except OSError:
                pass
    return f"{total / 1e6:.1f} MB em {n} arquivos"


# ───────────────────────────── main ─────────────────────────────
def publicar(log) -> bool:
    """git add / commit / push na pasta do site — só se houver mudança. O GitHub Pages (branch main, raiz)
    republica sozinho em 1–2 minutos. Nunca faz force-push nem mexe em outro repositório."""
    def git(*args):
        r = subprocess.run(["git", *args], cwd=SITE, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"git {' '.join(args)}: {(r.stderr or r.stdout).strip()}")
        return r.stdout
    if not (SITE / ".git").exists():
        log("publicar: a pasta do site não é um repositório git (git init + remoto antes)"); return False
    try:
        git("add", "-A")
        if not git("status", "--porcelain").strip():
            log("publicar: nada mudou desde o último commit; nada a enviar"); return True
        meta = {}
        try:
            meta = json.loads((SITE / "data.json").read_text()).get("meta", {})
        except Exception:   # noqa: BLE001
            pass
        msg = f"Dados atualizados: ITBI até {meta.get('last_date', '?')} (séries até {meta.get('last_q', '?')}; montagem {meta.get('built', '?')})"
        git("commit", "-q", "-m", msg)
        branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
        git("push", "origin", branch)
        log(f"publicar: commit + push em {branch} — \"{msg}\"; o GitHub Pages republica em ~1–2 min")
        return True
    except RuntimeError as e:
        log(f"publicar: FALHOU — {e}"); return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Atualiza os dados públicos (ITBI) e regenera o site.")
    ap.add_argument("--itbi-dir", default=os.environ.get("ITBI_DIR", str(ITBI_PADRAO)),
                    help=f"pasta data/cache/itbi (raw/, research/, proto/); padrão: env ITBI_DIR ou {ITBI_PADRAO}")
    ap.add_argument("--pagina", default=None, help="URL da página de listagem (padrão: descobre entre as candidatas)")
    ap.add_argument("--python", default=None, help="interpretador da cadeia (padrão: python3.12 no PATH, o do Framework, ou este)")
    ap.add_argument("--dry-run", action="store_true", help="só mostra o que faria (não baixa, não roda a cadeia, não grava log)")
    ap.add_argument("--head", action="store_true", help="no --dry-run, também confere tamanho/last-modified por HEAD")
    ap.add_argument("--force", action="store_true", help="rebaixa todos os anos e roda tudo")
    ap.add_argument("--so-baixar", action="store_true", help="baixa o que é novo e para (não roda a cadeia)")
    ap.add_argument("--so-site", action="store_true", help="só remonta o site (build_site.py)")
    ap.add_argument("--iptu", action="store_true", help="também procura exercício novo do IPTU no GeoSampa")
    ap.add_argument("--anos", nargs="*", type=int, default=None, help="limita aos anos indicados (ex.: --anos 2025 2026)")
    ap.add_argument("--publicar", action="store_true", help="ao final, git add/commit/push na pasta do site (só se algo mudou); o GitHub Pages republica sozinho")
    a = ap.parse_args()

    itbi = Path(a.itbi_dir).expanduser().resolve()
    raw, research, proto = itbi / "raw", itbi / "research", itbi / "proto"
    py = escolher_python(a.python)
    log = Log(gravar=not a.dry_run)
    t_ini = time.time()
    tempos: dict[str, float] = {}
    log(f"=== atualizar_dados {'(dry-run) ' if a.dry_run else ''}itbi={itbi} python={py}")
    if not raw.is_dir() or not research.is_dir() or not proto.is_dir():
        log(f"ERRO: esperava raw/, research/ e proto/ em {itbi}")
        return 3

    build_site = [py, str(SITE / "build_site.py"), "--proto", str(proto)]
    if a.so_site:
        if a.dry_run:
            log("faria: " + " ".join(build_site)); return 0
        ok = rodar(py, SITE / "build_site.py", ["--proto", str(proto)], log, tempos, opcional=True)
        log(f"site: {tamanho_site()} · {time.time() - t_ini:.0f} s")
        if a.publicar and ok:
            return 0 if publicar(log) else 1
        return 0 if ok else 1

    # 1. listagem
    pagina, itens = descobrir_pagina([a.pagina] if a.pagina else PAGINAS, log)
    log(f"listagem: {pagina} → {len(itens)} links xlsx de ITBI")
    por_ano = resolver_conflitos(itens, log)
    if a.anos:
        por_ano = {k: v for k, v in por_ano.items() if k in set(a.anos)}
        log(f"limitado a --anos {sorted(a.anos)} → {len(por_ano)} anos")

    # 2. manifesto e conferência
    manifesto_p = raw / "itbi_manifest.json"
    manifesto = carregar_manifesto(manifesto_p)
    fazer_head = (not a.dry_run) or a.head
    novos, atuais = [], []
    for ano, it in por_ano.items():
        novo, motivo, meta = conferir(it, manifesto, raw, fazer_head, a.force)
        it["meta"], it["motivo"] = meta, motivo
        (novos if novo else atuais).append(it)
        tam = f"{meta['tamanho'] / 1e6:.1f} MB" if meta.get("tamanho") else "—"
        log(f"  {ano}  {'NOVO ' if novo else 'ok   '} {it['nome']}  [{it['origem']}{', ' + it['data_ref'] if it['data_ref'] else ''}]"
            f"  {tam}  {meta.get('last_modified') or ''}\n        {it['url']}\n        {motivo}")
        if fazer_head:
            time.sleep(1)
        # ano local que ainda não estava no manifesto e bateu no tamanho: registra para as próximas rodadas
        if not novo and str(ano) not in manifesto["anos"] and fazer_head and meta.get("tamanho") and not a.dry_run:
            registrar(manifesto, it, meta, raw / f"ITBI_{ano}.xlsx")

    # anos do manifesto que sumiram da listagem (a Prefeitura às vezes troca o nome/caminho)
    sumiram = [k for k in manifesto["anos"] if int(k) not in por_ano and (not a.anos or int(k) in set(a.anos))]
    if sumiram:
        log(f"  AVISO: anos no manifesto que não aparecem mais na listagem: {', '.join(sumiram)} (arquivo local mantido)")

    # IPTU
    iptu_lista_novos: list[dict] = []
    if a.iptu:
        lista = iptu_listar(log)
        iptu_lista_novos = iptu_novos(lista, raw / "iptu")
        log(f"IPTU (GeoSampa): {len(lista)} exercícios listados; novos (≥ {IPTU_ANO_MIN}, sem zip nem parquet local): "
            + (", ".join(str(x['ano']) for x in iptu_lista_novos) or "nenhum"))

    # 3. plano / dry-run
    anos_novos = [it["ano"] for it in novos]
    log(f"novos: {anos_novos or 'nenhum'}")
    if a.dry_run:
        if not novos and not iptu_lista_novos and not a.force:
            log("dry-run: sem novidade — nada seria feito (build_site só com --so-site ou --force)")
            return 0
        plano = []
        for it in novos:
            plano.append(f"baixar {it['url']} → raw/ITBI_{it['ano']}.xlsx (arquivando a geração anterior em raw/_geracoes/)")
        for it in iptu_lista_novos:
            plano.append(f"baixar IPTU {it['nome']} (POST DownloadGeneric) → raw/iptu/ e rodar 03_iptu_hist.py {it['ano']}")
        if a.so_baixar:
            plano.append("parar (--so-baixar)")
        else:
            if anos_novos or a.force:
                plano += [f"01_stage_raw.py {' '.join(map(str, anos_novos)) if not a.force else '(todos)'}", "02_typed.py"]
            plano += ["05_geo.py", "06_analitico.py", "build_data.py",
                      "build_flips.py, build_aluguel.py, build_contexto.py, build_terrenos.py (opcionais)",
                      "build_site.py --proto " + str(proto)]
        log("dry-run: faria, nesta ordem:")
        for i, p in enumerate(plano, 1):
            log(f"  {i}. {p}")
        return 0

    if not novos and not iptu_lista_novos and not a.force:
        log(f"sem novidade · {time.time() - t_ini:.0f} s")
        salvar_manifesto(manifesto_p, manifesto, pagina)
        if a.publicar:   # ainda pode haver mudança de código/montagem para publicar
            return 0 if publicar(log) else 1
        return 0

    # 4. downloads
    baixados = []
    for i, it in enumerate(novos):
        if i:
            time.sleep(PAUSA)
        if baixar_itbi(it, raw, log):
            registrar(manifesto, it, it["meta"], raw / f"ITBI_{it['ano']}.xlsx")
            baixados.append(it["ano"])
            salvar_manifesto(manifesto_p, manifesto, pagina)
        else:
            log(f"  {it['ano']} não atualizado; a cadeia usa a geração anterior")
    iptu_baixados = []
    for it in iptu_lista_novos:
        time.sleep(PAUSA)
        if iptu_baixar(it, raw / "iptu", log):
            iptu_baixados.append(it["ano"])
    salvar_manifesto(manifesto_p, manifesto, pagina)
    tempos["downloads"] = time.time() - t_ini
    if a.so_baixar:
        log(f"baixados: ITBI {baixados or 'nenhum'} · IPTU {iptu_baixados or 'nenhum'} · parando (--so-baixar)")
        return 0
    if not baixados and not iptu_baixados and not a.force:
        log("nenhum download concluiu; cadeia não roda")
        return 1

    # 5. cadeia
    for ano in iptu_baixados:
        rodar(py, research / "03_iptu_hist.py", [str(ano)], log, tempos)
    if baixados or a.force:
        rodar(py, research / "01_stage_raw.py", [] if a.force else [str(x) for x in baixados], log, tempos)
        rodar(py, research / "02_typed.py", [], log, tempos)
    rodar(py, research / "05_geo.py", [], log, tempos)
    rodar(py, research / "06_analitico.py", [], log, tempos)
    rodar(py, proto / "build_data.py", [], log, tempos)
    for opc in ("build_flips.py", "build_aluguel.py", "build_contexto.py", "build_terrenos.py"):
        rodar(py, proto / opc, [], log, tempos, opcional=True)
    ok_site = rodar(py, SITE / "build_site.py", ["--proto", str(proto)], log, tempos, opcional=True)

    # resumo
    log("=== resumo")
    log(f"  novos: ITBI {baixados or 'nenhum'} · IPTU {iptu_baixados or 'nenhum'}")
    for k, v in tempos.items():
        log(f"  {k:<22} {v:7.0f} s")
    log(f"  site: {tamanho_site()} · build_site {'ok' if ok_site else 'FALHOU (ver acima)'}")
    log(f"  total: {time.time() - t_ini:.0f} s")
    if a.publicar and ok_site:
        return 0 if publicar(log) else 1
    return 0 if ok_site else 1


if __name__ == "__main__":
    sys.exit(main())
