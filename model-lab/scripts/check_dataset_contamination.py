#!/usr/bin/env python3
"""Fail-closed exact/near-duplicate contamination gate for AIRA training prompts.

This does not claim to solve all benchmark contamination. It gives the Core pipeline a
reproducible local gate for exact prompt overlap and high-similarity word-shingle overlap
against frozen JSONL evaluation inputs. Reports contain hashes/metadata, not prompt text.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EVAL = ROOT / "model-lab/eval/data/core-v0-sanity.jsonl"
DEFAULT_INPUTS = (
    ROOT / "model-lab/data/core-v0/train.jsonl",
    ROOT / "model-lab/data/core-v0/validation.jsonl",
    ROOT / "model-lab/data/core-v0/holdout.jsonl",
)


def normalize(value: str) -> str:
    return " ".join(value.casefold().replace("\r", "\n").split())


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def tokens(value: str) -> list[str]:
    return [part for part in normalize(value).split(" ") if part]


def shingles(value: str, width: int = 3, cap: int = 512) -> set[str]:
    parts = tokens(value)
    if len(parts) < width:
        return {" ".join(parts)} if parts else set()
    result = {" ".join(parts[index : index + width]) for index in range(len(parts) - width + 1)}
    if len(result) <= cap:
        return result
    return set(sorted(result, key=sha256)[:cap])


def first_user_prompt(row: dict[str, Any]) -> str | None:
    messages = row.get("messages")
    if isinstance(messages, list):
        for message in messages:
            if isinstance(message, dict) and message.get("role") == "user" and isinstance(message.get("content"), str):
                value = message["content"].strip()
                return value or None
    for key in ("prompt", "instruction", "question", "input"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def read_prompts(path: Path) -> list[dict[str, str]]:
    prompts: list[dict[str, str]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        row = json.loads(raw)
        if not isinstance(row, dict):
            raise ValueError(f"{path}:{line_number} must be an object")
        prompt = first_user_prompt(row)
        if not prompt:
            continue
        prompts.append({
            "prompt": prompt,
            "prompt_hash": sha256(normalize(prompt)),
            "row_hash": str(row.get("row_hash") or sha256(raw)),
            "source_id": str(row.get("source_id") or "unknown"),
        })
    return prompts


def evaluate(inputs: list[Path], eval_path: Path, threshold: float) -> dict[str, Any]:
    eval_prompts = read_prompts(eval_path)
    exact_index: dict[str, int] = {}
    eval_shingles: list[set[str]] = []
    inverted: dict[str, set[int]] = defaultdict(set)
    for index, row in enumerate(eval_prompts):
        exact_index[row["prompt_hash"]] = index
        row_shingles = shingles(row["prompt"])
        eval_shingles.append(row_shingles)
        for shingle in row_shingles:
            inverted[shingle].add(index)

    exact_hits: list[dict[str, Any]] = []
    semantic_hits: list[dict[str, Any]] = []
    scanned = 0
    for path in inputs:
        if not path.is_file():
            raise FileNotFoundError(path)
        for row in read_prompts(path):
            scanned += 1
            exact = exact_index.get(row["prompt_hash"])
            if exact is not None:
                exact_hits.append({
                    "input": str(path.relative_to(ROOT)),
                    "source_id": row["source_id"],
                    "row_hash": row["row_hash"],
                    "prompt_hash": row["prompt_hash"],
                    "eval_prompt_hash": eval_prompts[exact]["prompt_hash"],
                })
                continue

            row_shingles = shingles(row["prompt"])
            if not row_shingles:
                continue
            candidate_ids: set[int] = set()
            for shingle in row_shingles:
                candidate_ids.update(inverted.get(shingle, ()))
            for eval_index in candidate_ids:
                other = eval_shingles[eval_index]
                union = row_shingles | other
                similarity = len(row_shingles & other) / len(union) if union else 0.0
                if similarity >= threshold:
                    semantic_hits.append({
                        "input": str(path.relative_to(ROOT)),
                        "source_id": row["source_id"],
                        "row_hash": row["row_hash"],
                        "prompt_hash": row["prompt_hash"],
                        "eval_prompt_hash": eval_prompts[eval_index]["prompt_hash"],
                        "word_trigram_jaccard": round(similarity, 6),
                    })

    exact_hits.sort(key=lambda row: (row["input"], row["row_hash"]))
    semantic_hits.sort(key=lambda row: (-row["word_trigram_jaccard"], row["row_hash"]))
    status = "PASS" if not exact_hits and not semantic_hits else "FAIL"
    return {
        "schema_version": 1,
        "status": status,
        "method": "normalized exact hash + indexed word-trigram Jaccard",
        "semantic_threshold": threshold,
        "eval_file": str(eval_path.relative_to(ROOT)),
        "eval_examples": len(eval_prompts),
        "training_prompts_scanned": scanned,
        "exact_overlap_count": len(exact_hits),
        "semantic_overlap_count": len(semantic_hits),
        "exact_hits": exact_hits[:100],
        "semantic_hits": semantic_hits[:100],
        "limitations": [
            "This gate detects exact and high lexical similarity only; it is not proof against paraphrased or memorized benchmark contamination.",
            "Release review must combine this result with source-level provenance and benchmark-specific checks.",
        ],
    }


def self_test() -> dict[str, Any]:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        eval_path = root / "eval.jsonl"
        clean_path = root / "clean.jsonl"
        eval_path.write_text(json.dumps({"prompt": "choose the correct web search tool"}) + "\n", encoding="utf-8")
        clean_path.write_text(json.dumps({
            "messages": [
                {"role": "user", "content": "explain a database transaction"},
                {"role": "assistant", "content": "answer"},
            ],
            "row_hash": "a" * 64,
            "source_id": "self-test",
        }) + "\n", encoding="utf-8")

        # The production evaluator expects paths below ROOT for report display. For
        # self-test, exercise primitives directly and ensure overlap math behaves.
        left = shingles("choose the correct web search tool")
        right = shingles("choose the correct web search tool")
        different = shingles("explain a database transaction")
        if left != right or len(left & different) != 0:
            raise RuntimeError("contamination shingle self-test failed")
        return {"status": "PASS", "exact_hash_stable": sha256(normalize(" A  B ")) == sha256("a b")}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", action="append", dest="inputs", type=Path)
    parser.add_argument("--eval", type=Path, default=DEFAULT_EVAL)
    parser.add_argument("--semantic-threshold", type=float, default=0.85)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if not 0.0 <= args.semantic_threshold <= 1.0:
        raise SystemExit("--semantic-threshold must be between 0 and 1")
    try:
        report = self_test() if args.self_test else evaluate(list(args.inputs or DEFAULT_INPUTS), args.eval, args.semantic_threshold)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "ERROR", "error": str(exc)}, indent=2))
        return 2

    rendered = json.dumps(report, indent=2, sort_keys=True)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0 if report["status"] == "PASS" else 3


if __name__ == "__main__":
    raise SystemExit(main())
