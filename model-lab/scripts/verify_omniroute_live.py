#!/usr/bin/env python3
"""Run the AIRA-native OmniRoute live gate without exposing gateway credentials."""

from __future__ import annotations

import argparse
import json
import os
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from verify_openai_endpoint import ProbeError, _MockHandler, verify

DEFAULT_SELECTIONS = (
    "aira/core",
    "auto",
    "auto/smart",
    "auto/coding",
    "auto/fast",
    "auto/cheap",
    "auto/offline",
)


def verify_all(base_url: str, api_key: str, timeout: float, selections: tuple[str, ...]) -> dict:
    results = []
    failures = []
    for selection in selections:
        try:
            result = verify(base_url, api_key, selection, timeout, True)
            results.append(result)
        except ProbeError as exc:
            failures.append({"selection": selection, "error": str(exc)})
    return {
        "status": "PASS" if not failures else "FAIL",
        "required_native_model": "aira/core",
        "selections": list(selections),
        "results": results,
        "failures": failures,
    }


def self_test() -> dict:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _MockHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        return verify_all(
            f"http://127.0.0.1:{port}",
            "self-test-key",
            5,
            DEFAULT_SELECTIONS,
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url")
    parser.add_argument("--api-key-env", default="OMNIROUTE_API_KEY")
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--selection", action="append", dest="selections")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        report = self_test()
    else:
        if not args.base_url:
            print(json.dumps({"status": "FAIL", "error": "--base-url is required"}, indent=2))
            return 2
        api_key = os.environ.get(args.api_key_env, "").strip()
        if not api_key:
            print(json.dumps({
                "status": "FAIL",
                "error": f"required API-key environment variable {args.api_key_env!r} is empty",
            }, indent=2))
            return 2
        selections = tuple(args.selections or DEFAULT_SELECTIONS)
        report = verify_all(args.base_url, api_key, args.timeout, selections)

    rendered = json.dumps(report, indent=2, sort_keys=True)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0 if report["status"] == "PASS" else 3


if __name__ == "__main__":
    raise SystemExit(main())
