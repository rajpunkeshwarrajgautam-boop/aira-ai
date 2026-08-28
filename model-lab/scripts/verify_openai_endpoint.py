#!/usr/bin/env python3
"""Verify an OpenAI-compatible AIRA/OmniRoute inference endpoint.

The probe is deliberately secret-safe and bounded. It verifies model discovery,
non-streaming inference, and optional SSE streaming without printing credentials or
upstream response bodies on failure. It can also self-test against an in-process mock
server so normal CI validates the probe without model weights or external services.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 45.0


class ProbeError(RuntimeError):
    pass


def normalize_base_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ProbeError("base URL must be absolute http(s)")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ProbeError("base URL must not contain credentials, query, or fragment")
    host = parsed.hostname.lower()
    if parsed.scheme == "http" and host not in {"127.0.0.1", "localhost", "::1"}:
        raise ProbeError("plain HTTP is allowed only for loopback verification")
    path = parsed.path.rstrip("/")
    if not path.endswith("/v1"):
        path = f"{path}/v1" if path else "/v1"
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))


def request_json(
    *,
    method: str,
    url: str,
    api_key: str,
    timeout: float,
    payload: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], float]:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json", "Authorization": f"Bearer {api_key}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            status = response.status
    except urllib.error.HTTPError as exc:
        raise ProbeError(f"HTTP {exc.code} from {urllib.parse.urlparse(url).path}") from None
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ProbeError(f"endpoint unavailable: {type(exc).__name__}") from None
    elapsed_ms = (time.perf_counter() - started) * 1000
    if status < 200 or status >= 300:
        raise ProbeError(f"HTTP {status} from {urllib.parse.urlparse(url).path}")
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ProbeError("response exceeded 2 MiB bound")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        raise ProbeError("endpoint returned invalid JSON") from None
    if not isinstance(value, dict):
        raise ProbeError("endpoint JSON root must be an object")
    return value, elapsed_ms


def extract_models(body: dict[str, Any]) -> list[str]:
    data = body.get("data")
    if not isinstance(data, list):
        raise ProbeError("/models response does not contain data[]")
    models: list[str] = []
    for item in data:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            model_id = item["id"].strip()
            if model_id and model_id not in models:
                models.append(model_id)
    return models


def extract_completion_text(body: dict[str, Any]) -> str:
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ProbeError("completion response does not contain choices[0]")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ProbeError("completion response does not contain choices[0].message")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ProbeError("completion returned no text content")
    return content.strip()


def request_stream(
    *,
    url: str,
    api_key: str,
    timeout: float,
    payload: dict[str, Any],
) -> tuple[int, float, float]:
    body = json.dumps({**payload, "stream": True}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    started = time.perf_counter()
    first_content_at: float | None = None
    content_chars = 0
    bytes_read = 0
    done = False
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status < 200 or response.status >= 300:
                raise ProbeError(f"streaming returned HTTP {response.status}")
            for raw_line in response:
                bytes_read += len(raw_line)
                if bytes_read > MAX_RESPONSE_BYTES:
                    raise ProbeError("stream exceeded 2 MiB bound")
                line = raw_line.decode("utf-8", errors="strict").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    done = True
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    raise ProbeError("stream contained invalid JSON event") from None
                choices = chunk.get("choices") if isinstance(chunk, dict) else None
                if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                    continue
                delta = choices[0].get("delta")
                if not isinstance(delta, dict):
                    continue
                text = delta.get("content")
                if isinstance(text, str) and text:
                    if first_content_at is None:
                        first_content_at = time.perf_counter()
                    content_chars += len(text)
    except urllib.error.HTTPError as exc:
        raise ProbeError(f"streaming returned HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ProbeError(f"stream unavailable: {type(exc).__name__}") from None

    finished = time.perf_counter()
    if not done:
        raise ProbeError("stream ended without [DONE]")
    if content_chars == 0 or first_content_at is None:
        raise ProbeError("stream produced no text content")
    return content_chars, (first_content_at - started) * 1000, (finished - started) * 1000


def verify(base_url: str, api_key: str, model: str, timeout: float, require_streaming: bool) -> dict[str, Any]:
    normalized = normalize_base_url(base_url)
    host = urllib.parse.urlparse(normalized).hostname
    models_body, models_ms = request_json(
        method="GET", url=f"{normalized}/models", api_key=api_key, timeout=timeout
    )
    models = extract_models(models_body)
    if model not in models and model.startswith("aira/"):
        raise ProbeError(f"required native model {model!r} was not discovered")

    completion_payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with a short acknowledgement."}],
        "temperature": 0,
        "max_completion_tokens": 16,
    }
    completion_body, completion_ms = request_json(
        method="POST",
        url=f"{normalized}/chat/completions",
        api_key=api_key,
        timeout=timeout,
        payload={**completion_payload, "stream": False},
    )
    completion_text = extract_completion_text(completion_body)

    result: dict[str, Any] = {
        "status": "PASS",
        "host": host,
        "base_path": urllib.parse.urlparse(normalized).path,
        "selection": model,
        "model_discovered": model in models,
        "discovered_model_count": len(models),
        "models_latency_ms": round(models_ms, 2),
        "completion_latency_ms": round(completion_ms, 2),
        "completion_chars": len(completion_text),
        "streaming_verified": False,
    }
    if require_streaming:
        chars, ttft_ms, total_ms = request_stream(
            url=f"{normalized}/chat/completions",
            api_key=api_key,
            timeout=timeout,
            payload=completion_payload,
        )
        result.update({
            "streaming_verified": True,
            "stream_chars": chars,
            "stream_ttft_ms": round(ttft_ms, 2),
            "stream_total_ms": round(total_ms, 2),
        })
    return result


class _MockHandler(BaseHTTPRequestHandler):
    server_version = "AIRAProbeSelfTest/1"

    def log_message(self, format: str, *args: object) -> None:
        return

    def _authorized(self) -> bool:
        return self.headers.get("Authorization") == "Bearer self-test-key"

    def do_GET(self) -> None:
        if not self._authorized():
            self.send_response(401)
            self.end_headers()
            return
        if self.path != "/v1/models":
            self.send_response(404)
            self.end_headers()
            return
        raw = json.dumps({"object": "list", "data": [{"id": "aira/core", "object": "model"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self) -> None:
        if not self._authorized():
            self.send_response(401)
            self.end_headers()
            return
        if self.path != "/v1/chat/completions":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        if payload.get("stream") is True:
            events = [
                'data: {"choices":[{"delta":{"content":"AIRA"}}]}\n\n',
                'data: {"choices":[{"delta":{"content":" OK"}}]}\n\n',
                "data: [DONE]\n\n",
            ]
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for event in events:
                self.wfile.write(event.encode())
                self.wfile.flush()
            return
        raw = json.dumps({
            "model": payload.get("model"),
            "choices": [{"message": {"role": "assistant", "content": "AIRA OK"}}],
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def self_test() -> dict[str, Any]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _MockHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        return verify(f"http://127.0.0.1:{port}", "self-test-key", "aira/core", 5, True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url")
    parser.add_argument("--api-key-env", default="AIRA_INFERENCE_API_KEY")
    parser.add_argument("--model", default="aira/core")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--require-streaming", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    try:
        if args.self_test:
            result = self_test()
        else:
            if not args.base_url:
                raise ProbeError("--base-url is required outside --self-test")
            api_key = os.environ.get(args.api_key_env, "").strip()
            if not api_key:
                raise ProbeError(f"required API-key environment variable {args.api_key_env!r} is empty")
            result = verify(args.base_url, api_key, args.model, args.timeout, args.require_streaming)
    except ProbeError as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2))
        return 2

    rendered = json.dumps(result, indent=2, sort_keys=True)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
