#!/usr/bin/env python3
"""Create and optionally execute an auditable AIRA offline training stage.

The actual ML engine lives in an operator-approved container image. AIRA controls the
manifest, stage ordering, immutable dataset hash, resource envelope, output directory,
and promotion evidence rather than binding production to a volatile Python trainer API.
"""

import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time

STAGE_ORDER = {"sft": 10, "reward": 20, "dpo": 30, "ppo": 40, "eval": 90}
ALLOWED_ENTRYPOINTS = {
    "sft": "/opt/aira/train/sft",
    "reward": "/opt/aira/train/reward",
    "dpo": "/opt/aira/train/dpo",
    "ppo": "/opt/aira/train/ppo",
    "eval": "/opt/aira/train/eval",
}


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path):
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("config must be a JSON object")
    return value


def build_manifest(config_path, stage, dataset_path, output_root):
    config = load_json(config_path)
    if stage not in STAGE_ORDER:
        raise ValueError("unsupported training stage")
    base_model = str(config.get("baseModel", "")).strip()
    if not base_model:
        raise ValueError("baseModel is required")
    dataset_hash = sha256_file(dataset_path)
    config_hash = sha256_file(config_path)
    run_id = f"{stage}-{int(time.time())}-{dataset_hash[:10]}"
    run_dir = output_root / run_id
    manifest = {
        "schemaVersion": 1,
        "runId": run_id,
        "stage": stage,
        "stageOrder": STAGE_ORDER[stage],
        "baseModel": base_model,
        "dataset": str(dataset_path.resolve()),
        "datasetSha256": dataset_hash,
        "configSha256": config_hash,
        "trainingImage": str(config.get("trainingImage", "")).strip(),
        "resources": config.get("resources", {}),
        "hyperparameters": config.get("hyperparameters", {}),
        "parentArtifact": config.get("parentArtifact"),
        "evaluation": config.get("evaluation", {}),
        "createdAtUnix": int(time.time()),
        "status": "PLANNED",
    }
    if not manifest["trainingImage"]:
        raise ValueError("trainingImage is required")
    run_dir.mkdir(parents=True, exist_ok=False)
    manifest_path = run_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest, manifest_path, run_dir


def docker_command(manifest, manifest_path, run_dir):
    dataset = pathlib.Path(manifest["dataset"])
    entrypoint = ALLOWED_ENTRYPOINTS[manifest["stage"]]
    return [
        "docker", "run", "--rm",
        "--gpus", "all",
        "--network", "none",
        "--ipc", "host",
        "--security-opt", "no-new-privileges:true",
        "--read-only",
        "--tmpfs", "/tmp:size=8g,mode=1777",
        "-v", f"{dataset.resolve()}:/data/train.jsonl:ro",
        "-v", f"{manifest_path.resolve()}:/run/aira/manifest.json:ro",
        "-v", f"{run_dir.resolve()}:/output:rw",
        manifest["trainingImage"],
        entrypoint,
        "--manifest", "/run/aira/manifest.json",
        "--dataset", "/data/train.jsonl",
        "--output", "/output/artifact",
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=pathlib.Path)
    parser.add_argument("--stage", required=True, choices=sorted(STAGE_ORDER))
    parser.add_argument("--dataset", required=True, type=pathlib.Path)
    parser.add_argument("--output-root", type=pathlib.Path, default=pathlib.Path("training-runs"))
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    if not args.config.is_file() or not args.dataset.is_file():
        print(json.dumps({"ok": False, "error": "config or dataset not found"}))
        return 2

    try:
        manifest, manifest_path, run_dir = build_manifest(
            args.config, args.stage, args.dataset, args.output_root
        )
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2

    command = docker_command(manifest, manifest_path, run_dir)
    if not args.execute:
        print(json.dumps({"ok": True, "manifest": str(manifest_path), "execute": False}))
        return 0

    if os.environ.get("AIRA_TRAINING_EXECUTION_APPROVED", "").lower() != "true":
        print(json.dumps({"ok": False, "error": "AIRA_TRAINING_EXECUTION_APPROVED=true is required"}))
        return 3

    result = subprocess.run(command, check=False)
    manifest["status"] = "COMPLETED" if result.returncode == 0 else "FAILED"
    manifest["exitCode"] = result.returncode
    manifest["completedAtUnix"] = int(time.time())
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"ok": result.returncode == 0, "manifest": str(manifest_path)}))
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
