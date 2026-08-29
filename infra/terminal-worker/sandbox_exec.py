import errno
import os
import shutil
import socket
import sys

import pyseccomp as seccomp


def install_restricted_syscalls() -> None:
    """Deny IP/network socket creation and process-memory escape primitives.

    The filter is installed immediately before exec and is inherited across
    fork/clone/exec, so nested Python/Node/package-manager children cannot
    reconstruct outbound IP connectivity. AF_UNIX stays available for local
    process IPC. The long-lived worker and its explicitly server-owned Git
    clone/fetch path do not run through this helper.
    """
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
            # Some syscalls are architecture-specific. Missing syscalls do not
            # weaken the primary socket-domain rule on that architecture.
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
    install_restricted_syscalls()
    os.execve(executable, [requested, *sys.argv[2:]], dict(os.environ))


if __name__ == "__main__":
    main()
