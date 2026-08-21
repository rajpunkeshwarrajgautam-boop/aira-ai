from __future__ import annotations

from pathlib import Path


class WorkspaceViolation(ValueError):
    pass


def resolve_workspace_path(workspace: Path, requested: str | Path) -> Path:
    root = workspace.resolve()
    candidate = Path(requested)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise WorkspaceViolation('Path escapes the configured workspace.') from exc
    return resolved


def relative_workspace_path(workspace: Path, path: Path) -> str:
    return path.resolve().relative_to(workspace.resolve()).as_posix()
