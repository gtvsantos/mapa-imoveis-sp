#!/usr/bin/env python3
"""Checagem rápida de uma página do protótipo (Chrome do sistema + WebGL por software), via Playwright.

Abre cada hash, espera, grava captura e lista erros (pageerror, console.error e <html data-err>).
Requer o serve.py no ar (8766).

    python3.12 check.py '#/cidade' '#/distrito/62'                     # itbi_proto.html
    python3.12 check.py --page itbi_proto_flips.html '#/flips' --out /tmp/shots
    python3.12 check.py --dark --full '#/predio/62/046016000003'
    python3.12 check.py --eval "RADAR.cityMap.jumpTo({center:[-46.69,-23.56],zoom:15})" '#/cidade'
"""
import argparse
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("hashes", nargs="*", default=["#/cidade"])
ap.add_argument("--page", default="itbi_proto.html")
ap.add_argument("--out", default="/tmp/itbi_check")
ap.add_argument("--wait", type=int, default=6000, help="ms de espera por hash")
ap.add_argument("--dark", action="store_true")
ap.add_argument("--full", action="store_true", help="captura da página inteira")
ap.add_argument("--eval", action="append", default=[], help="JS a rodar depois de abrir cada hash (antes da captura)")
ap.add_argument("--width", type=int, default=1440)
a = ap.parse_args()
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
url = f"http://127.0.0.1:8766/{a.page}?v={int(time.time())}"
falhou = False
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": a.width, "height": 1100}, color_scheme="dark" if a.dark else "light")
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text) if m.type == "error" else None)
    first = True
    for h in a.hashes:
        errs.clear()
        if first:
            pg.goto(url + h); first = False
        else:
            pg.evaluate(f"location.hash = {h!r}")
        pg.wait_for_timeout(a.wait)
        for js in a.eval:
            pg.evaluate(js); pg.wait_for_timeout(a.wait)
        nome = re.sub(r"[^\w]+", "_", h).strip("_") or "raiz"
        f = out / f"{nome}{'_dark' if a.dark else ''}.png"
        pg.screenshot(path=str(f), full_page=a.full)
        derr = pg.evaluate("document.documentElement.dataset.err || ''")
        ruins = [e for e in errs if "favicon" not in e and "404" not in e]
        print(f"{h}: {'OK' if not (ruins or derr) else 'ERROS'} · {f}")
        for e in ruins[:8]:
            print("   ", e[:400])
        if derr:
            print("    data-err:", derr[:1500])
        falhou = falhou or bool(ruins or derr)
    b.close()
sys.exit(1 if falhou else 0)
