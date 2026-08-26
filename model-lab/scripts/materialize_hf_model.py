#!/usr/bin/env python3
"""Materialize an exact, reviewed Hugging Face model revision for AIRA experiments.

Normal CI uses --validate-only and performs no network/model download. Real model runs
materialize the exact revision into ignored model-lab/cache and record the resolved Hub
SHA so a moving `main` cannot silently change experiment weights.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "model-lab/models/base-models.json"
CACHE_ROOT = ROOT / "model-lab/cache/models"
RUN_ROOT = ROOT / "model-lab/runs"
SHA40 = re.compile(r"^[0-9a-f]{40}$")


def load_catalog() -> dict[str, Any]:
    value = json.loads(CATALOG.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise SystemExit("invalid base-model catalog")
    models = value.get("models")
    if not isinstance(models, dict) or not models:
        raise SystemExit("base-model catalog has no models")
    for key, entry in models.items():
        if not isinstance(entry, dict):
            raise SystemExit(f"model {key!r} must be an object")
        for field in ("repo_id", "revision", "license", "purpose"):
            if not isinstance(entry.get(field), str) or not entry[field]:
                raise SystemExit(f"model {key!r} missing {field}")
        if not SHA40.fullmatch(entry["revision"]):
            raise SystemExit(f"model {key!r} revision must be exact 40-character SHA")
    return value


def safe_name(repo_id: str) -> str:
    return repo_id.replace("/", "--").replace("\\", "--")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_key", nargs="?")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()

    catalog = load_catalog()
    models: dict[str, dict[str, str]] = catalog["models"]
    if args.validate_only:
        print(json.dumps({
            "status": "VALID",
            "models": {key: {"repo_id": value["repo_id"], "revision": value["revision"]} for key, value in models.items()},
        }, indent=2))
        return 0

    if not args.model_key or args.model_key not in models:
        raise SystemExit(f"model_key must be one of: {', '.join(sorted(models))}")

    entry = models[args.model_key]
    repo_id = entry["repo_id"]
    requested_revision = entry["revision"]

    from huggingface_hub import HfApi, snapshot_download

    info = HfApi().model_info(repo_id=repo_id, revision=requested_revision)
    resolved_revision = str(info.sha or "")
    if resolved_revision != requested_revision:
        raise SystemExit(
            f"Hub resolved {repo_id}@{requested_revision} to unexpected SHA {resolved_revision!r}"
        )

    local_dir = CACHE_ROOT / f"{safe_name(repo_id)}@{requested_revision[:12]}"
    local_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = snapshot_download(
        repo_id=repo_id,
        revision=requested_revision,
        local_dir=str(local_dir),
    )

    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    evidence = {
        "schema_version": 1,
        "model_key": args.model_key,
        "repo_id": repo_id,
        "requested_revision": requested_revision,
        "resolved_revision": resolved_revision,
        "license": entry["license"],
        "local_dir": str(Path(snapshot_path).resolve()),
        "status": "MATERIALIZED",
    }
    evidence_path = RUN_ROOT / f"materialized-{args.model_key}.json"
    evidence_path.write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(evidence, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
