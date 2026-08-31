import asyncio
import json
import os
import shutil
import signal
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException

import server as _server

SANDBOX_EXEC = Path(__file__).with_name("sandbox_exec.py").resolve()
RW_PATHS_ENV = "AIRA_TERMINAL_SANDBOX_RW_PATHS"
RO_PATHS_ENV = "AIRA_TERMINAL_SANDBOX_RO_PATHS"


def command_argv(argv: list[str], *, git_network: bool, trusted_git: bool = False) -> list[str]:
    """Route generic/local commands through the irreversible child sandbox."""
    if git_network and trusted_git:
        return list(argv)
    return [sys.executable, str(SANDBOX_EXEC), *argv]


def _scope_root(cwd: Path) -> Path:
    resolved = cwd.resolve()
    for parent in (_server.TREES_ROOT, _server.REPOS_ROOT):
        try:
            relative = resolved.relative_to(parent)
        except ValueError:
            continue
        if relative.parts:
            return (parent / relative.parts[0]).resolve()
    return resolved


def _worktree_repository(scope: Path) -> Path | None:
    git_file = scope / ".git"
    if not git_file.is_file():
        return None
    try:
        first = git_file.read_text(encoding="utf-8", errors="strict").strip()
        if not first.startswith("gitdir: "):
            return None
        gitdir = Path(first[8:])
        if not gitdir.is_absolute():
            gitdir = (scope / gitdir).resolve()
        else:
            gitdir = gitdir.resolve()
        common = gitdir
        while common.name != ".git" and common.parent != common:
            common = common.parent
        repo = common.parent.resolve() if common.name == ".git" else None
    except (OSError, UnicodeError, ValueError):
        return None
    if repo is None or not _server._inside(repo, _server.REPOS_ROOT):
        return None
    return repo


def _existing_roots() -> list[str]:
    candidates = [
        Path("/usr"),
        Path("/usr/local"),
        Path("/bin"),
        Path("/lib"),
        Path("/lib64"),
        Path("/etc"),
        Path(sys.prefix),
        Path(sys.base_prefix),
    ]
    roots: list[str] = []
    for candidate in candidates:
        try:
            resolved = str(candidate.resolve(strict=True))
        except (OSError, RuntimeError):
            continue
        if resolved not in roots:
            roots.append(resolved)
    return roots


def _sandbox_environment(
    argv: list[str],
    *,
    cwd: Path,
    trusted_git: bool,
    base_env: dict[str, str],
) -> tuple[dict[str, str], Path]:
    scope = _scope_root(cwd)
    scratch = Path(tempfile.mkdtemp(prefix="aira-terminal-", dir="/tmp")).resolve()

    rw_paths = [str(scope), str(scratch)]
    if trusted_git and argv and argv[0] == "git":
        repo = _worktree_repository(scope)
        if repo is not None and str(repo) not in rw_paths:
            rw_paths.append(str(repo))
        if len(argv) >= 3 and argv[1] == "worktree" and argv[2] in {"add", "remove"}:
            tree_root = str(_server.TREES_ROOT.resolve())
            if tree_root not in rw_paths:
                rw_paths.append(tree_root)

    env = dict(base_env)
    env[RW_PATHS_ENV] = json.dumps(rw_paths, separators=(",", ":"))
    env[RO_PATHS_ENV] = json.dumps(_existing_roots(), separators=(",", ":"))
    env["HOME"] = str(scratch)
    env["TMPDIR"] = str(scratch)
    env["TMP"] = str(scratch)
    env["TEMP"] = str(scratch)
    env["XDG_CACHE_HOME"] = str(scratch / "cache")
    (scratch / "cache").mkdir(mode=0o700)
    return env, scratch


async def sandboxed_run(
    argv: list[str],
    *,
    cwd: Path,
    timeout_seconds: int = _server.DEFAULT_TIMEOUT_SECONDS,
    git_network: bool = False,
    output_limit: int = _server.MAX_OUTPUT_BYTES,
    trusted_git: bool = False,
) -> dict[str, Any]:
    if not argv or argv[0] not in _server.ALLOWED_EXECUTABLES:
        raise HTTPException(status_code=403, detail="executable is not allowed")
    if len(argv) > 64 or any(len(part) > 4096 or "\x00" in part for part in argv):
        raise HTTPException(status_code=400, detail="command arguments are invalid")
    if git_network and not trusted_git:
        raise HTTPException(status_code=403, detail="networked terminal execution is reserved for server-owned Git operations")
    if not git_network and not SANDBOX_EXEC.is_file():
        raise HTTPException(status_code=503, detail="terminal execution sandbox is unavailable")

    scratch: Path | None = None
    env = _server._base_env(git_network=git_network)
    if not git_network:
        env, scratch = _sandbox_environment(argv, cwd=cwd, trusted_git=trusted_git, base_env=env)

    started = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            *command_argv(argv, git_network=git_network, trusted_git=trusted_git),
            cwd=str(cwd),
            env=env,
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
    finally:
        if scratch is not None:
            shutil.rmtree(scratch, ignore_errors=True)

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


async def sandboxed_git(
    args: list[str],
    *,
    cwd: Path,
    network: bool = False,
    timeout: int = _server.DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    return await sandboxed_run(
        ["git", *args],
        cwd=cwd,
        timeout_seconds=timeout,
        git_network=network,
        trusted_git=True,
    )


# Patch both primitives before Uvicorn serves the pre-registered FastAPI routes.
# Generic endpoint calls keep trusted_git=False. Only server-owned `_git` calls
# receive the trusted marker needed for validated clone/fetch and Git metadata.
_server._run = sandboxed_run
_server._git = sandboxed_git

app = _server.app
