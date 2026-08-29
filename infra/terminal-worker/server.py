import asyncio
import hashlib
import hmac
import json
import os
import re
import shutil
import signal
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

TOKEN = os.environ.get("AIRA_TERMINAL_RUNTIME_TOKEN", "")
ROOT = Path(os.environ.get("AIRA_TERMINAL_WORKSPACE_ROOT", "/workspaces")).resolve()
REPOS_ROOT = (ROOT / "repos").resolve()
TREES_ROOT = (ROOT / "trees").resolve()
MAX_WORKSPACES = max(1, min(64, int(os.environ.get("AIRA_TERMINAL_MAX_WORKSPACES", "16"))))
DEFAULT_TIMEOUT_SECONDS = max(5, min(900, int(os.environ.get("AIRA_TERMINAL_COMMAND_TIMEOUT_SECONDS", "180"))))
MAX_OUTPUT_BYTES = max(32_768, min(8 * 1024 * 1024, int(os.environ.get("AIRA_TERMINAL_MAX_OUTPUT_BYTES", "1048576"))))
ALLOWED_GIT_HOSTS = tuple(
    value.strip().lower()
    for value in os.environ.get("AIRA_TERMINAL_ALLOWED_GIT_HOSTS", "github.com").split(",")
    if value.strip()
)
ALLOWED_EXECUTABLES = frozenset(
    value.strip()
    for value in os.environ.get(
        "AIRA_TERMINAL_ALLOWED_EXECUTABLES",
        "git,node,npm,npx,pnpm,python,python3,pytest,tsc,eslint",
    ).split(",")
    if value.strip()
)
GIT_AUTH_HEADER = os.environ.get("AIRA_TERMINAL_GIT_AUTH_HEADER", "").strip()
GIT_AUTHOR_NAME = os.environ.get("AIRA_TERMINAL_GIT_AUTHOR_NAME", "AIRA Agent")
GIT_AUTHOR_EMAIL = os.environ.get("AIRA_TERMINAL_GIT_AUTHOR_EMAIL", "aira-agent@localhost")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$")
SAFE_BRANCH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$")

ROOT.mkdir(parents=True, exist_ok=True)
REPOS_ROOT.mkdir(parents=True, exist_ok=True)
TREES_ROOT.mkdir(parents=True, exist_ok=True)


def _authorized(value: str | None) -> bool:
    if not TOKEN or not value or not value.lower().startswith("bearer "):
        return False
    supplied = value[7:].strip()
    return bool(supplied) and hmac.compare_digest(TOKEN, supplied)


async def require_token(authorization: str | None = Header(default=None)) -> None:
    if not _authorized(authorization):
        raise HTTPException(status_code=401, detail="unauthorized")


def _safe_identifier(value: str, label: str) -> str:
    if not SAFE_ID.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"invalid {label}")
    return value


def _safe_branch(value: str, label: str) -> str:
    if not SAFE_BRANCH.fullmatch(value) or ".." in value or value.endswith("/") or value.startswith("/"):
        raise HTTPException(status_code=400, detail=f"invalid {label}")
    return value


def _repo_url(value: str) -> str:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(status_code=400, detail="repositoryUrl must be a credential-free HTTPS URL")
    if host not in ALLOWED_GIT_HOSTS:
        raise HTTPException(status_code=403, detail="repository host is not allowed")
    if not parsed.path or parsed.path in {"/", ""}:
        raise HTTPException(status_code=400, detail="repositoryUrl must identify a repository")
    return value


def _repo_path(project_key: str) -> Path:
    return (REPOS_ROOT / _safe_identifier(project_key, "projectKey")).resolve()


def _tree_path(workspace_id: str) -> Path:
    return (TREES_ROOT / _safe_identifier(workspace_id, "workspaceId")).resolve()


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _workspace(workspace_id: str) -> Path:
    path = _tree_path(workspace_id)
    if not path.exists() or not (path / ".git").exists():
        raise HTTPException(status_code=404, detail="workspace not found")
    return path


def _cwd(workspace: Path, relative: str | None) -> Path:
    target = (workspace / (relative or ".")).resolve()
    if not _inside(target, workspace):
        raise HTTPException(status_code=400, detail="working directory escapes workspace")
    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=400, detail="working directory does not exist")
    return target


def _base_env(*, git_network: bool = False) -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/home/runner"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "CI": "1",
        "NODE_ENV": "test",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_AUTHOR_NAME": GIT_AUTHOR_NAME,
        "GIT_AUTHOR_EMAIL": GIT_AUTHOR_EMAIL,
        "GIT_COMMITTER_NAME": GIT_AUTHOR_NAME,
        "GIT_COMMITTER_EMAIL": GIT_AUTHOR_EMAIL,
    }
    if git_network and GIT_AUTH_HEADER:
        # Git reads this as config without placing the credential in argv or
        # exposing the worker's service token to child processes.
        env.update({
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.extraHeader",
            "GIT_CONFIG_VALUE_0": GIT_AUTH_HEADER,
        })
    return env


