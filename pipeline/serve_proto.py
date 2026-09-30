#!/usr/bin/env python3
"""Servidor local do Radar ITBI: arquivos estáticos (dist/*.json com gzip) + proxy /api/geo → geo_app (5113).

O geo_app do dashboard (fii.api.geo_app, 5113) não manda cabeçalhos CORS: com o HTML aberto via
file:// ou de outra porta, o navegador bloqueia os prédios LiDAR. Este servidor entrega o HTML e
repassa SÓ /api/geo/* ao 5113 na mesma origem (e com CORS, para quem abrir o HTML via file://).
Não sobe nem reinicia API nenhuma — só encaminha para o geo_app que já está no ar.

    python3 serve.py                  # http://127.0.0.1:8766/itbi_proto.html
    PORT=8800 GEO_TARGET=http://127.0.0.1:5113 python3 serve.py
"""
from __future__ import annotations

import functools
import gzip
import http.server
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8766"))
GEO = os.environ.get("GEO_TARGET", "http://127.0.0.1:5113").rstrip("/")
PASS_HEADERS = ("Content-Type", "Content-Encoding", "Vary", "Cache-Control")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
                      ".geojson": "application/geo+json; charset=utf-8", ".md": "text/markdown; charset=utf-8"}

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/api/geo/"):
            return self._proxy()
        if self.path.split("?")[0].endswith(".json"):
            return self._dist()
        return super().do_GET()

    _gz: dict = {}

    def _dist(self):
        """*.json (dist/{cd}.json e os dados dos módulos) comprimido com gzip na 1ª vez e guardado em memória (≈5× menor)."""
        f = (HERE / self.path.lstrip("/").split("?")[0]).resolve()
        if not f.is_file() or HERE not in f.parents:
            self.send_error(404); return
        key = (str(f), f.stat().st_mtime)
        body = self._gz.get(key)
        if body is None:
            body = self._gz[key] = gzip.compress(f.read_bytes(), 6)
        use_gz = "gzip" in self.headers.get("Accept-Encoding", "")
        data = body if use_gz else f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if use_gz:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def _proxy(self):
        req = urllib.request.Request(GEO + self.path,
                                     headers={"Accept-Encoding": self.headers.get("Accept-Encoding", "")})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                code, body, hdr = r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:  # 400/422 do geo_app: repassa o detalhe
            code, body, hdr = e.code, e.read(), e.headers
        except OSError as e:
            code, hdr = 502, {"Content-Type": "application/json"}
            body = ('{"detail":"geo_app (%s) indisponível: %s"}' % (GEO, str(e).replace('"', "'"))).encode()
        self.send_response(code)
        for k in PASS_HEADERS:
            v = hdr.get(k)
            if v:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")  # o HTML muda a cada build
        super().end_headers()

    def log_message(self, fmt, *args):
        if "--quiet" not in sys.argv:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.request_queue_size = 64   # vários JSON por página (módulos): a fila padrão (5) recusa conexões
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=str(HERE)))
    print(f"Radar ITBI: http://127.0.0.1:{PORT}/itbi_proto.html  (/api/geo → {GEO})", flush=True)
    srv.serve_forever()
