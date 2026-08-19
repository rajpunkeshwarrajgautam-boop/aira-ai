import hmac
import json
import os
import resource
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("AIRA_SANDBOX_TOKEN", "")
PORT = int(os.environ.get("PORT", "8080"))
MAX_CODE_BYTES = int(os.environ.get("AIRA_SANDBOX_MAX_CODE_BYTES", "20000"))
MAX_OUTPUT_BYTES = int(os.environ.get("AIRA_SANDBOX_MAX_OUTPUT_BYTES", "65536"))
MAX_WALL_SECONDS = min(max(int(os.environ.get("AIRA_SANDBOX_MAX_WALL_SECONDS", "8")), 1), 30)
MAX_MEMORY_BYTES = min(max(int(os.environ.get("AIRA_SANDBOX_MAX_MEMORY_BYTES", str(256 * 1024 * 1024))), 64 * 1024 * 1024), 1024 * 1024 * 1024)


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (MAX_MEMORY_BYTES, MAX_MEMORY_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (max(1, MAX_WALL_SECONDS - 1), MAX_WALL_SECONDS))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    if hasattr(resource, "RLIMIT_NPROC"):
        resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))


class Handler(BaseHTTPRequestHandler):
    server_version = "AIRASandbox/1.0"

    def log_message(self, fmt, *args):
        print(json.dumps({"component": "sandbox", "message": fmt % args}), flush=True)

    def send_json(self, status, body):
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def authorized(self):
        supplied = self.headers.get("X-AIRA-Sandbox-Token", "")
        return bool(TOKEN) and hmac.compare_digest(supplied, TOKEN)

    def do_GET(self):
        if self.path == "/healthz":
            self.send_json(200, {"ok": True, "runtime": "python-isolated"})
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/v1/execute":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        if not self.authorized():
            self.send_json(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_CODE_BYTES * 2:
                raise ValueError("invalid request size")
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            if body.get("language") != "python":
                raise ValueError("only python is supported")
            code = body.get("code")
            if not isinstance(code, str) or not code.strip() or len(code.encode("utf-8")) > MAX_CODE_BYTES:
                raise ValueError("invalid code")
            started = time.monotonic()
            with tempfile.TemporaryDirectory(prefix="aira-", dir="/tmp") as workdir:
                try:
                    completed = subprocess.run(
                        [sys.executable, "-I", "-S", "-c", code],
                        cwd=workdir,
                        env={"PYTHONIOENCODING": "utf-8", "PYTHONHASHSEED": "0"},
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=False,
                        timeout=MAX_WALL_SECONDS,
                        preexec_fn=limits,
                        check=False,
                    )
                    stdout = completed.stdout[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")
                    stderr = completed.stderr[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")
                    result = {
                        "ok": True,
                        "exitCode": completed.returncode,
                        "stdout": stdout,
                        "stderr": stderr,
                        "durationMs": int((time.monotonic() - started) * 1000),
                        "truncated": len(completed.stdout) > MAX_OUTPUT_BYTES or len(completed.stderr) > MAX_OUTPUT_BYTES,
                    }
                    self.send_json(200, result)
                except subprocess.TimeoutExpired:
                    self.send_json(408, {"ok": False, "error": "execution timed out"})
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            print(json.dumps({"component": "sandbox", "error": type(exc).__name__}), flush=True)
            self.send_json(500, {"ok": False, "error": "execution failed"})


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("AIRA_SANDBOX_TOKEN is required")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
