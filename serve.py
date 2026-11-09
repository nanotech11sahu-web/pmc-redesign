#!/usr/bin/env python3
"""Local preview server: serves this folder and proxies /api/mobile/* to the live site.
(The live API sends no CORS headers, so a browser can only reach it same-origin.)
Usage: python3 serve.py [port]
"""
import sys, urllib.request, urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

LIVE = "https://pmcyellowpages.com"


class H(SimpleHTTPRequestHandler):
    def _proxy(self):
        body = None
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            body = self.rfile.read(n)
        hdrs = {"User-Agent": "PMCWebPreview/1.0", "Accept": "application/json"}
        for k in ("Authorization", "Content-Type"):
            if self.headers.get(k):
                hdrs[k] = self.headers[k]
        req = urllib.request.Request(LIVE + self.path, data=body, headers=hdrs, method=self.command)
        try:
            r = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as e:
            r = e
        data = r.read()
        self.send_response(r.status if hasattr(r, "status") else r.code)
        self.send_header("Content-Type", r.headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._proxy()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._proxy()
        self.send_error(405)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"http://localhost:{port}")
    ThreadingHTTPServer(("", port), H).serve_forever()
