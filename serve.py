#!/usr/bin/env python3
"""Servidor local só para testar o site (estático, sem proxy nenhum).

Entrega os arquivos desta pasta como o GitHub Pages faria, com duas conveniências:
- *.json e *.html saem com gzip (comprimido uma vez e guardado em memória; ≈5× menor);
- Cache-Control: no-store, para o navegador nunca ficar com um build antigo.
Recusa qualquer caminho fora desta pasta. Não sobe nem chama API alguma.

    python3 serve.py              # → http://127.0.0.1:8767/
    PORT=8800 python3 serve.py --quiet
"""
from __future__ import annotations

import functools
import gzip
import http.server
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8767"))
GZIP_EXT = {".json": "application/json; charset=utf-8", ".html": "text/html; charset=utf-8"}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
                      ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
                      ".md": "text/markdown; charset=utf-8"}
    _gz: dict = {}

    def do_GET(self):  # noqa: N802
        caminho = self.path.split("?", 1)[0].split("#", 1)[0]
        if caminho.endswith("/"):
            caminho += "index.html"
        f = (HERE / caminho.lstrip("/")).resolve()
        if HERE != f and HERE not in f.parents:          # fora da pasta do site
            self.send_error(403); return
        if f.suffix.lower() in GZIP_EXT and f.is_file():
            return self._gzip(f, GZIP_EXT[f.suffix.lower()])
        return super().do_GET()

    def _gzip(self, f: Path, ctype: str):
        key = (str(f), f.stat().st_mtime)
        body = self._gz.get(key)
        if body is None:
            body = self._gz[key] = gzip.compress(f.read_bytes(), 6)
        use_gz = "gzip" in self.headers.get("Accept-Encoding", "")
        data = body if use_gz else f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        if use_gz:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "--quiet" not in sys.argv:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.request_queue_size = 64   # a página pede vários JSON de uma vez
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=str(HERE)))
    print(f"Mapa Imóveis São Paulo: http://127.0.0.1:{PORT}/", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
