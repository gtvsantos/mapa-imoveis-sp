#!/usr/bin/env python3
"""Monta itbi_proto.html a partir de src/ e injeta data.json entre /*__DATA__*/ … /*__END__*/.

Núcleo (um <script>, escopo fechado): helpers_siila.js + basemap.js + app.js → expõe window.RADAR.
Estilo: base.css + extra.css + src/m_*.css + central.css (camada final do design system Central).
Módulos (um <script> cada, isolados): src/m_*.js (+ src/m_*.css), que se registram em RADAR
(vistas, camadas, cores, seções). Um erro num módulo não derruba o núcleo nem os outros: vai para
<html data-err>. Depois dos módulos, RADAR.start() lê a URL e desenha.

Dados de módulos que não podem circular (fonte licenciada, uso interno) NUNCA entram aqui: o módulo
os busca com RADAR.loadJSON(...) no serve.py.

    python3 assemble.py                              # núcleo + todos os módulos → itbi_proto.html
    python3 assemble.py --modules m_flips,m_contexto # só estes módulos
    python3 assemble.py --exclude m_<licenciado>     # todos menos estes (spin-off público: sem o módulo da fonte licenciada)
    python3 assemble.py --modules none               # só o núcleo
    python3 assemble.py --out itbi_proto_flips.html  # outro arquivo (testes em paralelo)
    python3 assemble.py --brand "Mapa Imóveis São Paulo" --out ../../../../mapa-imoveis-sp/index.html \
        --exclude m_<licenciado> --flag publico      # marca própria, sem o módulo licenciado (é o que build_site.py faz)

--src e --data apontam para outra pasta de fontes/dados (padrão: src/ e data.json ao lado deste
arquivo). --brand troca o <title> e o nome no cabeçalho (body.html). --flag NOME liga
window.RADAR_FLAGS.NOME antes do núcleo (ex.: `publico` = site estático, sem /api/geo).
"""
import argparse
import json
from pathlib import Path

H = Path(__file__).resolve().parent
HEAD = """<!doctype html>
<meta charset="utf-8">
<title>{title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;1,400&family=Chivo+Mono:wght@400;500&display=swap">
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css">
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
"""
GUARD = ("if (!D || !D.meta || typeof echarts === 'undefined' || typeof maplibregl === 'undefined') { "
         "document.getElementById('main').innerHTML = '<div class=\"empty\">' + (!D ? 'Dados ausentes: rode python3 build_data.py.' : "
         "'Não foi possível carregar ECharts/MapLibre (jsDelivr).') + '</div>'; return; }\n")
BRAND_PADRAO = "Radar ITBI · São Paulo"


def modulo(nome: str, js: str) -> str:
    return ("<script>\n(function (R) {\n'use strict';\nif (!R) return;\ntry {\n" + js +
            f"\n}} catch (e) {{ R.logErr('{nome}: ' + (e && e.stack || e)); console.error('{nome}', e); }}\n}})(window.RADAR);\n</script>\n")


def montar(src: Path, data_path: Path, modules="all", exclude=(), brand=None, title=None, flags=()) -> str:
    todos = sorted(p.stem for p in src.glob("m_*.js"))
    mods = todos if modules == "all" else [] if modules == "none" else [m.strip() for m in modules.split(",") if m.strip()]
    faltam = [m for m in mods if m not in todos]
    if faltam:
        raise SystemExit(f"módulos inexistentes: {faltam} (há: {todos})")
    mods = [m for m in mods if m not in set(exclude)]
    data = data_path.read_text() if data_path.exists() else "null"
    css = (src / "base.css").read_text() + (src / "extra.css").read_text() + "".join(
        (src / f"{m}.css").read_text() for m in mods if (src / f"{m}.css").exists()) + (
        (src / "central.css").read_text() if (src / "central.css").exists() else "")   # Central: camada final
    body = (src / "body.html").read_text()
    if brand and brand != BRAND_PADRAO:
        if BRAND_PADRAO not in body:
            raise SystemExit(f"marca padrão {BRAND_PADRAO!r} não encontrada em body.html")
        body = body.replace(BRAND_PADRAO, brand)
    titulo = title or (brand.replace(" · ", " ") if brand else "Radar ITBI São Paulo")
    flag_js = ("<script>\nwindow.RADAR_FLAGS = " + json.dumps({f: True for f in flags}, ensure_ascii=False) + ";\n</script>\n") if flags else ""
    return (HEAD.format(title=titulo) + "<style>\n" + css + "</style>\n"
            + body
            + flag_js
            + "<script>\nconst D = /*__DATA__*/" + data + "/*__END__*/;\n</script>\n<script>\n'use strict';\n(function(){\n" + GUARD
            + (src / "helpers_siila.js").read_text() + "\n" + (src / "basemap.js").read_text() + "\n" + (src / "app.js").read_text()
            + "\n})();\n</script>\n"
            + "".join(modulo(m, (src / f"{m}.js").read_text()) for m in mods)
            + "<script>\nif (window.RADAR) window.RADAR.start();\n</script>\n"), mods


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modules", default="all", help="all | none | lista separada por vírgula (ex.: m_flips,m_contexto)")
    ap.add_argument("--exclude", default="", help="módulos a tirar da lista (ex.: o módulo da fonte licenciada, no spin-off público)")
    ap.add_argument("--out", default="itbi_proto.html")
    ap.add_argument("--src", default=str(H / "src"), help="pasta com os fontes (padrão: src/ ao lado deste arquivo)")
    ap.add_argument("--data", default=str(H / "data.json"), help="data.json a embutir (padrão: ao lado deste arquivo)")
    ap.add_argument("--brand", default=None, help=f"nome no cabeçalho (padrão: {BRAND_PADRAO!r})")
    ap.add_argument("--title", default=None, help="<title> da página (padrão: derivado da marca)")
    ap.add_argument("--flag", action="append", default=[], help="liga window.RADAR_FLAGS.<nome> (ex.: publico)")
    a = ap.parse_args()
    exclude = [m.strip() for m in a.exclude.split(",") if m.strip()]
    html, mods = montar(Path(a.src), Path(a.data), a.modules, exclude, a.brand, a.title, a.flag)
    out = Path(a.out) if Path(a.out).is_absolute() else H / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    print(out, round(len(html) / 1e6, 2), "MB", "· módulos:", ", ".join(mods) or "nenhum",
          ("· flags: " + ",".join(a.flag)) if a.flag else "")


if __name__ == "__main__":
    main()
