#!/usr/bin/env python3
"""Build a provenance-bound AIRA Core SFT mixture from explicitly approved sources.

The script is intentionally fail-closed:
- every source needs an exact revision and approved_for_training=true;
- no private/user data source is accepted;
- rows with high-confidence secret patterns are rejected;
- exact duplicate and frozen-eval prompt collisions are rejected;
- outputs and build evidence stay under ignored model-lab/data/core-v0/.

It never flips the committed core-v0 manifest to training_allowed=true. Promotion remains
an explicit review step after the build evidence and broader contamination checks pass.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATALOG = ROOT / "model-lab/data/sources/core-v0-candidates.json"
OUTPUT_DIR = ROOT / "model-lab/data/core-v0"
FROZEN_EVAL = ROOT / "model-lab/eval/data/core-v0-sanity.jsonl"

SECRET_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bnvapi-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)\b(?:api[_ -]?key|password|secret)\s*[:=]\s*['\"]?[A-Za-z0-9_+./=-]{20,}"),
]
REVISION_RE = re.compile(r"^[0-9a-f]{40}$")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_text(value: str) -> str:
    return " ".join(value.replace("\r\n", "\n").replace("\r", "\n").split()).strip()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_catalog(catalog: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    sources = catalog.get("sources")
    if not isinstance(sources, list) or not sources:
        return ["catalog.sources must be a non-empty list"]
    ids: set[str] = set()
    for index, source in enumerate(sources):
        prefix = f"sources[{index}]"
        if not isinstance(source, dict):
            errors.append(f"{prefix} must be an object")
            continue
        source_id = source.get("id")
        if not isinstance(source_id, str) or not source_id:
            errors.append(f"{prefix}.id is required")
        elif source_id in ids:
            errors.append(f"duplicate source id: {source_id}")
        else:
            ids.add(source_id)
        revision = source.get("revision")
        if not isinstance(revision, str) or not REVISION_RE.fullmatch(revision):
            errors.append(f"{prefix}.revision must be an exact 40-character git SHA")
        if not source.get("repository"):
            errors.append(f"{prefix}.repository is required")
        if not source.get("license"):
            errors.append(f"{prefix}.license is required")
        if source.get("approved_for_training") is True:
            if source.get("license_review") != "approved":
                errors.append(f"{prefix} is training-approved without license_review=approved")
            if source.get("provenance_review") != "approved":
                errors.append(f"{prefix} is training-approved without provenance_review=approved")
            if source.get("contamination_review") != "approved":
                errors.append(f"{prefix} is training-approved without contamination_review=approved")
    return errors


def parse_messages(value: Any) -> list[dict[str, str]] | None:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    if not isinstance(value, list):
        return None
    messages: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            return None
        role = item.get("role") or item.get("from")
        content = item.get("content") if "content" in item else item.get("value")
        if role == "human":
            role = "user"
        elif role == "gpt":
            role = "assistant"
        if role not in {"system", "user", "assistant", "tool"} or not isinstance(content, str):
            return None
        content = content.strip()
        if not content:
            continue
        messages.append({"role": role, "content": content})
    if not any(item["role"] == "user" for item in messages):
        return None
    if not any(item["role"] == "assistant" for item in messages):
        return None
    return messages


def normalize_row(row: dict[str, Any]) -> list[dict[str, str]] | None:
    for key in ("messages", "conversations"):
        if key in row:
            parsed = parse_messages(row[key])
            if parsed:
                return parsed
    if isinstance(row.get("problem"), str):
        answer = row.get("solution") or row.get("answer")
        if isinstance(answer, str) and answer.strip():
            return [
                {"role": "user", "content": row["problem"].strip()},
                {"role": "assistant", "content": answer.strip()},
            ]
    instruction = row.get("instruction")
    output = row.get("output")
    if isinstance(instruction, str) and isinstance(output, str) and instruction.strip() and output.strip():
        user = instruction.strip()
        if isinstance(row.get("input"), str) and row["input"].strip():
            user += "\n\n" + row["input"].strip()
        return [{"role": "user", "content": user}, {"role": "assistant", "content": output.strip()}]
    return None


def contains_secret(messages: list[dict[str, str]]) -> bool:
    text = "\n".join(message["content"] for message in messages)
    return any(pattern.search(text) for pattern in SECRET_PATTERNS)


def first_user_prompt(messages: list[dict[str, str]]) -> str:
    for message in messages:
        if message["role"] == "user":
            return canonical_text(message["content"])
    return ""


def frozen_prompt_hashes() -> set[str]:
    hashes: set[str] = set()
    if not FROZEN_EVAL.is_file():
        return hashes
    for raw in FROZEN_EVAL.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        row = json.loads(raw)
        for key in ("instruction", "input", "prompt", "question"):
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                hashes.add(sha256_text(canonical_text(value)))
    return hashes


def iter_source_rows(source: dict[str, Any]) -> Iterable[dict[str, Any]]:
    from datasets import DatasetDict, load_dataset

    repository = source["repository"]
    revision = source["revision"]
    config = source.get("config")
    split = source.get("split")
    kwargs: dict[str, Any] = {"revision": revision}
    if config:
        args = (repository, config)
    else:
        args = (repository,)

    if split == "all_configured_splits":
        dataset = load_dataset(*args, **kwargs)
        if not isinstance(dataset, DatasetDict):
            raise RuntimeError(f"{source['id']} expected a DatasetDict for all_configured_splits")
        for split_name in sorted(dataset):
            for row in dataset[split_name]:
                yield dict(row)
        return

    dataset = load_dataset(*args, split=split or "train", **kwargs)
    for row in dataset:
        yield dict(row)


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--source", action="append", dest="source_ids")
    parser.add_argument("--max-per-source", type=int, default=None)
    args = parser.parse_args()

    catalog = load_json(args.catalog)
    if not isinstance(catalog, dict):
        raise SystemExit("catalog root must be an object")
    errors = validate_catalog(catalog)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 2

    sources = catalog["sources"]
    selected = [source for source in sources if not args.source_ids or source["id"] in set(args.source_ids)]
    if args.source_ids:
        found = {source["id"] for source in selected}
        missing = sorted(set(args.source_ids) - found)
        if missing:
            raise SystemExit(f"unknown source ids: {missing}")

    approved = [source for source in selected if source.get("approved_for_training") is True]
    blocked = [source["id"] for source in selected if source.get("approved_for_training") is not True]

    print(json.dumps({
        "catalog": str(args.catalog),
        "sources_selected": [source["id"] for source in selected],
        "sources_approved": [source["id"] for source in approved],
        "sources_blocked": blocked,
        "status": "CATALOG_VALID",
    }, indent=2))

    if args.validate_only:
        return 0
    if blocked:
        raise SystemExit(
            "dataset build refused: selected sources are not fully approved for training: " + ", ".join(blocked)
        )
    if not approved:
        raise SystemExit("dataset build refused: no approved sources")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    eval_hashes = frozen_prompt_hashes()
    seen_rows: set[str] = set()
    accepted: list[dict[str, Any]] = []
    counters: Counter[str] = Counter()
    per_source: dict[str, Counter[str]] = {}

    for source in approved:
        source_counts: Counter[str] = Counter()
        per_source[source["id"]] = source_counts
        for index, row in enumerate(iter_source_rows(source)):
            if args.max_per_source is not None and source_counts["accepted"] >= args.max_per_source:
                break
            source_counts["seen"] += 1
            messages = normalize_row(row)
            if not messages:
                source_counts["rejected_schema"] += 1
                continue
            if contains_secret(messages):
                source_counts["rejected_secret"] += 1
                continue
            prompt_hash = sha256_text(first_user_prompt(messages))
            if prompt_hash in eval_hashes:
                source_counts["rejected_frozen_eval_overlap"] += 1
                continue
            canonical = json.dumps(messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            row_hash = sha256_text(canonical)
            if row_hash in seen_rows:
                source_counts["rejected_exact_duplicate"] += 1
                continue
            seen_rows.add(row_hash)
            split_bucket = int(row_hash[:8], 16) % 1000
            split_name = "train" if split_bucket < 980 else "validation" if split_bucket < 990 else "holdout"
            accepted.append({
                "messages": messages,
                "source_id": source["id"],
                "source_repository": source["repository"],
                "source_revision": source["revision"],
                "row_hash": row_hash,
                "prompt_hash": prompt_hash,
                "split": split_name,
            })
            source_counts["accepted"] += 1
            source_counts[f"split_{split_name}"] += 1

    accepted.sort(key=lambda row: row["row_hash"])
    for row in accepted:
        counters[row["split"]] += 1

    outputs: dict[str, Any] = {}
    for split_name in ("train", "validation", "holdout"):
        path = OUTPUT_DIR / f"{split_name}.jsonl"
        rows = [row for row in accepted if row["split"] == split_name]
        write_jsonl(path, rows)
        outputs[split_name] = {
            "path": str(path.relative_to(ROOT)),
            "examples": len(rows),
            "sha256": file_sha256(path),
        }

    report = {
        "schema_version": 1,
        "catalog_sha256": file_sha256(args.catalog),
        "frozen_eval_sha256": file_sha256(FROZEN_EVAL) if FROZEN_EVAL.is_file() else None,
        "source_revisions": {source["id"]: source["revision"] for source in approved},
        "source_counts": {key: dict(value) for key, value in per_source.items()},
        "outputs": outputs,
        "total_examples": len(accepted),
        "exact_dedup": true if False else True,
        "frozen_eval_exact_prompt_overlap_removed": True,
        "high_confidence_secret_filter": True,
        "broader_semantic_contamination_check": "REQUIRED_BEFORE_MANIFEST_PROMOTION",
        "training_manifest_promotion": "NOT_AUTOMATIC",
    }
    report_path = OUTPUT_DIR / "build-evidence.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
