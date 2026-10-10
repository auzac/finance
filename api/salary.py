"""Stateless API endpoint: POST /api/salary.

Accepts a JSON salary growth request, returns ``200`` with the projection
result or ``400`` with a general message plus field-level errors. All
calculation logic lives in ``salary_growth.py``; this module only handles
HTTP concerns, mirroring ``calculate.py``.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from salary_growth import compute_salary_growth, ValidationError
except ImportError:  # pragma: no cover - when imported as part of the api package
    from .salary_growth import compute_salary_growth, ValidationError


def process_body(body):
    """Turn a raw request body into ``(status_code, response_payload)``."""
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return 400, {"error": "Request body must be valid JSON.", "errors": []}
    try:
        return 200, compute_salary_growth(payload)
    except ValidationError as exc:
        return 400, {"error": "Some inputs are invalid.", "errors": exc.errors}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        status, payload = process_body(self.rfile.read(length))
        self._send(status, payload)

    def _send(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
