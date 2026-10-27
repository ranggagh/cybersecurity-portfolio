"""
Server pengembangan lokal untuk portfolio ini.

    python serve.py            -> http://localhost:5500/
    python serve.py 8080       -> port lain

Dibanding "python -m http.server":
- .js/.mjs selalu dikirim sebagai text/javascript. Di Windows, MIME bawaan diambil dari
  registry dan sering menjadi text/plain, sehingga browser menolak ES module (tools/*/tool.js).
- Cache-Control: no-store, agar perubahan JS/CSS langsung terbaca tanpa hard refresh.
"""

import http.server
import os
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
ROOT = os.path.dirname(os.path.abspath(__file__))


class DevHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class DualStackServer(http.server.ThreadingHTTPServer):
    """Melayani localhost lewat IPv4 dan IPv6."""

    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == "__main__":
    print(f"Serving {ROOT} on http://localhost:{PORT}/ (Ctrl+C to stop)", flush=True)
    try:
        DualStackServer(("::", PORT), DevHandler).serve_forever()
    except KeyboardInterrupt:
        pass