async def _run(
    argv: list[str],
    *,
    cwd: Path,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    git_network: bool = False,
    output_limit: int = MAX_OUTPUT_BYTES,
) -> dict[str, Any]:
    if not argv or argv[0] not in ALLOWED_EXECUTABLES:
        raise HTTPException(status_code=403, detail="executable is not allowed")
    if len(argv) > 64 or any(len(part) > 4096 or "\x00" in part for part in argv):
        raise HTTPException(status_code=400, detail="command arguments are invalid")
    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=str(cwd),
        env=_base_env(git_network=git_network),
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


async def _git(args: list[str], *, cwd: Path, network: bool = False, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
    return await _run(["git", *args], cwd=cwd, timeout_seconds=timeout, git_network=network)


class CreateWorkspaceRequest(BaseModel):
    workspaceId: str = Field(min_length=8, max_length=128)
    projectKey: str = Field(min_length=8, max_length=128)
    repositoryUrl: str = Field(min_length=8, max_length=2048)
    baseRef: str = Field(default="main", min_length=1, max_length=192)
    branch: str = Field(min_length=1, max_length=192)

    @field_validator("workspaceId", "projectKey")
    @classmethod
    def ids(cls, value: str) -> str:
        return _safe_identifier(value, "identifier")

    @field_validator("baseRef", "branch")
    @classmethod
    def refs(cls, value: str) -> str:
        return _safe_branch(value, "git ref")

    @field_validator("repositoryUrl")
    @classmethod
    def repo(cls, value: str) -> str:
        return _repo_url(value)


class ExecRequest(BaseModel):
    argv: list[str] = Field(min_length=1, max_length=64)
    cwd: str | None = Field(default=None, max_length=1024)
    timeoutSeconds: int = Field(default=DEFAULT_TIMEOUT_SECONDS, ge=1, le=900)


class CommitRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)


class MergeRequest(BaseModel):
    sourceBranch: str = Field(min_length=1, max_length=192)

    @field_validator("sourceBranch")
    @classmethod
    def branch(cls, value: str) -> str:
        return _safe_branch(value, "sourceBranch")


app = FastAPI(title="AIRA Terminal Worker", version="1.0.0")


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "workspaces": sum(1 for child in TREES_ROOT.iterdir() if child.is_dir()),
        "maxWorkspaces": MAX_WORKSPACES,
    }


@app.post("/v1/workspaces", dependencies=[Depends(require_token)])
async def create_workspace(body: CreateWorkspaceRequest) -> dict[str, Any]:
    workspace = _tree_path(body.workspaceId)
    repo = _repo_path(body.projectKey)
    if workspace.exists():
        status = await _git(["status", "--porcelain=v1", "--branch"], cwd=workspace)
        return {"workspaceId": body.workspaceId, "branch": body.branch, "status": status}
    count = sum(1 for child in TREES_ROOT.iterdir() if child.is_dir())
    if count >= MAX_WORKSPACES:
        raise HTTPException(status_code=429, detail="workspace capacity reached")
    if not repo.exists():
        repo.parent.mkdir(parents=True, exist_ok=True)
        clone = await _git(
            ["clone", "--filter=blob:none", "--no-checkout", body.repositoryUrl, str(repo)],
            cwd=REPOS_ROOT,
            network=True,
            timeout=300,
        )
        if clone["exitCode"] != 0:
            shutil.rmtree(repo, ignore_errors=True)
            raise HTTPException(status_code=502, detail="repository clone failed")
    else:
        remote = await _git(["remote", "get-url", "origin"], cwd=repo)
        if remote["exitCode"] != 0 or remote["stdout"].strip() != body.repositoryUrl:
            raise HTTPException(status_code=409, detail="projectKey is already bound to a different repository")
    fetch = await _git(["fetch", "--prune", "origin", body.baseRef], cwd=repo, network=True, timeout=180)
    if fetch["exitCode"] != 0:
        raise HTTPException(status_code=502, detail="base ref fetch failed")
    workspace.parent.mkdir(parents=True, exist_ok=True)
    add = await _git(
        ["worktree", "add", "-B", body.branch, str(workspace), f"origin/{body.baseRef}"],
        cwd=repo,
        timeout=120,
    )
    if add["exitCode"] != 0:
        shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(status_code=409, detail="worktree creation failed")
    return {
        "workspaceId": body.workspaceId,
        "branch": body.branch,
        "baseRef": body.baseRef,
        "repositoryUrl": body.repositoryUrl,
    }


