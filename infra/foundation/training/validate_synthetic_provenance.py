#!/usr/bin/env python3
import argparse
import hashlib
import json
import sys

REQUIRED = {"generator_model", "generator_revision", "prompt_set_sha256", "verifier", "license", "created_at"}


def valid_sha256(value):
    if not isinstance(value, str) or len(value) != 64:
        return False
    try:
        int(value, 16)
        return True
    except ValueError:
        return False


def validate(manifest):
    missing = sorted(REQUIRED - set(manifest))
    errors = [f"missing:{name}" for name in missing]
    if "prompt_set_sha256" in manifest and not valid_sha256(manifest["prompt_set_sha256"]):
        errors.append("invalid:prompt_set_sha256")
    if not manifest.get("verifier"):
        errors.append("invalid:verifier")
    if str(manifest.get("license", "")).lower() in {"", "unknown", "unreviewed"}:
        errors.append("invalid:license")
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", nargs="?")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        sample = {"generator_model":"ci","generator_revision":"r1","prompt_set_sha256":hashlib.sha256(b"ci").hexdigest(),"verifier":"symbolic-ci","license":"internal-approved","created_at":"2026-08-19T00:00:00Z"}
        errors = validate(sample)
    else:
        if not args.manifest:
            raise SystemExit("manifest path required")
        with open(args.manifest, "r", encoding="utf-8") as handle:
            errors = validate(json.load(handle))
    print(json.dumps({"ok": not errors, "errors": errors}, separators=(",", ":")))
    return 0 if not errors else 2


if __name__ == "__main__":
    sys.exit(main())
