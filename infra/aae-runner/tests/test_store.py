from __future__ import annotations

import asyncio
from pathlib import Path

from aae_runner.store import JobStore


def test_termination_wins_over_worker_failure(tmp_path: Path) -> None:
    async def scenario() -> None:
        store = JobStore(tmp_path / 'jobs.db')
        await store.initialize()
        await store.submit(job_id='job-cancel-123', owner_id='owner', task='work', session_id='session')
        assert await store.next_queued() is not None
        terminated = await store.terminate('job-cancel-123', 'owner')
        assert terminated is not None
        assert terminated.status == 'TERMINATED'

        # Mirrors the worker cancellation handler racing after the API has
        # already persisted TERMINATED. fail() must not overwrite it.
        await store.fail('job-cancel-123', 'Agent execution was interrupted.')
        final = await store.get('job-cancel-123', 'owner')
        assert final is not None
        assert final.status == 'TERMINATED'

    asyncio.run(scenario())


def test_restart_closes_abandoned_running_job(tmp_path: Path) -> None:
    async def scenario() -> None:
        database = tmp_path / 'jobs.db'
        store = JobStore(database)
        await store.initialize()
        await store.submit(job_id='job-restart-123', owner_id='owner', task='work', session_id='session')
        assert await store.next_queued() is not None
        assert await store.status('job-restart-123') == 'RUNNING'

        restarted = JobStore(database)
        await restarted.initialize()
        final = await restarted.get('job-restart-123', 'owner')
        assert final is not None
        assert final.status == 'FAILED'
        assert final.completed_at is not None

    asyncio.run(scenario())
