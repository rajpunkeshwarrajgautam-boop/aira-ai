import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

import server


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

    def test_child_environment_does_not_inherit_worker_service_token(self):
        env = server._base_env()
        self.assertNotIn("AIRA_TERMINAL_RUNTIME_TOKEN", env)
        self.assertNotIn("AIRA_TOOL_GATEWAY_TOKEN", env)
        self.assertNotIn("AIRA_RUNTIME_TOOL_GATEWAY_TOKEN", env)
        self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")

    async def test_exec_rejects_unapproved_executable_and_nul_arguments(self):
        with tempfile.TemporaryDirectory() as cwd_raw:
            cwd = Path(cwd_raw)
            with self.assertRaises(HTTPException) as denied:
                await server._run(["bash", "-c", "echo unsafe"], cwd=cwd)
            self.assertEqual(denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as invalid:
                await server._run(["python3", "-c", "print('ok')\x00"], cwd=cwd)
            self.assertEqual(invalid.exception.status_code, 400)

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
