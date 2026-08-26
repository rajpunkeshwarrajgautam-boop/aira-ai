#!/usr/bin/env python3
"""Machine-readable AMD/Soup backend probe for the AIRA model lab.

This probe never upgrades packages and never claims training is VERIFIED. It reports
PARTIALLY_VERIFIED only when Python, ROCm PyTorch, gfx1201-class AMD GPU,
bitsandbytes, the core training libraries, and `soup doctor` are all usable.
Actual `soup train` + adapter verification is required to promote the host to VERIFIED.
"""

from __future__ import annotations

import importlib
import importlib.metadata
import json
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any

EXPECTED_PYTHON = (3, 12)
EXPECTED_GFX = "gfx1201"


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def import_ok(name: str) -> tuple[bool, str | None]:
    try:
        importlib.import_module(name)
        return True, None
    except Exception as exc:  # diagnostic boundary: report, do not hide loader failures
        return False, f"{type(exc).__name__}: {exc}"


def run_soup_doctor() -> dict[str, Any]:
    try:
        proc = subprocess.run(
            ["soup", "doctor"],
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
        combined = "\n".join(part for part in (proc.stdout, proc.stderr) if part).strip()
        return {
            "returncode": proc.returncode,
            "ok": proc.returncode == 0,
            "output_tail": combined[-6000:],
        }
    except Exception as exc:
        return {"returncode": None, "ok": False, "error": f"{type(exc).__name__}: {exc}"}


def main() -> int:
    result: dict[str, Any] = {
        "schema_version": 1,
        "status": "UNVERIFIED",
        "python": {
            "version": platform.python_version(),
            "executable": sys.executable,
            "expected": "3.12.x",
        },
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
        },
        "packages": {},
        "accelerator": {},
        "checks": {},
    }

    py_ok = sys.version_info[:2] == EXPECTED_PYTHON
    result["checks"]["python_3_12"] = py_ok

    torch_ok, torch_error = import_ok("torch")
    result["packages"]["torch"] = package_version("torch")
    result["checks"]["torch_import"] = torch_ok
    if torch_error:
        result["packages"]["torch_error"] = torch_error

    accelerator_ok = False
    hip_ok = False
    amd_ok = False
    gfx_ok = False

    if torch_ok:
        import torch

        available = bool(torch.cuda.is_available())
        count = int(torch.cuda.device_count()) if available else 0
        hip_version = getattr(torch.version, "hip", None)
        cuda_version = getattr(torch.version, "cuda", None)
        result["accelerator"].update(
            {
                "torch_cuda_api_available": available,
                "device_count": count,
                "torch_version_hip": hip_version,
                "torch_version_cuda": cuda_version,
            }
        )
        hip_ok = bool(hip_version)
        result["checks"]["rocm_hip_build"] = hip_ok

        if count:
            name = str(torch.cuda.get_device_name(0))
            props = torch.cuda.get_device_properties(0)
            total_memory = int(getattr(props, "total_memory", 0))
            result["accelerator"].update(
                {
                    "device_name": name,
                    "total_memory_bytes": total_memory,
                    "total_memory_gib": round(total_memory / (1024**3), 2) if total_memory else None,
                }
            )
            amd_ok = "amd" in name.lower() or "radeon" in name.lower()

            # ROCm PyTorch may expose gcnArchName on AMD-specific device properties.
            arch = str(getattr(props, "gcnArchName", "") or "")
            if arch:
                result["accelerator"]["gcn_arch_name"] = arch
                gfx_ok = EXPECTED_GFX in arch.lower()
            else:
                # If the runtime does not expose the arch, keep the GPU usable but do not
                # manufacture a gfx claim from its marketing name.
                gfx_ok = False

            accelerator_ok = available and amd_ok and hip_ok

    result["checks"]["amd_gpu"] = amd_ok
    result["checks"]["gfx1201_reported"] = gfx_ok
    result["checks"]["accelerator_usable"] = accelerator_ok

    library_modules = {
        "bitsandbytes": "bitsandbytes",
        "transformers": "transformers",
        "peft": "peft",
        "trl": "trl",
        "datasets": "datasets",
        "accelerate": "accelerate",
        "soup-cli": "soup_cli",
    }
    libraries_ok = True
    for package, module in library_modules.items():
        ok, error = import_ok(module)
        result["packages"][package] = package_version(package)
        result["checks"][f"{package}_import"] = ok
        if error:
            result["packages"][f"{package}_error"] = error
        libraries_ok = libraries_ok and ok

    doctor = run_soup_doctor()
    result["soup_doctor"] = doctor
    result["checks"]["soup_doctor"] = bool(doctor.get("ok"))

    # gfx1201_reported is evidence-enhancing but not required because PyTorch builds
    # differ in whether gcnArchName is exposed on Windows. AMD+HIP+doctor are required.
    partial = py_ok and accelerator_ok and libraries_ok and bool(doctor.get("ok"))
    if partial:
        result["status"] = "PARTIALLY_VERIFIED"
        result["next_gate"] = "Run the Soup 0.8B smoke train and verify the produced adapter."
    else:
        result["status"] = "UNVERIFIED"
        failed = [name for name, ok in result["checks"].items() if not ok]
        result["failed_checks"] = failed
        result["next_gate"] = "Repair the first failed environment check, then rerun this probe."

    out_path = Path("model-lab/runs/amd-backend-probe.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if partial else 2


if __name__ == "__main__":
    raise SystemExit(main())
