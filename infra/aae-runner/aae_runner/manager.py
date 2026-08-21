from __future__ import annotations

import asyncio
import contextlib

import httpx

from .config import Settings
from .engine import AutonomousEngine
from .models import JobResponse
from .store import JobStore


class JobManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = JobStore(settings.database_path)
        self.engine = AutonomousEngine(settings)
        self._worker: asyncio.Task[None] | None = None
        self._wake = asyncio.Event()
        self._active: dict[str, asyncio.Task[dict]] = {}
        self._closing = False

    async def start(self) -> None:
        await self.store.initialize()
        self._worker = asyncio.create_task(self._loop(), name='aae-worker')
        self._wake.set()

    async def close(self) -> None:
        self._closing = True
        self._wake.set()
        for task in list(self._active.values()):
            task.cancel()
        if self._worker:
            self._worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._worker

    async def submit(self, *, job_id: str, owner_id: str, task: str, session_id: str | None) -> JobResponse:
        job = await self.store.submit(
            job_id=job_id,
            owner_id=owner_id,
            task=task,
            session_id=session_id or job_id,
        )
        self._wake.set()
        return job

    async def get(self, job_id: str, owner_id: str) -> JobResponse | None:
        return await self.store.get(job_id, owner_id)

    async def cancel(self, job_id: str, owner_id: str) -> JobResponse | None:
        existing = await self.store.get(job_id, owner_id)
        if existing is None:
            return None
        if existing.status in {'COMPLETED', 'FAILED', 'TERMINATED'}:
            return existing
        # Persist TERMINATED first. If the worker observes cancellation while this
        # request is still in flight, its failure handler sees a terminal state
        # and cannot race the user's cancellation into FAILED.
        terminated = await self.store.terminate(job_id, owner_id)
        task = self._active.get(job_id)
        if task:
            task.cancel()
        await self._cancel_sandbox(job_id)
        return terminated

    async def _cancel_sandbox(self, job_id: str) -> None:
        if not self.settings.allow_shell:
            return
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                await client.post(
                    f"{self.settings.sandbox_url.rstrip('/')}/cancel/{job_id}",
                    headers={'Authorization': f'Bearer {self.settings.sandbox_token}'},
                )
        except Exception:
            pass

    async def _loop(self) -> None:
        while not self._closing:
            item = await self.store.next_queued()
            if item is None:
                self._wake.clear()
                await self._wake.wait()
                continue
            job_id, owner_id, task_text, session_id = item
            run_task = asyncio.create_task(
                self.engine.run(
                    job_id=job_id,
                    owner_id=owner_id,
                    task=task_text,
                    session_id=session_id,
                ),
                name=f'aae-job-{job_id}',
            )
            self._active[job_id] = run_task
            try:
                result = await run_task
                if await self.store.status(job_id) == 'RUNNING':
                    await self.store.complete(job_id, result)
            except asyncio.CancelledError:
                if not self._closing and await self.store.status(job_id) == 'RUNNING':
                    await self.store.fail(job_id, 'Agent execution was interrupted.')
            except Exception as exc:
                if await self.store.status(job_id) == 'RUNNING':
                    await self.store.fail(job_id, f'{type(exc).__name__}: {exc}')
            finally:
                self._active.pop(job_id, None)
