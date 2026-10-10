"""Local development server.

Serves the static frontend and the ``POST /api/calculate`` endpoint from the
same origin, mirroring how Vercel routes the app in production. Run with:

    python dev_server.py [port]
"""

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "api"))

from calculate import process_body  # noqa: E402


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path.rstrip("/") != "/api/calculate":
            self._send_json(404, {"error": "Not found."})
            return
        length = int(self.headers.get("Content-Length") or 0)
        status, payload = process_body(self.rfile.read(length))
        self._send_json(status, payload)

    def do_GET(self):
        if self.path.rstrip("/") == "/api/calculate":
            self._send_json(405, {"error": "Use POST for /api/calculate."})
            return
        super().do_GET()

    def _send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving financial calculator on http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), DevHandler).serve_forever()
