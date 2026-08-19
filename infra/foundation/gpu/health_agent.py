#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import urllib.request


def parse_gpu_rows(raw):
    rows = []
    for line in raw.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 6:
            continue
        try:
            rows.append({
                "uuid": parts[0],
                "temperature_c": float(parts[1]),
                "memory_total_mb": float(parts[2]),
                "memory_used_mb": float(parts[3]),
                "ecc_uncorrected": int(float(parts[4])),
                "utilization_pct": float(parts[5]),
            })
        except ValueError:
            continue
    return rows


def collect_nvidia_smi():
    cmd = [
        "nvidia-smi",
        "--query-gpu=uuid,temperature.gpu,memory.total,memory.used,ecc.errors.uncorrected.volatile.total,utilization.gpu",
        "--format=csv,noheader,nounits",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10, check=True)
    return parse_gpu_rows(proc.stdout)


def evaluate(rows, max_temp, max_memory_pct, max_ecc):
    reasons = []
    if not rows:
        reasons.append("no_gpu_telemetry")
    for row in rows:
        memory_pct = 0 if row["memory_total_mb"] <= 0 else row["memory_used_mb"] / row["memory_total_mb"] * 100
        row["memory_used_pct"] = round(memory_pct, 2)
        if row["temperature_c"] > max_temp:
            reasons.append(f"{row['uuid']}:temperature")
        if memory_pct > max_memory_pct:
            reasons.append(f"{row['uuid']}:memory_pressure")
        if row["ecc_uncorrected"] > max_ecc:
            reasons.append(f"{row['uuid']}:uncorrected_ecc")
    return {"healthy": not reasons, "reasons": reasons, "gpus": rows}


def report_to_control_plane(healthy):
    base = os.environ.get("AIRA_CONTROL_PLANE_URL", "").rstrip("/")
    token = os.environ.get("AIRA_CONTROL_PLANE_TOKEN", "")
    provider = os.environ.get("AIRA_GPU_PROVIDER_ID", "self-hosted")
    if not base or not token:
        return False
    body = {"outcome": "success" if healthy else "failure"}
    if not healthy:
        body["failureClass"] = "transient"
    request = urllib.request.Request(
        f"{base}/v1/providers/{provider}/outcome",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "X-AIRA-Control-Token": token},
    )
    with urllib.request.urlopen(request, timeout=4) as response:
        return response.status < 300


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture")
    parser.add_argument("--max-temp", type=float, default=float(os.environ.get("AIRA_GPU_MAX_TEMP_C", "85")))
    parser.add_argument("--max-memory-pct", type=float, default=float(os.environ.get("AIRA_GPU_MAX_MEMORY_PCT", "98")))
    parser.add_argument("--max-ecc", type=int, default=int(os.environ.get("AIRA_GPU_MAX_UNCORRECTED_ECC", "0")))
    parser.add_argument("--report", action="store_true")
    args = parser.parse_args()
    if args.fixture:
        with open(args.fixture, "r", encoding="utf-8") as handle:
            rows = json.load(handle)
    else:
        try:
            rows = collect_nvidia_smi()
        except Exception as exc:
            result = {"healthy": False, "reasons": [f"telemetry_error:{type(exc).__name__}"], "gpus": []}
            print(json.dumps(result, separators=(",", ":")))
            return 2
    result = evaluate(rows, args.max_temp, args.max_memory_pct, args.max_ecc)
    if args.report:
        try:
            result["reported"] = report_to_control_plane(result["healthy"])
        except Exception:
            result["reported"] = False
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["healthy"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
