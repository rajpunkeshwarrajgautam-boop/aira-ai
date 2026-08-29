import asyncio
import os
import signal
import sys
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException

import server as _server

SANDBOX_EXEC = Path(__file__).with_name("sandbox_exec.py").resolve()


def command_argv(argv: list[str], *, git_network: bool) -> list[str]:
    """Route generic/local commands through the irreversible child sandbox.

    Only server-owned Git clone/fetch operations set git_network=True and may
    bypass the no-IP filter. The public exec endpoint never sets that flag.
    """
    if git_network:
        return list(argv)
    return [sys.executable, str(SANDBOX_EXEC), *argv]


async def sandboxed_run(
    argv: list[str],
    *,
    cwd: Path,
    timeout_seconds: int = _server.DEFAULT_TIMEOUT_SECONDS,
    git_network: bool = False,
    output_limit: int = _server.MAX_OUTPUT_BYTES,
) -> dict[str, Any]:
    if not argv or argv[0] not in _server.ALLOWED_EXECUTABLES:
        raise HTTPException(status_code=403, detail="executable is not allowed")
    if len(argv) > 64 or any(len(part) > 4096 or "\x00" in part for part in argv):
        raise HTTPException(status_code=400, detail="command arguments are invalid")
    if not git_network and not SANDBOX_EXEC.is_file():
        raise HTTPException(status_code=503, detail="terminal execution sandbox is unavailable")

    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        *command_argv(argv, git_network=git_network),
        cwd=str(cwd),
        env=_server._base_env(git_network=git_network),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
    except asyncio.TimeoutError as exc:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await proc.wait()
        raise HTTPException(status_code=408, detail="command timed out") from exc

    truncated = len(stdout) > output_limit or len(stderr) > output_limit
    stdout = stdout[:output_limit]
    stderr = stderr[:output_limit]
    return {
        "exitCode": proc.returncode,
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
        "truncated": truncated,
        "durationMs": int((time.monotonic() - started) * 1000),
    }


# Patch the module-global execution primitive used by `_git` and every FastAPI
# endpoint before Uvicorn starts serving requests. This keeps server-owned Git
# clone/fetch working while generic exec, local Git, hooks and all descendants
# inherit the no-IP seccomp filter.
_server._run = sandboxed_run

app = _server.app
