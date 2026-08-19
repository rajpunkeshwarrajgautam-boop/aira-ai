#!/usr/bin/env python3
"""AIRA AutoGPT activation preflight.

Modes:
- healthy-both: both production runner targets must answer /health.
- primary-down-secondary-up: primary MUST fail health while secondary MUST pass.

The second mode is the real failover drill. Run it only after intentionally taking the
primary runner out of service. This script never changes infrastructure itself.
"""

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlparse


def env(name: str) -> str:
    return os.environ.get(name, "").strip()


def check_https_url(name: str, raw: str) -> str:
    if not raw:
        raise ValueError(f"{name} is required")
    parsed = urlparse(raw)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"{name} must be an absolute HTTPS URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(f"{name} may not contain credentials, query parameters, or fragments")
    return raw.rstrip("/") + "/"


def health(base_url: str, api_key: str, timeout: float = 4.0) -> tuple[bool, str]:
    request = urllib.request.Request(
        urljoin(base_url, "health"),
        method="GET",
        headers={"Accept": "application/json", "X-API-Key": api_key},
    )
    context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
            raw = response.read(131072)
            if response.status < 200 or response.status >= 300:
                return False, f"HTTP {response.status}"
            if raw:
                try:
                    json.loads(raw.decode("utf-8"))
                except json.JSONDecodeError:
                    return False, "health response was not JSON"
            return True, f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return False, type(exc).__name__


def check_foundation_service(url_name: str, token_name: str, health_path: str, header_name: str) -> tuple[bool, str]:
    raw_url = env(url_name)
    token = env(token_name)
    if not raw_url or not token:
        return False, f"missing {url_name} or {token_name}"
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        return False, f"invalid {url_name}"
    request = urllib.request.Request(
        urljoin(raw_url.rstrip("/") + "/", health_path.lstrip("/")),
        method="GET",
        headers={header_name: token},
    )
    try:
        with urllib.request.urlopen(request, timeout=4.0) as response:
            return 200 <= response.status < 300, f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return False, type(exc).__name__


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=("healthy-both", "primary-down-secondary-up"),
        default="healthy-both",
    )
    parser.add_argument("--require-foundation", action="store_true")
    args = parser.parse_args()

    try:
        primary = check_https_url("AUTOGPT_PRIMARY_API_BASE_URL", env("AUTOGPT_PRIMARY_API_BASE_URL"))
        secondary = check_https_url("AUTOGPT_SECONDARY_API_BASE_URL", env("AUTOGPT_SECONDARY_API_BASE_URL"))
    except ValueError as exc:
        print(json.dumps({"ok": False, "stage": "config", "error": str(exc)}))
        return 2

    if primary == secondary:
        print(json.dumps({"ok": False, "stage": "config", "error": "runner URLs must be distinct"}))
        return 2

    primary_key = env("AUTOGPT_PRIMARY_API_KEY")
    secondary_key = env("AUTOGPT_SECONDARY_API_KEY")
    if not primary_key or not secondary_key:
        print(json.dumps({"ok": False, "stage": "config", "error": "both runner API keys are required"}))
        return 2

    primary_ok, primary_detail = health(primary, primary_key)
    secondary_ok, secondary_detail = health(secondary, secondary_key)

    checks = {
        "primary": {"healthy": primary_ok, "detail": primary_detail},
        "secondary": {"healthy": secondary_ok, "detail": secondary_detail},
    }

    if args.mode == "healthy-both":
        passed = primary_ok and secondary_ok
    else:
        passed = (not primary_ok) and secondary_ok

    if args.require_foundation:
        control_ok, control_detail = check_foundation_service(
            "AIRA_CONTROL_PLANE_URL",
            "AIRA_CONTROL_PLANE_TOKEN",
            "/healthz",
            "X-AIRA-Control-Token",
        )
        sandbox_ok, sandbox_detail = check_foundation_service(
            "AIRA_SANDBOX_URL",
            "AIRA_SANDBOX_TOKEN",
            "/healthz",
            "X-AIRA-Sandbox-Token",
        )
        checks["controlPlane"] = {"healthy": control_ok, "detail": control_detail}
        checks["sandbox"] = {"healthy": sandbox_ok, "detail": sandbox_detail}
        passed = passed and control_ok and sandbox_ok

    print(json.dumps({"ok": passed, "mode": args.mode, "checks": checks}, separators=(",", ":")))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
