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
CORE_REVISION = "68c46c4b3498877f3ef123c856ecfde50c39f404"
SMOKE_REVISION = "2fc06364715b967f1860aea9cf38778875588b17"


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

    base_models = load_json("model-lab/models/base-models.json")
    assert isinstance(base_models, dict)
    assert base_models.get("schema_version") == 1
    models = base_models.get("models")
    assert isinstance(models, dict)
    assert models["core-base"]["repo_id"] == CORE_BASE
    assert models["core-base"]["revision"] == CORE_REVISION
    assert models["core-base"]["license"] == "apache-2.0"
    assert models["core-smoke"]["repo_id"] == SMOKE_BASE
    assert models["core-smoke"]["revision"] == SMOKE_REVISION
    assert models["core-smoke"]["license"] == "apache-2.0"

    core_config = read("model-lab/soup/core/sft.yaml")
    assert f"base: {CORE_BASE}" in core_config
    assert "task: sft" in core_config
    assert "modality: text" in core_config
    assert "format: chatml" in core_config, "Core intake emits messages and must train as ChatML"
    assert "stream_layers: false" in core_config, "streaming must be opt-in after backend proof"

    smoke_config = read("model-lab/soup/core/sft-smoke.yaml")
    assert f"base: {SMOKE_BASE}" in smoke_config
    assert "format: alpaca" in smoke_config, "committed smoke fixture is Alpaca instruction/input/output"
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

    source_catalog = load_json("model-lab/data/sources/core-v0-candidates.json")
    assert isinstance(source_catalog, dict)
    assert source_catalog.get("schema_version") == 1
    sources = source_catalog.get("sources")
    assert isinstance(sources, list) and len(sources) >= 4
    for source in sources:
        assert isinstance(source, dict)
        assert source.get("approved_for_training") is False, (
            f"source {source.get('id')} became training-approved without an explicit reviewed manifest change"
        )
        assert isinstance(source.get("revision"), str) and len(source["revision"]) == 40
        assert source.get("license_review") in {"metadata_clear", "needs_review", "approved"}
        assert source.get("provenance_review") in {"needs_review", "approved"}
        assert source.get("contamination_review") in {"not_run", "needs_review", "approved"}

    dataset_builder = read("model-lab/scripts/prepare_core_dataset.py")
    assert '"messages": messages' in dataset_builder
    assert "approved_for_training" in dataset_builder
    assert "frozen_eval_exact_prompt_overlap_removed" in dataset_builder
    assert "high_confidence_secret_filter" in dataset_builder
    assert '"training_manifest_promotion": "NOT_AUTOMATIC"' in dataset_builder

    smoke_rows = validate_jsonl("model-lab/data/smoke/core-smoke.jsonl")
    eval_rows = validate_jsonl("model-lab/eval/data/core-v0-sanity.jsonl")
    assert smoke_rows >= 8
    assert eval_rows >= 5

    gate = read("model-lab/eval/configs/core-v0-gate.yaml")
    assert "scoring: exact" in gate
    assert "core-v0-sanity.jsonl" in gate

    backend_probe = read("model-lab/scripts/verify_amd_backend.py")
    assert 'EXPECTED_GFX = "gfx1201"' in backend_probe
    assert '"PARTIALLY_VERIFIED"' in backend_probe
    assert '["soup", "doctor"]' in backend_probe
    assert "torch.version" in backend_probe
    assert "bitsandbytes" in backend_probe

    materializer = read("model-lab/scripts/materialize_hf_model.py")
    assert "snapshot_download" in materializer
    assert "requested_revision" in materializer
    assert "resolved_revision != requested_revision" in materializer

    runtime_config = read("model-lab/scripts/make_runtime_soup_config.py")
    assert "expected exactly one base: line" in runtime_config
    assert "args.base.resolve()" in runtime_config

    adapter_probe = read("model-lab/scripts/verify_smoke_adapter.py")
    assert SMOKE_BASE in adapter_probe
    assert "PeftModel.from_pretrained" in adapter_probe
    assert '"adapter_active"' in adapter_probe
    assert '".inner."' in adapter_probe

    windows_operator = read("model-lab/scripts/windows/run-rx9070xt-smoke.ps1")
    assert "device-gfx1201" in windows_operator
    assert "2.12.0+rocm7.14.0" in windows_operator
    assert "soup-pin.txt" in windows_operator
    assert "sft-smoke.yaml" in windows_operator
    assert "materialize_hf_model.py" in windows_operator
    assert "make_runtime_soup_config.py" in windows_operator
    assert "verify_amd_backend.py" in windows_operator
    assert "verify_smoke_adapter.py" in windows_operator
    assert "AIRA RX 9070 XT SOUP SMOKE = VERIFIED" in windows_operator

    evidence_schema = load_json("model-lab/eval/schemas/model-evidence.schema.json")
    assert isinstance(evidence_schema, dict)
    assert evidence_schema.get("title") == "AIRA model release evidence"
    release_gate = read("model-lab/scripts/check_release_gate.py")
    assert "release_candidate_failures" in release_gate
    assert "production_failures" in release_gate
    assert "omniroute_discovered" in release_gate

    registry = read(
        "perplexity-clone/my-turborepo/apps/web/src/services/models/aira-model-registry.ts"
    )
    for model_id in ("aira/edge", "aira/core", "aira/pro", "aira/ultra", "aira/apex"):
        assert f'id: "{model_id}"' in registry, f"missing registry id {model_id}"
    assert registry.count('evidenceState: "NOT_TESTED"') == 5
    assert registry.count('releaseState: "experiment"') == 5
    assert registry.count('\t\texposure: "omniroute-discovered-only"') == 5
    assert CORE_BASE in registry

    ignore = read(".gitignore")
    for generated_path in (
        ".venv-model-lab/",
        "model-lab/cache/",
        "model-lab/artifacts/",
        "model-lab/runs/",
        "model-lab/eval/reports/",
        "model-lab/data/core-v0/",
    ):
        assert generated_path in ignore, f"generated/private path is not ignored: {generated_path}"

    print(
        f"AIRA model-lab contracts pass: Soup {SOUP_SHA[:8]}, "
        f"{smoke_rows} smoke rows, {eval_rows} eval rows, Core training fail-closed, "
        "exact base revisions pinned, RX 9070 XT operator path present."
    )


if __name__ == "__main__":
    main()
