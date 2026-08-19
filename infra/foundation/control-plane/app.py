import hmac
import json
import os
import re
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import redis

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
CONTROL_TOKEN = os.environ.get("AIRA_CONTROL_PLANE_TOKEN", "")
PORT = int(os.environ.get("PORT", "8080"))
FAILURE_THRESHOLD = max(1, int(os.environ.get("PROVIDER_FAILURE_THRESHOLD", "3")))
PROVIDER_COOLDOWN_MS = max(1000, int(os.environ.get("PROVIDER_COOLDOWN_MS", "30000")))
PROVIDER_CONFIG_COOLDOWN_MS = max(1000, int(os.environ.get("PROVIDER_CONFIG_COOLDOWN_MS", "60000")))
QUEUE_MAX_DEPTH = max(10, int(os.environ.get("QUEUE_MAX_DEPTH", "2000")))
LEASE_TTL_MS = max(5000, int(os.environ.get("ADMISSION_LEASE_TTL_MS", "300000")))
ADMISSION_LIMITS = {
    "search": max(1, int(os.environ.get("ADMISSION_SEARCH_LIMIT", "120"))),
    "deep-research": max(1, int(os.environ.get("ADMISSION_DEEP_LIMIT", "24"))),
    "agent": max(1, int(os.environ.get("ADMISSION_AGENT_LIMIT", "16"))),
}
JOB_TYPE_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")

client = redis.Redis.from_url(
    REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=2,
    socket_timeout=3,
    health_check_interval=30,
)

ADMIT_SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local lease = ARGV[3]
local max_count = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
local count = redis.call('ZCARD', key)
if count >= max_count then
  return {0, count}
