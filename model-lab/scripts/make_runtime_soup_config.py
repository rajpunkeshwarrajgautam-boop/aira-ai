#!/usr/bin/env python3
"""Create a runtime Soup YAML that replaces only the top-level model base path.

The committed YAML remains readable/reviewable with the canonical Hugging Face model ID.
Actual hardware runs use an ignored runtime copy pointing at a materialized exact revision.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

BASE_LINE = re.compile(r"^(\s*)base:\s*.*$", re.MULTILINE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if not args.template.is_file():
        raise SystemExit(f"template missing: {args.template}")
    if not args.base.is_dir():
        raise SystemExit(f"materialized base directory missing: {args.base}")

    text = args.template.read_text(encoding="utf-8")
    matches = list(BASE_LINE.finditer(text))
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one base: line in {args.template}, found {len(matches)}")

    safe_base = str(args.base.resolve()).replace("\\", "/").replace('"', '\\"')
    runtime = BASE_LINE.sub(lambda match: f'{match.group(1)}base: "{safe_base}"', text, count=1)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(runtime, encoding="utf-8", newline="\n")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
