#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import statistics
import time
import urllib.error
import urllib.request

DEFAULT_MODEL = "@cf/baai/bge-base-en-v1.5"
EXPECTED_DIMENSIONS = 768


def request_embedding(base_url: str, token: str, model: str, text: str) -> tuple[int, float]:
    body = json.dumps(
        {
            "model": model,
            "input": text,
            "encoding_format": "float",
        }
    ).encode()
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/embeddings",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    duration_ms = (time.perf_counter() - started) * 1000
    vector = payload.get("data", [{}])[0].get("embedding")
    if not isinstance(vector, list):
        raise RuntimeError("Endpoint returned no OpenAI-compatible embedding vector.")
    if len(vector) != EXPECTED_DIMENSIONS:
        raise RuntimeError(f"Expected {EXPECTED_DIMENSIONS} dimensions, received {len(vector)}.")
    if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in vector):
        raise RuntimeError("Embedding contains a non-finite or non-numeric value.")
    return len(vector), duration_ms


def verify_unauthorized(base_url: str, model: str) -> None:
    body = json.dumps({"model": model, "input": "unauthorized probe", "encoding_format": "float"}).encode()
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/embeddings",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403}:
            return
        raise RuntimeError(f"Unauthenticated endpoint returned HTTP {exc.code}, expected 401/403.") from exc
    raise RuntimeError("Embedding endpoint accepted an unauthenticated request.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the AIRA FREE Cloudflare/OpenAI-compatible embedding endpoint.")
    parser.add_argument(
        "--base-url",
        required=True,
        help="Base URL ending in /ai/v1, e.g. https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1",
    )
    parser.add_argument("--token", required=True, help="Dedicated Workers AI token. It is never printed.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--samples", type=int, default=3, choices=range(1, 6))
    args = parser.parse_args()

    if not args.base_url.startswith("https://"):
        raise SystemExit("Refusing to verify a non-HTTPS external endpoint.")
    if not args.token.strip():
        raise SystemExit("A dedicated bearer token is required.")

    verify_unauthorized(args.base_url, args.model)

    durations: list[float] = []
    dimensions = 0
    for index in range(args.samples):
        dimensions, duration_ms = request_embedding(
            args.base_url,
            args.token,
            args.model,
            f"AIRA semantic endpoint verification sample {index + 1}",
        )
        durations.append(duration_ms)

    print("endpoint_authentication=PASS")
    print("openai_compatible_embeddings=PASS")
    print(f"model={args.model}")
    print(f"dimensions={dimensions}")
    print(f"samples={len(durations)}")
    print(f"first_request_ms={durations[0]:.1f}")
    print(f"warm_median_ms={statistics.median(durations[1:] or durations):.1f}")
    print("token_printed=NO")
    print("vector_printed=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
