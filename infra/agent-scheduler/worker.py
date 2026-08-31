import json
import os
import time
import urllib.error
import urllib.request

BASE_URL = (
    os.environ.get("AIRA_AGENT_SCHEDULER_WEB_URL")
    or os.environ.get("AIRA_WEB_INTERNAL_URL")
    or ""
).rstrip("/")
TOKEN = os.environ.get("AIRA_AGENT_SCHEDULER_TOKEN", "")
INTERVAL_SECONDS = max(3, min(60, int(os.environ.get("AIRA_AGENT_SCHEDULER_INTERVAL_SECONDS", "5"))))
BATCH_LIMIT = max(
    1,
    min(
        20,
        int(
            os.environ.get("AIRA_AGENT_SCHEDULER_BATCH_SIZE")
            or os.environ.get("AIRA_AGENT_SCHEDULER_BATCH_LIMIT")
            or "8"
        ),
    ),
)


def tick() -> None:
    request = urllib.request.Request(
        f"{BASE_URL}/api/internal/agent-platform/tick?limit={BATCH_LIMIT}",
        method="POST",
        data=b"{}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "aira-agent-scheduler/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read(64 * 1024)
            body = json.loads(raw.decode("utf-8")) if raw else {}
            print(json.dumps({"component": "agent-scheduler", "status": response.status, "result": body}), flush=True)
    except urllib.error.HTTPError as exc:
        raw = exc.read(16 * 1024).decode("utf-8", errors="replace")
        print(json.dumps({"component": "agent-scheduler", "status": exc.code, "error": raw[:2000]}), flush=True)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(json.dumps({"component": "agent-scheduler", "status": "unreachable", "error": type(exc).__name__}), flush=True)


def main() -> None:
    if not BASE_URL.startswith("https://") and not BASE_URL.startswith("http://127.0.0.1") and not BASE_URL.startswith("http://localhost"):
        raise SystemExit("AIRA_AGENT_SCHEDULER_WEB_URL must use HTTPS outside loopback")
    if len(TOKEN) < 24:
        raise SystemExit("AIRA_AGENT_SCHEDULER_TOKEN must contain at least 24 characters")
    while True:
        started = time.monotonic()
        tick()
        elapsed = time.monotonic() - started
        time.sleep(max(0.5, INTERVAL_SECONDS - elapsed))


if __name__ == "__main__":
    main()
