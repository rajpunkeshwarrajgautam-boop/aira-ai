from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

from .models import JobResponse


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobStore:
    def __init__(self, path: Path):
        self.path = path

    async def initialize(self) -> None:
        async with aiosqlite.connect(self.path) as db:
            await db.execute('PRAGMA journal_mode=WAL')
            await db.execute('''
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    task TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    output TEXT,
                    error TEXT,
                    modified_files TEXT NOT NULL DEFAULT '[]',
                    usage TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT
                )
            ''')
            now = utc_now()
            await db.execute(
                "UPDATE jobs SET status='FAILED', error='Worker restarted before this task completed.', updated_at=?, completed_at=? WHERE status='RUNNING'",
                (now, now),
            )
            await db.commit()

    async def submit(self, *, job_id: str, owner_id: str, task: str, session_id: str) -> JobResponse:
        now = utc_now()
        async with aiosqlite.connect(self.path) as db:
            try:
                await db.execute(
                    'INSERT INTO jobs (id, owner_id, task, session_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    (job_id, owner_id, task, session_id, 'QUEUED', now, now),
                )
                await db.commit()
            except aiosqlite.IntegrityError:
                pass
        row = await self.get(job_id, owner_id)
        if row is None:
            raise PermissionError('Job id already belongs to another owner.')
        return row

    async def get(self, job_id: str, owner_id: str) -> JobResponse | None:
        async with aiosqlite.connect(self.path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute('SELECT * FROM jobs WHERE id=? AND owner_id=?', (job_id, owner_id))
            row = await cursor.fetchone()
        return self._dto(row) if row else None

    async def next_queued(self) -> tuple[str, str, str, str] | None:
        async with aiosqlite.connect(self.path) as db:
            db.row_factory = aiosqlite.Row
            await db.execute('BEGIN IMMEDIATE')
            cursor = await db.execute("SELECT id, owner_id, task, session_id FROM jobs WHERE status='QUEUED' ORDER BY created_at ASC LIMIT 1")
            row = await cursor.fetchone()
            if not row:
                await db.commit()
                return None
            now = utc_now()
            changed = await db.execute("UPDATE jobs SET status='RUNNING', updated_at=? WHERE id=? AND status='QUEUED'", (now, row['id']))
            await db.commit()
            if changed.rowcount != 1:
                return None
            return row['id'], row['owner_id'], row['task'], row['session_id']

    async def complete(self, job_id: str, result: dict) -> None:
        now = utc_now()
        async with aiosqlite.connect(self.path) as db:
            await db.execute(
                "UPDATE jobs SET status='COMPLETED', output=?, error=NULL, modified_files=?, usage=?, updated_at=?, completed_at=? WHERE id=? AND status='RUNNING'",
                (
                    result.get('output'),
                    json.dumps(result.get('modified_files', [])),
                    json.dumps(result.get('usage', {})),
                    now,
                    now,
                    job_id,
                ),
            )
            await db.commit()

    async def fail(self, job_id: str, message: str) -> None:
        now = utc_now()
        safe = message[:2_000] if message else 'Agent execution failed.'
        async with aiosqlite.connect(self.path) as db:
            await db.execute(
                "UPDATE jobs SET status='FAILED', error=?, updated_at=?, completed_at=? WHERE id=? AND status IN ('QUEUED','RUNNING')",
                (safe, now, now, job_id),
            )
            await db.commit()

    async def terminate(self, job_id: str, owner_id: str) -> JobResponse | None:
        now = utc_now()
        async with aiosqlite.connect(self.path) as db:
            await db.execute(
                "UPDATE jobs SET status='TERMINATED', error=NULL, updated_at=?, completed_at=? WHERE id=? AND owner_id=? AND status IN ('QUEUED','RUNNING')",
                (now, now, job_id, owner_id),
            )
            await db.commit()
        return await self.get(job_id, owner_id)

    async def status(self, job_id: str) -> str | None:
        async with aiosqlite.connect(self.path) as db:
            cursor = await db.execute('SELECT status FROM jobs WHERE id=?', (job_id,))
            row = await cursor.fetchone()
        return row[0] if row else None

    @staticmethod
    def _dto(row: aiosqlite.Row) -> JobResponse:
        return JobResponse(
            id=row['id'],
            status=row['status'],
            output=row['output'],
            error=row['error'],
            modified_files=json.loads(row['modified_files'] or '[]'),
            usage=json.loads(row['usage'] or '{}'),
            created_at=row['created_at'],
            updated_at=row['updated_at'],
            completed_at=row['completed_at'],
        )