@app.get("/v1/workspaces/{workspace_id}", dependencies=[Depends(require_token)])
async def workspace_status(workspace_id: str) -> dict[str, Any]:
    workspace = _workspace(workspace_id)
    branch = await _git(["branch", "--show-current"], cwd=workspace)
    status = await _git(["status", "--porcelain=v1"], cwd=workspace)
    return {
        "workspaceId": workspace_id,
        "branch": branch["stdout"].strip(),
        "dirty": bool(status["stdout"].strip()),
        "status": status,
    }


@app.post("/v1/workspaces/{workspace_id}/exec", dependencies=[Depends(require_token)])
async def execute(workspace_id: str, body: ExecRequest) -> dict[str, Any]:
    workspace = _workspace(workspace_id)
    cwd = _cwd(workspace, body.cwd)
    return await _run(body.argv, cwd=cwd, timeout_seconds=body.timeoutSeconds)


@app.get("/v1/workspaces/{workspace_id}/diff", dependencies=[Depends(require_token)])
async def workspace_diff(workspace_id: str) -> dict[str, Any]:
    workspace = _workspace(workspace_id)
    diff = await _git(["diff", "--no-ext-diff", "--no-color", "--"], cwd=workspace, timeout=60)
    staged = await _git(["diff", "--cached", "--no-ext-diff", "--no-color", "--"], cwd=workspace, timeout=60)
    return {"workspaceId": workspace_id, "unstaged": diff, "staged": staged}


@app.post("/v1/workspaces/{workspace_id}/commit", dependencies=[Depends(require_token)])
async def commit_workspace(workspace_id: str, body: CommitRequest) -> dict[str, Any]:
    workspace = _workspace(workspace_id)
    add = await _git(["add", "--all", "--"], cwd=workspace)
    if add["exitCode"] != 0:
        raise HTTPException(status_code=422, detail="git add failed")
    commit = await _git(["commit", "-m", body.message], cwd=workspace, timeout=120)
    if commit["exitCode"] != 0:
        # A clean tree is an explicit no-op, not a synthetic successful commit.
        status = await _git(["status", "--porcelain=v1"], cwd=workspace)
        if not status["stdout"].strip():
            return {"workspaceId": workspace_id, "committed": False, "reason": "clean"}
        raise HTTPException(status_code=422, detail="git commit failed")
    head = await _git(["rev-parse", "HEAD"], cwd=workspace)
    return {"workspaceId": workspace_id, "committed": True, "commit": head["stdout"].strip()}


@app.post("/v1/workspaces/{workspace_id}/merge", dependencies=[Depends(require_token)])
async def merge_workspace(workspace_id: str, body: MergeRequest) -> dict[str, Any]:
    workspace = _workspace(workspace_id)
    status = await _git(["status", "--porcelain=v1"], cwd=workspace)
    if status["stdout"].strip():
        raise HTTPException(status_code=409, detail="integration workspace must be clean before merge")
    merge = await _git(["merge", "--no-ff", "--no-edit", body.sourceBranch], cwd=workspace, timeout=180)
    if merge["exitCode"] != 0:
        conflicts = await _git(["diff", "--name-only", "--diff-filter=U"], cwd=workspace)
        return {
            "workspaceId": workspace_id,
            "merged": False,
            "conflicts": [line for line in conflicts["stdout"].splitlines() if line][:200],
        }
    head = await _git(["rev-parse", "HEAD"], cwd=workspace)
    return {"workspaceId": workspace_id, "merged": True, "commit": head["stdout"].strip()}


@app.delete("/v1/workspaces/{workspace_id}", dependencies=[Depends(require_token)])
async def delete_workspace(workspace_id: str) -> dict[str, Any]:
    workspace = _tree_path(workspace_id)
    if not workspace.exists():
        return {"ok": True, "removed": False}
    # `git worktree remove` must run from the owning repository. Resolve it from
    # the worktree's gitdir pointer without accepting any path from the caller.
    git_file = workspace / ".git"
    try:
        first = git_file.read_text(encoding="utf-8", errors="strict").strip()
        if not first.startswith("gitdir: "):
            raise ValueError("invalid gitdir")
        gitdir = Path(first[8:]).resolve()
        common = gitdir
        while common.name != ".git" and common.parent != common:
            common = common.parent
        repo = common.parent.resolve() if common.name == ".git" else None
    except (OSError, UnicodeError, ValueError):
        repo = None
    if repo is None or not _inside(repo, REPOS_ROOT):
        raise HTTPException(status_code=409, detail="workspace ownership metadata is invalid")
    result = await _git(["worktree", "remove", "--force", str(workspace)], cwd=repo, timeout=120)
    if result["exitCode"] != 0:
        raise HTTPException(status_code=422, detail="worktree cleanup failed")
    return {"ok": True, "removed": True}
