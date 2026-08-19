#!/usr/bin/env python3
import argparse
import json
import shutil
import subprocess
import sys


def probe():
    openssl = shutil.which("openssl")
    if not openssl:
        return {"ready": False, "openssl": None, "ml_kem": False, "reason": "openssl_not_found"}
    version = subprocess.run([openssl, "version"], capture_output=True, text=True, timeout=5)
    listing = subprocess.run([openssl, "list", "-kem-algorithms"], capture_output=True, text=True, timeout=5)
    text = (listing.stdout + listing.stderr).lower()
    ml_kem = any(token in text for token in ("ml-kem", "mlkem", "kyber"))
    return {"ready": ml_kem and listing.returncode == 0, "openssl": version.stdout.strip(), "ml_kem": ml_kem, "reason": None if ml_kem else "ml_kem_not_observed"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--require", action="store_true")
    args = parser.parse_args()
    result = probe()
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["ready"] or not args.require else 2


if __name__ == "__main__":
    sys.exit(main())
