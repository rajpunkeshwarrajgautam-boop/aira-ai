import errno
import json
import os
import shutil
import socket
import sys
from pathlib import Path

import pyseccomp as seccomp
from py_landlock import Landlock

RW_PATHS_ENV = "AIRA_TERMINAL_SANDBOX_RW_PATHS"
RO_PATHS_ENV = "AIRA_TERMINAL_SANDBOX_RO_PATHS"


def _sandbox_paths(name: str) -> list[str]:
    raw = os.environ.pop(name, "[]")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid {name}") from exc
    if not isinstance(value, list) or not value:
        raise RuntimeError(f"missing {name}")
    paths: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item or "\x00" in item:
            raise RuntimeError(f"invalid {name}")
        path = Path(item)
        if not path.is_absolute():
            raise RuntimeError(f"invalid {name}")
        resolved = str(path.resolve(strict=True))
        if resolved not in paths:
            paths.append(resolved)
    return paths


def install_filesystem_policy() -> None:
    rw_paths = _sandbox_paths(RW_PATHS_ENV)
    ro_paths = _sandbox_paths(RO_PATHS_ENV)

    policy = Landlock()
    policy.allow_read(*ro_paths)
    policy.allow_execute(*ro_paths)
    policy.allow_read_write(*rw_paths)
    policy.allow_execute(*rw_paths)

    device_paths = [path for path in ("/dev/null", "/dev/urandom", "/dev/random") if Path(path).exists()]
    if device_paths:
        policy.allow_read(*device_paths)
        policy.allow_write(*device_paths)
    policy.apply()


def install_restricted_syscalls() -> None:
    """Deny IP socket creation and process/system escape primitives."""
    policy = seccomp.SyscallFilter(defaction=seccomp.ALLOW)
    policy.add_rule(
        seccomp.ERRNO(errno.EPERM),
        "socket",
        seccomp.Arg(0, seccomp.NE, socket.AF_UNIX),
    )
    for syscall in (
        "ptrace",
        "process_vm_readv",
        "process_vm_writev",
        "bpf",
        "perf_event_open",
        "keyctl",
        "add_key",
        "request_key",
        "mount",
        "umount2",
        "pivot_root",
        "chroot",
        "unshare",
        "setns",
    ):
        try:
            policy.add_rule(seccomp.ERRNO(errno.EPERM), syscall)
        except (RuntimeError, ValueError):
            continue
    policy.load()


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("sandbox_exec requires an executable")
    requested = sys.argv[1]
    if "/" in requested or "\\" in requested:
        raise SystemExit("sandbox_exec requires a PATH-resolved executable name")
    executable = shutil.which(requested, path=os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"))
    if not executable:
        raise SystemExit(127)

    # Apply filesystem confinement before syscall confinement. Both policies are
    # irreversible for this process and inherited by all descendants.
    install_filesystem_policy()
    install_restricted_syscalls()
    os.execve(executable, [requested, *sys.argv[2:]], dict(os.environ))


if __name__ == "__main__":
    main()
