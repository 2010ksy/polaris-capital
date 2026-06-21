#!/usr/bin/env python3
"""로컬 미리보기 서버 (Netlify 배포 전 확인용)

정적 파일을 서빙하고, Netlify Function(/api/market)을 흉내내어 시세를 프록시한다.
실제 Netlify 배포 시에는 netlify/functions/market.js 가 이 역할을 한다.

실행:  python3 preview.py   →  http://localhost:8800
"""
import os
import sys
import urllib.request
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/api/market"):
            return self._proxy()
        return super().do_GET()

    def _proxy(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        g = lambda k, d="": (qs.get(k) or [d])[0]
        if g("provider") == "naver":
            kind = "index" if g("kind") == "index" else "stock"
            url = f"https://polling.finance.naver.com/api/realtime/domestic/{kind}/{urllib.parse.quote(g('code'))}"
        else:
            sym = urllib.parse.quote(g("symbol"))
            p = f"interval={g('interval','1d')}"
            if g("range"):
                p += f"&range={g('range')}"
            if g("period1"):
                p += f"&period1={g('period1')}&period2={g('period2') or ''}"
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?{p}"
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=15) as r:
                body = r.read()
            self.send_response(200)
        except Exception as e:
            body = f'{{"error":"{e}"}}'.encode()
            self.send_response(502)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8800
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"로컬 미리보기 → http://localhost:{port}")
    print("(Netlify 배포 시에는 netlify/functions/market.js 가 /api/market 을 처리)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
