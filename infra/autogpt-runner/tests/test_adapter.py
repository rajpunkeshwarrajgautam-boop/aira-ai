from __future__ import annotations

import asyncio
import importlib.util
import os
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


class RunnerContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = tempfile.TemporaryDirectory()
        os.environ.update(
            {
                "RUNNER_DATABASE_PATH": str(
                    Path(cls.temp_dir.name) / "runner-contract.db"
                ),
                "RUNNER_API_KEY": "r" * 48,
                "AUTOGPT_INTERNAL_TOKEN": "sk-" + ("i" * 48),
                "NVIDIA_API_KEY": "nvapi-" + ("n" * 48),
                "RUNNER_HOST_ROLE": "contract-test",
            }
        )
        app_path = Path(__file__).parents[1] / "adapter" / "app.py"
        spec = importlib.util.spec_from_file_location("runner_app", app_path)
        assert spec and spec.loader
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

        # Wrapped in a tuple so attribute access does not bind it as a method.
        cls.real_run_execution = (cls.module._run_execution,)

        async def fake_run(execution_id: str) -> None:
            cls.module._update_execution(
                execution_id,
                status="COMPLETED",
                output="Contract test completed.",
            )

        cls.module._run_execution = fake_run

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp_dir.cleanup()

    def test_idempotent_execute_and_results_contract(self) -> None:
        headers = {
            "X-API-Key": "r" * 48,
            "X-AIRA-Request-ID": "local-run-123",
        }
        body = {"node_input": {"objective": {"value": "Prepare a launch plan."}}}
        path = "/external-api/v1/graphs/aira-objective-runner/execute/1"

        with TestClient(self.module.app) as client:
            first = client.post(path, headers=headers, json=body)
            duplicate = client.post(path, headers=headers, json=body)
            self.assertEqual(first.status_code, 200)
            self.assertEqual(duplicate.status_code, 200)
            execution_id = first.json()["id"]
            self.assertEqual(duplicate.json()["id"], execution_id)

            result = None
            for _ in range(20):
                result = client.get(
                    "/external-api/v1/graphs/aira-objective-runner/"
                    f"executions/{execution_id}/results",
                    headers={"X-API-Key": "r" * 48},
                )
                if result.json()["status"] == "COMPLETED":
                    break
                time.sleep(0.02)

            assert result is not None
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["status"], "COMPLETED")
            self.assertEqual(result.json()["output"], "Contract test completed.")

    def test_rejects_missing_key(self) -> None:
        with TestClient(self.module.app) as client:
            response = client.get("/external-api/v1/health")
        self.assertEqual(response.status_code, 401)

    def test_request_id_cannot_be_reused_for_another_objective(self) -> None:
        headers = {
            "X-API-Key": "r" * 48,
            "X-AIRA-Request-ID": "local-run-conflict",
        }
        path = "/external-api/v1/graphs/aira-objective-runner/execute/1"

        with TestClient(self.module.app) as client:
            first = client.post(
                path,
                headers=headers,
                json={"node_input": {"objective": {"value": "First objective"}}},
            )
            conflict = client.post(
                path,
                headers=headers,
                json={"node_input": {"objective": {"value": "Other objective"}}},
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(conflict.status_code, 409)

    def _run_with_stub(self, fake_request, objective: str) -> str:
        module = self.module
        module._initialize_database()
        execution_id, _ = module._create_execution(
            f"stub-{time.time_ns()}", objective
        )
        original = module._autogpt_request
        module._autogpt_request = fake_request
        try:
            asyncio.run(self.real_run_execution[0](execution_id))
        finally:
            module._autogpt_request = original
        return execution_id

    def test_multi_step_task_runs_until_is_last(self) -> None:
        """A step marked "completed" is a finished step, not a finished task."""
        steps = [
            {"status": "completed", "is_last": False, "output": "Researching."},
            {"status": "completed", "is_last": False, "output": "Drafting."},
            {"status": "completed", "is_last": True, "output": "Final answer."},
        ]
        step_calls = 0

        async def fake_request(method, path, payload=None):
            nonlocal step_calls
            if path == "/agent/tasks":
                return {"task_id": "task-multi"}
            step_calls += 1
            return steps[step_calls - 1]

        execution_id = self._run_with_stub(fake_request, "Write a launch plan.")
        row = self.module._execution(execution_id)
        self.assertEqual(row["status"], "COMPLETED")
        self.assertEqual(row["output"], "Final answer.")
        self.assertEqual(step_calls, 3)

    def test_provider_error_in_step_output_fails_the_run(self) -> None:
        """An upstream outage must not be stored as a successful run."""

        async def fake_request(method, path, payload=None):
            if path == "/agent/tasks":
                return {"task_id": "task-error"}
            return {
                "status": "completed",
                "is_last": False,
                "output": (
                    "An error occurred while proposing the next action: "
                    "Error code: 401 - Unauthorized"
                ),
            }

        execution_id = self._run_with_stub(fake_request, "Summarize the market.")
        row = self.module._execution(execution_id)
        self.assertEqual(row["status"], "FAILED")
        self.assertIn("401", row["error"])

    def test_stored_output_is_bounded(self) -> None:
        original_limit = self.module.MAX_STORED_OUTPUT_BYTES
        self.module.MAX_STORED_OUTPUT_BYTES = 64
        try:
            output = self.module._truncate_output("🙂" * 100)
        finally:
            self.module.MAX_STORED_OUTPUT_BYTES = original_limit

        self.assertLessEqual(len(output.encode("utf-8")), 64)
        self.assertTrue(output.endswith("[Output truncated by AIRA runner.]"))


if __name__ == "__main__":
    unittest.main()
