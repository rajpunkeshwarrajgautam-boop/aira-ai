import hmac
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("AIRA_SANDBOX_TOKEN", "")
UPSTREAM = os.environ.get("AIRA_SANDBOX_UPSTREAM", "http://sandbox:8080").rstrip("/")
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY_BYTES = int(os.environ.get("AIRA_SANDBOX_GATEWAY_MAX_BODY_BYTES", "50000"))


def upstream_request(path, method="GET", body=None, timeout=15):
    request = urllib.request.Request(
        f"{UPSTREAM}{path}",
        method=method,
        data=body,
        headers={
            "Accept": "application/json",
            "X-AIRA-Sandbox-Token": TOKEN,
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read(256 * 1024), response.headers.get("Content-Type", "application/json")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(256 * 1024), exc.headers.get("Content-Type", "application/json")


class Handler(BaseHTTPRequestHandler):
    server_version = "AIRASandboxGateway/1.0"

    def log_message(self, fmt, *args):
        print(json.dumps({"component": "sandbox-gateway", "message": fmt % args}), flush=True)

    def authorized(self):
        supplied = self.headers.get("X-AIRA-Sandbox-Token", "")
        return bool(TOKEN) and hmac.compare_digest(supplied, TOKEN)

    def send_payload(self, status, raw, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type if content_type.startswith("application/json") else "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_json(self, status, body):
        raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_payload(status, raw)

    def do_GET(self):
        if self.path != "/healthz":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            status, raw, content_type = upstream_request("/healthz", timeout=3)
            self.send_payload(status, raw, content_type)
        except (urllib.error.URLError, TimeoutError, OSError):
            self.send_json(503, {"ok": False, "error": "sandbox unavailable"})

    def do_POST(self):
        if self.path != "/v1/execute":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        if not self.authorized():
            self.send_json(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"ok": False, "error": "invalid content length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(413, {"ok": False, "error": "request too large"})
            return
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"ok": False, "error": "invalid JSON"})
            return
        if not isinstance(value, dict) or value.get("language") != "python" or not isinstance(value.get("code"), str):
            self.send_json(400, {"ok": False, "error": "invalid sandbox request"})
            return
        canonical = json.dumps(
            {"language": "python", "code": value["code"]},
            separators=(",", ":"),
        ).encode("utf-8")
        try:
            status, response, content_type = upstream_request(
                "/v1/execute",
                method="POST",
                body=canonical,
                timeout=15,
            )
            self.send_payload(status, response, content_type)
        except (urllib.error.URLError, TimeoutError, OSError):
            self.send_json(503, {"ok": False, "error": "sandbox unavailable"})


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("AIRA_SANDBOX_TOKEN is required")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
