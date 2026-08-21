from pathlib import Path

import pytest

from aae_runner.security import WorkspaceViolation, resolve_workspace_path


def test_workspace_path_stays_inside(tmp_path: Path):
    assert resolve_workspace_path(tmp_path, 'src/app.py') == (tmp_path / 'src/app.py').resolve()


def test_workspace_path_rejects_traversal(tmp_path: Path):
    with pytest.raises(WorkspaceViolation):
        resolve_workspace_path(tmp_path, '../escape.txt')