end
redis.call('ZADD', key, expires, lease)
redis.call('PEXPIRE', key, math.max(expires - now + 60000, 60000))
return {1, count + 1}
"""


def payload(ok, data=None, error=None):
    body = {"ok": bool(ok)}
    if data is not None:
        body["data"] = data
    if error:
        body["error"] = str(error)
    return body


def provider_key(provider_id):
    return f"aira:provider-health:{provider_id}"


def stream_key(job_type):
    return f"aira:jobs:{job_type}"


def group_name(job_type):
    return f"aira-foundation-{job_type}"


class Handler(BaseHTTPRequestHandler):
    server_version = "AIRAControlPlane/1.0"

    def log_message(self, fmt, *args):
        print(json.dumps({"component": "control-plane", "message": fmt % args}), flush=True)

    def _json(self, status, body):
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _authorized(self):
        supplied = self.headers.get("X-AIRA-Control-Token", "")
        return bool(CONTROL_TOKEN) and hmac.compare_digest(supplied, CONTROL_TOKEN)

    def _read(self, max_bytes=262144):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("invalid content length")
        if length <= 0 or length > max_bytes:
            raise ValueError("invalid request size")
        raw = self.rfile.read(length)
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("JSON body must be an object")
        return value

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            try:
                pong = client.ping()
                self._json(200 if pong else 503, payload(bool(pong), {"redis": bool(pong)}))
            except Exception:
                self._json(503, payload(False, error="redis unavailable"))
            return

        if not self._authorized():
            self._json(401, payload(False, error="unauthorized"))
            return

        match = re.fullmatch(r"/v1/providers/([^/]+)/allowed", parsed.path)
        if match:
            provider_id = unquote(match.group(1))[:80]
            state = client.hgetall(provider_key(provider_id))
            now_ms = int(time.time() * 1000)
            opened_until = int(state.get("opened_until", "0") or 0)
            failures = int(state.get("failures", "0") or 0)
            self._json(
                200,
                payload(True, {
                    "allowed": opened_until <= now_ms,
                    "failures": failures,
                    "retryAfterMs": max(0, opened_until - now_ms),
                }),
            )
            return

        self._json(404, payload(False, error="not found"))

    def do_POST(self):
        if not self._authorized():
            self._json(401, payload(False, error="unauthorized"))
            return
        try:
            body = self._read()
            parsed = urlparse(self.path)

            if parsed.path == "/v1/admit":
                kind = str(body.get("kind", ""))
                request_id = str(body.get("requestId", ""))[:160]
                if kind not in ADMISSION_LIMITS or not request_id:
                    raise ValueError("invalid admission request")
                now_ms = int(time.time() * 1000)
                lease_id = f"{kind}:{uuid.uuid4()}"
                result = client.eval(
                    ADMIT_SCRIPT,
                    1,
                    f"aira:admission:{kind}",
                    now_ms,
                    now_ms + LEASE_TTL_MS,
                    lease_id,
                    ADMISSION_LIMITS[kind],
                )
                allowed = int(result[0]) == 1
                self._json(
                    200,
                    payload(True, {
                        "allowed": allowed,
                        "leaseId": lease_id if allowed else None,
                        "retryAfterMs": 0 if allowed else 1000,
                        "inFlight": int(result[1]),
                    }),
                )
                return

            if parsed.path == "/v1/release":
                lease_id = str(body.get("leaseId", ""))[:200]
                if ":" not in lease_id:
                    raise ValueError("invalid lease")
                kind = lease_id.split(":", 1)[0]
                if kind not in ADMISSION_LIMITS:
                    raise ValueError("invalid lease kind")
                released = client.zrem(f"aira:admission:{kind}", lease_id) > 0
                self._json(200, payload(True, {"released": released}))
                return

            match = re.fullmatch(r"/v1/providers/([^/]+)/outcome", parsed.path)
            if match:
                provider_id = unquote(match.group(1))[:80]
                outcome = str(body.get("outcome", ""))
                failure_class = str(body.get("failureClass", "") or "")
                key = provider_key(provider_id)
                if outcome == "success":
                    client.delete(key)
                elif outcome == "failure":
                    if failure_class in {"transient", "quota", "configuration"}:
                        failures = int(client.hincrby(key, "failures", 1))
                        now_ms = int(time.time() * 1000)
                        cooldown = PROVIDER_CONFIG_COOLDOWN_MS if failure_class == "configuration" else PROVIDER_COOLDOWN_MS
                        opened_until = now_ms + cooldown if failures >= FAILURE_THRESHOLD else 0
                        client.hset(key, mapping={"opened_until": opened_until, "last_failure": now_ms})
                        client.pexpire(key, max(cooldown * 4, 120000))
                else:
                    raise ValueError("invalid provider outcome")
                self._json(200, payload(True, {"recorded": True}))
                return

            if parsed.path == "/v1/jobs/enqueue":
                job_type = str(body.get("type", ""))
                job_payload = body.get("payload")
                attempts = int(body.get("attempts", 0) or 0)
                if not JOB_TYPE_RE.fullmatch(job_type) or not isinstance(job_payload, dict):
                    raise ValueError("invalid job")
                key = stream_key(job_type)
                if client.xlen(key) >= QUEUE_MAX_DEPTH:
                    self._json(429, payload(False, error="queue saturated"))
                    return
                job_id = client.xadd(
                    key,
                    {
                        "payload": json.dumps(job_payload, separators=(",", ":")),
                        "attempts": str(max(0, attempts)),
                        "enqueuedAt": str(int(time.time() * 1000)),
                    },
                    maxlen=QUEUE_MAX_DEPTH,
                    approximate=False,
                )
                self._json(200, payload(True, {"jobId": job_id}))
                return

            if parsed.path == "/v1/jobs/claim":
                job_type = str(body.get("type", ""))
                worker_id = str(body.get("workerId", ""))[:120]
                if not JOB_TYPE_RE.fullmatch(job_type) or not worker_id:
                    raise ValueError("invalid claim")
                key = stream_key(job_type)
                group = group_name(job_type)
                try:
                    client.xgroup_create(key, group, id="0", mkstream=True)
                except redis.ResponseError as exc:
                    if "BUSYGROUP" not in str(exc):
                        raise

                entries = []
                try:
                    reclaimed = client.xautoclaim(key, group, worker_id, min_idle_time=60000, start_id="0-0", count=1)
                    if reclaimed and len(reclaimed) >= 2 and reclaimed[1]:
                        entries = [(key, reclaimed[1])]
                except (AttributeError, redis.ResponseError):
                    entries = []
                if not entries:
                    entries = client.xreadgroup(group, worker_id, {key: ">"}, count=1, block=1000)
                if not entries:
                    self._json(200, payload(True, {"job": None}))
                    return
                _, messages = entries[0]
                message_id, fields = messages[0]
                self._json(
                    200,
                    payload(True, {
                        "job": {
                            "id": message_id,
                            "type": job_type,
                            "payload": json.loads(fields.get("payload", "{}")),
                            "attempts": int(fields.get("attempts", "0") or 0),
                        }
                    }),
                )
                return

            if parsed.path == "/v1/jobs/ack":
                job_type = str(body.get("type", ""))
                job_id = str(body.get("jobId", ""))[:120]
                if not JOB_TYPE_RE.fullmatch(job_type) or not job_id:
                    raise ValueError("invalid ack")
                acked = client.xack(stream_key(job_type), group_name(job_type), job_id)
                self._json(200, payload(True, {"acked": int(acked)}))
                return

            self._json(404, payload(False, error="not found"))
        except (ValueError, json.JSONDecodeError) as exc:
            self._json(400, payload(False, error=str(exc)))
        except redis.RedisError:
            self._json(503, payload(False, error="redis unavailable"))
        except Exception as exc:
            print(json.dumps({"component": "control-plane", "error": type(exc).__name__}), flush=True)
            self._json(500, payload(False, error="internal error"))


if __name__ == "__main__":
    if not CONTROL_TOKEN:
        raise SystemExit("AIRA_CONTROL_PLANE_TOKEN is required")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
