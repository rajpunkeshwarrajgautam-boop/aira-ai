#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

CONTROL_URL = os.environ.get("AIRA_CONTROL_PLANE_URL", "http://127.0.0.1:8090").rstrip("/")
CONTROL_TOKEN = os.environ.get("AIRA_CONTROL_PLANE_TOKEN", "")
SANDBOX_URL = os.environ.get("AIRA_SANDBOX_URL", "http://127.0.0.1:8091").rstrip("/")
SANDBOX_TOKEN = os.environ.get("AIRA_SANDBOX_TOKEN", "")


def request_json(url, method="GET", body=None, headers=None, expected=(200,), timeout=5):
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        url,
        method=method,
        data=data,
        headers={"Accept": "application/json", **({"Content-Type": "application/json"} if data else {}), **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(1024 * 1024)
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            if response.status not in expected:
                raise AssertionError(f"{url}: expected {expected}, got {response.status}: {payload}")
            return response.status, payload
    except urllib.error.HTTPError as exc:
        raw = exc.read(1024 * 1024)
        payload = json.loads(raw.decode("utf-8")) if raw else {}
        if exc.code not in expected:
            raise AssertionError(f"{url}: expected {expected}, got {exc.code}: {payload}") from exc
        return exc.code, payload


def wait_health(url, attempts=30):
    last = None
    for _ in range(attempts):
        try:
            status, payload = request_json(url, timeout=2)
            if status == 200 and payload.get("ok") is True:
                return
        except Exception as exc:
            last = exc
        time.sleep(1)
    raise AssertionError(f"health check failed for {url}: {last}")


def control(path, body=None, expected=(200,)):
    return request_json(
        f"{CONTROL_URL}{path}",
        method="GET" if body is None else "POST",
        body=body,
        headers={"X-AIRA-Control-Token": CONTROL_TOKEN},
        expected=expected,
    )


def sandbox(code):
    status, payload = request_json(
        f"{SANDBOX_URL}/v1/execute",
        method="POST",
        body={"language": "python", "code": code},
        headers={"X-AIRA-Sandbox-Token": SANDBOX_TOKEN},
        expected=(200,),
        timeout=15,
    )
    assert status == 200 and payload.get("ok") is True, payload
    return payload


def assert_admission():
    leases = []
    for _ in range(2):
        _, response = control(
            "/v1/admit",
            {"kind": "search", "requestId": str(uuid.uuid4())},
        )
        lease = response["data"]
        assert lease["allowed"] is True and lease.get("leaseId"), response
        leases.append(lease["leaseId"])

    _, response = control(
        "/v1/admit",
        {"kind": "search", "requestId": str(uuid.uuid4())},
    )
    assert response["data"]["allowed"] is False, response

    control("/v1/release", {"leaseId": leases.pop()})
    _, response = control(
        "/v1/admit",
        {"kind": "search", "requestId": str(uuid.uuid4())},
    )
    replacement = response["data"]
    assert replacement["allowed"] is True and replacement.get("leaseId"), response
    leases.append(replacement["leaseId"])

    for lease_id in leases:
        control("/v1/release", {"leaseId": lease_id})


def assert_provider_circuit():
    provider = f"smoke-{uuid.uuid4().hex[:12]}"
    _, response = control(f"/v1/providers/{provider}/allowed")
    assert response["data"]["allowed"] is True, response

    for _ in range(3):
        control(
            f"/v1/providers/{provider}/outcome",
            {"outcome": "failure", "failureClass": "transient"},
        )
    _, response = control(f"/v1/providers/{provider}/allowed")
    assert response["data"]["allowed"] is False, response
    assert response["data"]["failures"] >= 3, response

    control(f"/v1/providers/{provider}/outcome", {"outcome": "success"})
    _, response = control(f"/v1/providers/{provider}/allowed")
    assert response["data"]["allowed"] is True, response
    assert response["data"]["failures"] == 0, response


def assert_queue_recovery():
    job_type = f"smoke.queue.{uuid.uuid4().hex[:10]}"
    for index in range(10):
        _, response = control(
            "/v1/jobs/enqueue",
            {"type": job_type, "payload": {"index": index}},
        )
        assert response["data"].get("jobId"), response

    _, claimed = control(
        "/v1/jobs/claim",
        {"type": job_type, "workerId": "smoke-worker"},
    )
    job = claimed["data"].get("job")
    assert job and job.get("id"), claimed

    status, saturated = control(
        "/v1/jobs/enqueue",
        {"type": job_type, "payload": {"index": 10}},
        expected=(429,),
    )
    assert status == 429 and saturated.get("ok") is False, saturated

    _, acked = control(
        "/v1/jobs/ack",
        {"type": job_type, "jobId": job["id"]},
    )
    assert int(acked["data"]["acked"]) == 1, acked

    _, recovered = control(
        "/v1/jobs/enqueue",
        {"type": job_type, "payload": {"index": 11}},
    )
    assert recovered["data"].get("jobId"), recovered


def assert_sandbox():
    result = sandbox("print(6 * 7)")
    assert result.get("exitCode") == 0 and result.get("stdout", "").strip() == "42", result

    result = sandbox(
        "import os\n"
        "bad=[k for k in os.environ if k.startswith(('AIRA_','SUPABASE_','OPENAI_','NVIDIA_','AUTOGPT_'))]\n"
        "print('NO_APP_SECRETS' if not bad else 'LEAK:' + ','.join(sorted(bad)))\n"
        "raise SystemExit(0 if not bad else 7)\n"
    )
    assert result.get("exitCode") == 0 and "NO_APP_SECRETS" in result.get("stdout", ""), result

    result = sandbox(
        "import socket\n"
        "try:\n"
        "    s=socket.create_connection(('1.1.1.1', 443), timeout=1)\n"
        "    s.close()\n"
        "    print('NETWORK_OPEN')\n"
        "    raise SystemExit(9)\n"
        "except OSError:\n"
        "    print('NETWORK_BLOCKED')\n"
    )
    assert result.get("exitCode") == 0 and "NETWORK_BLOCKED" in result.get("stdout", ""), result


def main():
    if not CONTROL_TOKEN or not SANDBOX_TOKEN:
        print(json.dumps({"ok": False, "error": "smoke test tokens are required"}))
        return 2

    wait_health(f"{CONTROL_URL}/healthz")
    wait_health(f"{SANDBOX_URL}/healthz")
    assert_admission()
    assert_provider_circuit()
    assert_queue_recovery()
    assert_sandbox()
    print(json.dumps({"ok": True, "checks": ["admission", "providerCircuit", "queueRecovery", "sandbox"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
