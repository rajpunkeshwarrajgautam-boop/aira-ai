import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import launcher
import server
import sandboxed_server as runtime


class TerminalSecurityPolicyTests(unittest.IsolatedAsyncioTestCase):
    def test_identifier_and_branch_validation_fail_closed(self):
        self.assertEqual(server._safe_identifier("workspace-123", "workspace"), "workspace-123")
        for value in ("../escape", "short", "bad value", "/absolute-name"):
            with self.subTest(value=value):
                with self.assertRaises(HTTPException):
                    server._safe_identifier(value, "workspace")
        self.assertEqual(server._safe_branch("aira/run-123/task-456", "branch"), "aira/run-123/task-456")
        for value in ("../main", "/main", "main/", "feature/../../main"):
            with self.subTest(value=value):
                with self.assertRaises(HTTPException):
                    server._safe_branch(value, "branch")

    def test_repository_url_is_credential_free_https_and_host_scoped(self):
        self.assertEqual(
            server._repo_url("https://github.com/example/project.git"),
            "https://github.com/example/project.git",
        )
        for value in (
            "http://github.com/example/project.git",
            "https://user:password@github.com/example/project.git",
            "https://github.com/example/project.git?token=secret",
            "https://github.com/example/project.git#fragment",
            "https://evil.example/example/project.git",
            "https://github.com/",
        ):
            with self.subTest(value=value):
                with self.assertRaises(HTTPException):
                    server._repo_url(value)

    def test_cwd_blocks_parent_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as workspace_raw, tempfile.TemporaryDirectory() as outside_raw:
            workspace = Path(workspace_raw).resolve()
            inside = workspace / "src"
            inside.mkdir()
            outside = Path(outside_raw).resolve()
            self.assertEqual(server._cwd(workspace, "src"), inside)
            with self.assertRaises(HTTPException):
                server._cwd(workspace, "../escape")
            link = workspace / "outside-link"
            link.symlink_to(outside, target_is_directory=True)
            with self.assertRaises(HTTPException):
                server._cwd(workspace, "outside-link")

    def test_child_environment_does_not_inherit_worker_or_git_credentials(self):
        env = server._base_env()
        self.assertNotIn("AIRA_TERMINAL_RUNTIME_TOKEN", env)
        self.assertNotIn("AIRA_TOOL_GATEWAY_TOKEN", env)
        self.assertNotIn("AIRA_RUNTIME_TOOL_GATEWAY_TOKEN", env)
        self.assertNotIn("GIT_CONFIG_VALUE_0", env)
        self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")

    def test_launcher_removes_secrets_from_exec_environment(self):
        with patch.dict(
            os.environ,
            {
                "AIRA_TERMINAL_RUNTIME_TOKEN": "runtime-secret-value",
                "AIRA_TERMINAL_GIT_AUTH_HEADER": "Authorization: Bearer git-secret-value",
                "SAFE_SETTING": "preserved",
            },
            clear=False,
        ):
            env = launcher.sanitized_environment(42)
        self.assertNotIn("AIRA_TERMINAL_RUNTIME_TOKEN", env)
        self.assertNotIn("AIRA_TERMINAL_GIT_AUTH_HEADER", env)
        self.assertEqual(env["AIRA_TERMINAL_SECRET_FD"], "42")
        self.assertEqual(env["AIRA_TERMINAL_REQUIRE_SECRET_FD"], "true")
        self.assertEqual(env["SAFE_SETTING"], "preserved")

    def test_only_server_owned_git_network_path_bypasses_child_sandbox(self):
        generic = runtime.command_argv(["git", "status"], git_network=False)
        self.assertEqual(generic[0], sys.executable)
        self.assertEqual(Path(generic[1]), runtime.SANDBOX_EXEC)
        self.assertEqual(generic[-2:], ["git", "status"])
        self.assertEqual(
            runtime.command_argv(
                ["git", "fetch", "--prune", "origin", "main"],
                git_network=True,
                trusted_git=True,
            ),
            ["git", "fetch", "--prune", "origin", "main"],
        )
        generic_network = runtime.command_argv(
            ["git", "fetch", "origin", "main"],
            git_network=True,
            trusted_git=False,
        )
        self.assertEqual(generic_network[0], sys.executable)

    async def test_generic_network_flag_is_denied_without_server_git_marker(self):
        with tempfile.TemporaryDirectory() as cwd_raw:
            with self.assertRaises(HTTPException) as denied:
                await runtime.sandboxed_run(
                    ["git", "fetch", "origin", "main"],
                    cwd=Path(cwd_raw),
                    git_network=True,
                    trusted_git=False,
                )
        self.assertEqual(denied.exception.status_code, 403)

    async def test_exec_rejects_unapproved_executable_and_nul_arguments(self):
        with tempfile.TemporaryDirectory() as cwd_raw:
            cwd = Path(cwd_raw)
            with self.assertRaises(HTTPException) as denied:
                await server._run(["bash", "-c", "echo unsafe"], cwd=cwd)
            self.assertEqual(denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as invalid:
                await server._run(["python3", "-c", "print('ok')\x00"], cwd=cwd)
            self.assertEqual(invalid.exception.status_code, 400)

    async def test_generic_exec_blocks_ip_network_but_keeps_unix_ipc(self):
        with tempfile.TemporaryDirectory() as cwd_raw:
            cwd = Path(cwd_raw)
            blocked = await server._run(
                ["python3", "-c", "import socket; socket.socket(socket.AF_INET, socket.SOCK_STREAM)"],
                cwd=cwd,
                timeout_seconds=5,
            )
            self.assertNotEqual(blocked["exitCode"], 0)
            self.assertIn("Operation not permitted", blocked["stderr"])

            local = await server._run(
                ["python3", "-c", "import socket; s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.close(); print('ok')"],
                cwd=cwd,
                timeout_seconds=5,
            )
            self.assertEqual(local["exitCode"], 0, local["stderr"])
            self.assertEqual(local["stdout"].strip(), "ok")

    async def test_network_filter_is_inherited_by_nested_children(self):
        child = "import socket; socket.socket(socket.AF_INET, socket.SOCK_STREAM)"
        outer = (
            "import subprocess,sys; "
            f"r=subprocess.run([sys.executable,'-c',{child!r}]); "
            "raise SystemExit(0 if r.returncode != 0 else 9)"
        )
        with tempfile.TemporaryDirectory() as cwd_raw:
            result = await server._run(["python3", "-c", outer], cwd=Path(cwd_raw), timeout_seconds=5)
        self.assertEqual(result["exitCode"], 0, result["stderr"])

    async def test_generic_exec_can_write_own_scope_but_not_sibling_or_symlink_target(self):
        with tempfile.TemporaryDirectory() as root_raw:
            root = Path(root_raw).resolve()
            workspace = root / "workspace"
            sibling = root / "sibling"
            workspace.mkdir()
            sibling.mkdir()
            secret = sibling / "secret.txt"
            secret.write_text("sibling-secret", encoding="utf-8")

            own = await server._run(
                ["python3", "-c", "from pathlib import Path; Path('own.txt').write_text('ok'); print(Path('own.txt').read_text())"],
                cwd=workspace,
                timeout_seconds=5,
            )
            self.assertEqual(own["exitCode"], 0, own["stderr"])
            self.assertEqual(own["stdout"].strip(), "ok")

            sibling_read = await server._run(
                ["python3", "-c", f"from pathlib import Path; print(Path({str(secret)!r}).read_text())"],
                cwd=workspace,
                timeout_seconds=5,
            )
            self.assertNotEqual(sibling_read["exitCode"], 0)
            self.assertIn("Permission denied", sibling_read["stderr"])

            link = workspace / "outside-link"
            link.symlink_to(sibling, target_is_directory=True)
            symlink_read = await server._run(
                ["python3", "-c", "from pathlib import Path; print(Path('outside-link/secret.txt').read_text())"],
                cwd=workspace,
                timeout_seconds=5,
            )
            self.assertNotEqual(symlink_read["exitCode"], 0)
            self.assertIn("Permission denied", symlink_read["stderr"])

    async def test_exec_enforces_output_bound(self):
        with tempfile.TemporaryDirectory() as cwd_raw:
            result = await server._run(
                ["python3", "-c", "print('x' * 4096)"],
                cwd=Path(cwd_raw),
                timeout_seconds=5,
                output_limit=64,
            )
        self.assertEqual(result["exitCode"], 0)
        self.assertTrue(result["truncated"])
        self.assertLessEqual(len(result["stdout"].encode("utf-8")), 64)

    async def test_exec_timeout_kills_the_process_group(self):
        with tempfile.TemporaryDirectory() as cwd_raw:
            with self.assertRaises(HTTPException) as timed_out:
                await server._run(
                    ["python3", "-c", "import time; time.sleep(5)"],
                    cwd=Path(cwd_raw),
                    timeout_seconds=0.05,
                )
        self.assertEqual(timed_out.exception.status_code, 408)


if __name__ == "__main__":
    unittest.main()
