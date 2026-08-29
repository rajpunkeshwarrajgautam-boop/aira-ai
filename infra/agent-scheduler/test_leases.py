import os
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg

DATABASE_URL = os.environ.get("AIRA_SCHEDULER_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/postgres")

CLAIM_SQL = '''
with candidates as (
  select "id"
  from "AgentPlatformRun"
  where "status" in ('PLANNING','RUNNING','WAITING')
    and ("nextSchedulerAttemptAt" is null or "nextSchedulerAttemptAt" <= current_timestamp)
    and ("schedulerLeaseExpiresAt" is null or "schedulerLeaseExpiresAt" < current_timestamp)
  order by "updatedAt" asc
  for update skip locked
  limit %s
)
update "AgentPlatformRun" r
set "schedulerLeaseOwner"=%s,
    "schedulerLeaseExpiresAt"=current_timestamp + (%s * interval '1 second'),
    "updatedAt"=current_timestamp
from candidates c
where r."id"=c."id"
returning r."id", r."userId", r."schedulerLeaseOwner"
'''

FAILURE_RELEASE_SQL = '''
update "AgentPlatformRun"
set "schedulerLeaseOwner"=null,
    "schedulerLeaseExpiresAt"=null,
    "schedulerFailureCount"="schedulerFailureCount"+1,
    "nextSchedulerAttemptAt"=current_timestamp +
      (least(300, greatest(5, ("schedulerFailureCount"+1) * 15)) * interval '1 second'),
    "updatedAt"=current_timestamp
where "id"=%s and "schedulerLeaseOwner"=%s
returning "schedulerFailureCount", "nextSchedulerAttemptAt"
'''


class SchedulerLeaseIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        deadline = time.time() + 30
        last_error = None
        while time.time() < deadline:
            try:
                with psycopg.connect(DATABASE_URL) as connection:
                    connection.execute("select 1")
                break
            except Exception as error:  # pragma: no cover - readiness loop
                last_error = error
                time.sleep(0.5)
        else:
            raise RuntimeError(f"Postgres did not become ready: {last_error}")

    def setUp(self):
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute('drop table if exists "AgentPlatformRun"')
            connection.execute('''
                create table "AgentPlatformRun" (
                  "id" text primary key,
                  "userId" text not null,
                  "status" text not null,
                  "schedulerLeaseOwner" text,
                  "schedulerLeaseExpiresAt" timestamptz,
                  "schedulerFailureCount" integer not null default 0,
                  "nextSchedulerAttemptAt" timestamptz,
                  "updatedAt" timestamptz not null default current_timestamp
                )
            ''')

    def insert_run(self, run_id, status="RUNNING", lease_owner=None, lease_expires_at=None, next_attempt=None, updated_offset=0):
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute(
                '''insert into "AgentPlatformRun"
                   ("id","userId","status","schedulerLeaseOwner","schedulerLeaseExpiresAt","nextSchedulerAttemptAt","updatedAt")
                   values (%s,'user-1',%s,%s,%s,%s,%s)''',
                (
                    run_id,
                    status,
                    lease_owner,
                    lease_expires_at,
                    next_attempt,
                    datetime.now(timezone.utc) + timedelta(seconds=updated_offset),
                ),
            )

    def claim(self, worker, limit=2, hold_seconds=0.15):
        with psycopg.connect(DATABASE_URL) as connection:
            with connection.transaction():
                rows = connection.execute(CLAIM_SQL, (limit, worker, 45)).fetchall()
                time.sleep(hold_seconds)
                return [row[0] for row in rows]

    def test_three_workers_never_claim_the_same_mission(self):
        for index in range(6):
            self.insert_run(f"run-{index}", updated_offset=index)
        self.insert_run("approval", status="APPROVAL_REQUIRED")
        self.insert_run("blocked", status="BLOCKED")

        barrier = threading.Barrier(3)

        def concurrent_claim(worker):
            barrier.wait(timeout=5)
            return self.claim(worker)

        with ThreadPoolExecutor(max_workers=3) as pool:
            claims = list(pool.map(concurrent_claim, ["scheduler-a", "scheduler-b", "scheduler-c"]))

        flattened = [run_id for batch in claims for run_id in batch]
        self.assertEqual(len(flattened), 6)
        self.assertEqual(len(set(flattened)), 6, claims)
        self.assertEqual(set(flattened), {f"run-{index}" for index in range(6)})
        self.assertNotIn("approval", flattened)
        self.assertNotIn("blocked", flattened)

    def test_expired_lease_is_reclaimable_but_active_lease_is_not(self):
        now = datetime.now(timezone.utc)
        self.insert_run("stale", lease_owner="dead-worker", lease_expires_at=now - timedelta(seconds=30))
        self.insert_run("active", lease_owner="live-worker", lease_expires_at=now + timedelta(minutes=5))
        claimed = self.claim("scheduler-new", limit=5, hold_seconds=0)
        self.assertIn("stale", claimed)
        self.assertNotIn("active", claimed)

    def test_future_backoff_is_not_claimed(self):
        self.insert_run("backoff", next_attempt=datetime.now(timezone.utc) + timedelta(minutes=2))
        self.insert_run("ready")
        claimed = self.claim("scheduler-a", limit=5, hold_seconds=0)
        self.assertEqual(claimed, ["ready"])

    def test_failure_release_is_owner_scoped_and_adds_backoff(self):
        self.insert_run("run-fail", lease_owner="scheduler-a", lease_expires_at=datetime.now(timezone.utc) + timedelta(seconds=45))
        before = datetime.now(timezone.utc)
        with psycopg.connect(DATABASE_URL) as connection:
            wrong = connection.execute(FAILURE_RELEASE_SQL, ("run-fail", "scheduler-b")).fetchone()
            self.assertIsNone(wrong)
            row = connection.execute(FAILURE_RELEASE_SQL, ("run-fail", "scheduler-a")).fetchone()
        self.assertIsNotNone(row)
        failure_count, next_attempt = row
        self.assertEqual(failure_count, 1)
        self.assertGreaterEqual(next_attempt, before + timedelta(seconds=10))

    def test_typescript_scheduler_retains_canonical_locking_contract(self):
        scheduler = Path(__file__).resolve().parents[2] / "perplexity-clone/my-turborepo/apps/web/lib/agent-platform/scheduler.ts"
        source = scheduler.read_text(encoding="utf-8").lower()
        self.assertIn("for update skip locked", source)
        self.assertIn("'planning','running','waiting'", source.replace(" ", ""))
        self.assertIn('"schedulerleaseowner"=${workerid}', source)
        self.assertIn('where "id"=${runid} and "schedulerleaseowner"=${workerid}', source)
        self.assertNotIn("approval_required','blocked", source.replace(" ", ""))


if __name__ == "__main__":
    unittest.main()
