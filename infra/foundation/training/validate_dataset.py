#!/usr/bin/env python3
"""Validate AIRA training JSONL before any GPU job is allowed to start."""

import argparse
import hashlib
import json
import pathlib
import sys
from collections import Counter

STAGES = {"sft", "dpo", "reward", "ppo"}
MAX_RECORD_BYTES = 256 * 1024
MAX_DATASET_BYTES = 20 * 1024 * 1024 * 1024


def nonempty_string(value):
    return isinstance(value, str) and bool(value.strip())


def validate_messages(value):
    if not isinstance(value, list) or not value:
        return False
    for item in value:
        if not isinstance(item, dict):
            return False
        if item.get("role") not in {"system", "user", "assistant"}:
            return False
        if not nonempty_string(item.get("content")):
            return False
    return True


def validate_record(stage, record):
    if not isinstance(record, dict):
        return "record must be a JSON object"
    if stage == "sft":
        if validate_messages(record.get("messages")):
            return None
        if nonempty_string(record.get("prompt")) and nonempty_string(record.get("response")):
            return None
        return "SFT requires messages[] or prompt+response"
    if stage in {"dpo", "reward"}:
        if all(nonempty_string(record.get(key)) for key in ("prompt", "chosen", "rejected")):
            if record["chosen"].strip() == record["rejected"].strip():
                return "chosen and rejected must differ"
            return None
        return f"{stage.upper()} requires prompt+chosen+rejected"
    if stage == "ppo":
        if nonempty_string(record.get("prompt")):
            return None
        return "PPO requires prompt"
    return "unknown stage"


def validate(path, stage, max_errors=20):
    size = path.stat().st_size
    if size <= 0:
        raise ValueError("dataset is empty")
    if size > MAX_DATASET_BYTES:
        raise ValueError("dataset exceeds 20 GiB validation limit")

    digest = hashlib.sha256()
    errors = []
    duplicates = 0
    seen = set()
    records = 0
    lengths = Counter()

    with path.open("rb") as handle:
        for line_number, raw in enumerate(handle, 1):
            digest.update(raw)
            if not raw.strip():
                continue
            if len(raw) > MAX_RECORD_BYTES:
                errors.append(f"line {line_number}: record exceeds {MAX_RECORD_BYTES} bytes")
                if len(errors) >= max_errors:
                    break
                continue
            try:
                record = json.loads(raw)
            except json.JSONDecodeError as exc:
                errors.append(f"line {line_number}: invalid JSON ({exc.msg})")
                if len(errors) >= max_errors:
                    break
                continue
            error = validate_record(stage, record)
            if error:
                errors.append(f"line {line_number}: {error}")
                if len(errors) >= max_errors:
                    break
                continue

            canonical = json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            record_hash = hashlib.sha256(canonical.encode("utf-8")).digest()
            if record_hash in seen:
                duplicates += 1
            else:
                seen.add(record_hash)
            records += 1
            lengths[min(len(canonical) // 1000, 20)] += 1

    return {
        "ok": not errors and records > 0,
        "stage": stage,
        "records": records,
        "duplicateRecords": duplicates,
        "duplicateRate": round(duplicates / max(records, 1), 6),
        "sha256": digest.hexdigest(),
        "bytes": size,
        "lengthBucketsKB": dict(sorted(lengths.items())),
        "errors": errors,
    }


def self_test():
    samples = {
        "sft": {"messages": [{"role": "user", "content": "Q"}, {"role": "assistant", "content": "A"}]},
        "dpo": {"prompt": "Q", "chosen": "good", "rejected": "bad"},
        "reward": {"prompt": "Q", "chosen": "good", "rejected": "bad"},
        "ppo": {"prompt": "Q"},
    }
    failures = [stage for stage, sample in samples.items() if validate_record(stage, sample) is not None]
    print(json.dumps({"ok": not failures, "failures": failures}))
    return 0 if not failures else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=sorted(STAGES))
    parser.add_argument("--file", type=pathlib.Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.stage or not args.file:
        parser.error("--stage and --file are required unless --self-test is used")
    if not args.file.is_file():
        print(json.dumps({"ok": False, "error": "dataset file not found"}))
        return 2
    try:
        result = validate(args.file, args.stage)
    except ValueError as exc:
        result = {"ok": False, "stage": args.stage, "errors": [str(exc)]}
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
