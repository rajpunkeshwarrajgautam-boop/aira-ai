#!/usr/bin/env python3
"""Dependency-free contract checks for the AIRA model factory.

This intentionally does not install Soup or download model weights. GPU/model execution
belongs in a separate hardware-capable gate; normal repository CI validates only the
committed contracts.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOUP_SHA = "6c13c44f5eb6bef67bbd39d83ec7269ac3c31dbf"
CORE_BASE = "Qwen/Qwen3.5-9B-Base"
SMOKE_BASE = "Qwen/Qwen3.5-0.8B"


def read(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file():
        raise AssertionError(f"required file missing: {relative}")
    return path.read_text(encoding="utf-8")


def load_json(relative: str) -> object:
    return json.loads(read(relative))


def validate_jsonl(relative: str) -> int:
    rows = 0
    for line_number, raw in enumerate(read(relative).splitlines(), start=1):
        if not raw.strip():
            continue
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise AssertionError(f"{relative}:{line_number} must be a JSON object")
        rows += 1
    if rows == 0:
        raise AssertionError(f"{relative} must contain at least one row")
    return rows


def main() -> None:
    pin = read("model-lab/requirements/soup-pin.txt")
    assert SOUP_SHA in pin, "Soup must stay pinned to the reviewed commit"
    assert "soup-cli[train,eval,data,serve]" in pin, "required Soup extras changed"
    assert "@ git+https://github.com/MakazhanAlpamys/Soup.git@" in pin

    core_config = read("model-lab/soup/core/sft.yaml")
    assert f"base: {CORE_BASE}" in core_config
    assert "task: sft" in core_config
    assert "modality: text" in core_config
    assert "stream_layers: false" in core_config, "streaming must be opt-in after backend proof"

    smoke_config = read("model-lab/soup/core/sft-smoke.yaml")
    assert f"base: {SMOKE_BASE}" in smoke_config
    assert "quantization: none" in smoke_config
    assert "stream_layers: false" in smoke_config

    schema = load_json("model-lab/data/schemas/dataset-manifest.schema.json")
    assert isinstance(schema, dict)
    assert schema.get("title") == "AIRA model dataset manifest"

    manifest = load_json("model-lab/data/manifests/core-v0.json")
    assert isinstance(manifest, dict)
    required = {
        "id",
        "purpose",
        "status",
        "source",
        "license",
        "permitted_use",
        "private_data",
        "training_allowed",
        "contamination_check",
        "provenance",
    }
    missing = sorted(required - manifest.keys())
    assert not missing, f"core-v0 manifest missing fields: {missing}"
    assert manifest["id"] == "aira-core-v0"
    assert manifest["status"] == "planned"
    assert manifest["training_allowed"] is False, "real Core training must remain fail-closed until provenance review"
    assert manifest["private_data"] is False
    assert manifest["contamination_check"]["status"] == "not_run"

    smoke_rows = validate_jsonl("model-lab/data/smoke/core-smoke.jsonl")
    eval_rows = validate_jsonl("model-lab/eval/data/core-v0-sanity.jsonl")
    assert smoke_rows >= 8
    assert eval_rows >= 5

    gate = read("model-lab/eval/configs/core-v0-gate.yaml")
    assert "scoring: exact" in gate
    assert "core-v0-sanity.jsonl" in gate

    registry = read(
        "perplexity-clone/my-turborepo/apps/web/src/services/models/aira-model-registry.ts"
    )
    for model_id in ("aira/edge", "aira/core", "aira/pro", "aira/ultra", "aira/apex"):
        assert f'id: "{model_id}"' in registry, f"missing registry id {model_id}"
    assert registry.count('evidenceState: "NOT_TESTED"') == 5
    assert registry.count('releaseState: "experiment"') == 5
    # Count concrete object-property lines only; the interface also declares the
    # same literal type and must not be mistaken for a sixth registry entry.
    assert registry.count('\t\texposure: "omniroute-discovered-only"') == 5
    assert CORE_BASE in registry

    ignore = read(".gitignore")
    for generated_path in (
        "model-lab/artifacts/",
        "model-lab/runs/",
        "model-lab/eval/reports/",
        "model-lab/data/core-v0/",
    ):
        assert generated_path in ignore, f"generated/private path is not ignored: {generated_path}"

    print(
        f"AIRA model-lab contracts pass: Soup {SOUP_SHA[:8]}, "
        f"{smoke_rows} smoke rows, {eval_rows} eval rows, Core training fail-closed."
    )


if __name__ == "__main__":
    main()
