from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from agents import RunContextWrapper
from agents.decorators import tool

from .config import Settings
from .security import relative_workspace_path, resolve_workspace_path


@dataclass
class AgentContext:
    settings: Settings
    job_id: str
    owner_id: str
    modified_files: set[str] = field(default_factory=set)
    tool_calls: int = 0
    verification_calls: int = 0

    @property
    def workspace(self) -> Path:
        return self.settings.resolved_workspace()


def _bounded_text(path: Path, max_bytes: int) -> str:
    size = path.stat().st_size
    if size > max_bytes:
        raise ValueError(f'File is too large to read safely ({size} bytes).')
    return path.read_text(encoding='utf-8')


def _mark_call(ctx: RunContextWrapper[AgentContext]) -> AgentContext:
    state = ctx.context
    state.tool_calls += 1
    return state


@tool
async def list_directory(ctx: RunContextWrapper[AgentContext], path: str = '.') -> str:
    """List a workspace directory without leaving the configured workspace."""
    state = _mark_call(ctx)
    target = resolve_workspace_path(state.workspace, path)
    if not target.exists():
        raise FileNotFoundError(path)
    if not target.is_dir():
        raise NotADirectoryError(path)
    rows: list[dict[str, object]] = []
    for child in sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))[:500]:
        rows.append({
            'name': child.name,
            'path': relative_workspace_path(state.workspace, child),
            'type': 'directory' if child.is_dir() else 'file',
            'size': None if child.is_dir() else child.stat().st_size,
        })
    return json.dumps(rows, ensure_ascii=False)


@tool
async def read_file(
    ctx: RunContextWrapper[AgentContext],
    path: str,
    line_start: int | None = None,
    line_end: int | None = None,
) -> str:
    """Read a UTF-8 text file, optionally selecting an inclusive 1-based line range."""
    state = _mark_call(ctx)
    target = resolve_workspace_path(state.workspace, path)
    if not target.is_file():
        raise FileNotFoundError(path)
    text = _bounded_text(target, state.settings.max_file_bytes)
    if line_start is None and line_end is None:
        return text
    lines = text.splitlines()
    start = max(1, line_start or 1)
    end = min(len(lines), line_end or len(lines))
    if end < start:
        return ''
    return '\n'.join(f'{index + 1}: {lines[index]}' for index in range(start - 1, end))


@tool
async def write_file(ctx: RunContextWrapper[AgentContext], path: str, content: str) -> str:
    """Create or replace a UTF-8 text file inside the workspace."""
    state = _mark_call(ctx)
    if not state.settings.allow_file_writes:
        raise PermissionError('File writes are disabled by policy.')
    encoded = content.encode('utf-8')
    if len(encoded) > state.settings.max_file_bytes:
        raise ValueError('Requested file exceeds AAE_MAX_FILE_BYTES.')
    target = resolve_workspace_path(state.workspace, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')
    relative = relative_workspace_path(state.workspace, target)
    state.modified_files.add(relative)
    return f'Wrote {relative} ({len(encoded)} bytes).'


@tool
async def patch_file(
    ctx: RunContextWrapper[AgentContext],
    path: str,
    search: str,
    replace: str,
) -> str:
    """Replace exactly one matching text fragment in a workspace file."""
    state = _mark_call(ctx)
    if not state.settings.allow_file_writes:
        raise PermissionError('File writes are disabled by policy.')
    if not search:
        raise ValueError('search must not be empty.')
    target = resolve_workspace_path(state.workspace, path)
    text = _bounded_text(target, state.settings.max_file_bytes)
    count = text.count(search)
    if count != 1:
        raise ValueError(f'patch_file requires exactly one match; found {count}.')
    updated = text.replace(search, replace, 1)
    if len(updated.encode('utf-8')) > state.settings.max_file_bytes:
        raise ValueError('Patched file exceeds AAE_MAX_FILE_BYTES.')
    target.write_text(updated, encoding='utf-8')
    relative = relative_workspace_path(state.workspace, target)
    state.modified_files.add(relative)
    return f'Patched {relative}.'


@tool
async def execute_shell(ctx: RunContextWrapper[AgentContext], command: str) -> str:
    """Execute a verification/build command in the isolated no-egress sandbox sidecar."""
    state = _mark_call(ctx)
    if not state.settings.allow_shell:
        raise PermissionError('Shell execution is disabled by policy.')
    if len(command) > 8_000:
        raise ValueError('Shell command is too long.')
    state.verification_calls += 1
    headers = {
        'Authorization': f'Bearer {state.settings.sandbox_token}',
        'X-AAE-Job-Id': state.job_id,
    }
    timeout = httpx.Timeout(state.settings.shell_timeout_seconds + 5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{state.settings.sandbox_url.rstrip('/')}/exec",
            headers=headers,
            json={'command': command, 'timeout_seconds': state.settings.shell_timeout_seconds},
        )
    if response.status_code >= 400:
        raise RuntimeError(f'Sandbox execution failed ({response.status_code}).')
    payload = response.json()
    return json.dumps({
        'exit_code': payload.get('exit_code'),
        'stdout': str(payload.get('stdout', ''))[-40_000:],
        'stderr': str(payload.get('stderr', ''))[-20_000:],
        'timed_out': bool(payload.get('timed_out', False)),
    }, ensure_ascii=False)


def build_tools(settings: Settings):
    tools = [list_directory, read_file]
    if settings.allow_file_writes:
        tools.extend([write_file, patch_file])
    if settings.allow_shell:
        tools.append(execute_shell)
    return tools
