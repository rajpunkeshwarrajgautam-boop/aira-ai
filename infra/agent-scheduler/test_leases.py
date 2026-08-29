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

RENEW_SQL = '''
update "AgentPlatformRun"
set "schedulerLeaseExpiresAt"=current_timestamp + (%s * interval '1 second'),
    "updatedAt"=current_timestamp
where "id"=%s
  and "schedulerLeaseOwner"=%s
  and "schedulerLeaseExpiresAt" >= current_timestamp
  and "status" in ('PLANNING','RUNNING','WAITING')
returning "schedulerLeaseExpiresAt"
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

    def test_live_owner_can_renew_but_wrong_or_expired_owner_cannot(self):
        now = datetime.now(timezone.utc)
        self.insert_run("renewable", lease_owner="scheduler-a", lease_expires_at=now + timedelta(seconds=20))
        self.insert_run("expired", lease_owner="scheduler-a", lease_expires_at=now - timedelta(seconds=1))
        before = datetime.now(timezone.utc)
        with psycopg.connect(DATABASE_URL) as connection:
            wrong = connection.execute(RENEW_SQL, (45, "renewable", "scheduler-b")).fetchone()
            renewed = connection.execute(RENEW_SQL, (45, "renewable", "scheduler-a")).fetchone()
            stale = connection.execute(RENEW_SQL, (45, "expired", "scheduler-a")).fetchone()
        self.assertIsNone(wrong)
        self.assertIsNotNone(renewed)
        self.assertGreaterEqual(renewed[0], before + timedelta(seconds=40))
        self.assertIsNone(stale)

    def test_heartbeat_keeps_long_tick_exclusive_until_renewal_stops(self):
        lease_seconds = 2
        self.insert_run(
            "long-tick",
            lease_owner="scheduler-a",
            lease_expires_at=datetime.now(timezone.utc) + timedelta(seconds=lease_seconds),
        )
        stop = threading.Event()
        renewals = []

        def heartbeat():
            while not stop.wait(0.4):
                with psycopg.connect(DATABASE_URL) as connection:
                    row = connection.execute(RENEW_SQL, (lease_seconds, "long-tick", "scheduler-a")).fetchone()
                renewals.append(row is not None)
                if row is None:
                    return

        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        try:
            # Wait past the original lease deadline. Repeated owner-scoped
            # heartbeats must keep the mission unavailable to a competitor.
            time.sleep(2.6)
            self.assertTrue(any(renewals), renewals)
            self.assertEqual(self.claim("scheduler-b", limit=1, hold_seconds=0), [])
        finally:
            stop.set()
            thread.join(timeout=2)

        # Once renewal stops and the latest lease really expires, another
        # scheduler is allowed to recover the mission.
        time.sleep(2.2)
        self.assertEqual(self.claim("scheduler-b", limit=1, hold_seconds=0), ["long-tick"])

    def test_expired_owner_cannot_resurrect_after_another_scheduler_reclaims(self):
        self.insert_run(
            "handoff",
            lease_owner="scheduler-old",
            lease_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        claimed = self.claim("scheduler-new", limit=1, hold_seconds=0)
        self.assertEqual(claimed, ["handoff"])
        with psycopg.connect(DATABASE_URL) as connection:
            stale = connection.execute(RENEW_SQL, (45, "handoff", "scheduler-old")).fetchone()
            owner = connection.execute(
                'select "schedulerLeaseOwner" from "AgentPlatformRun" where "id"=\'handoff\''
            ).fetchone()[0]
        self.assertIsNone(stale)
        self.assertEqual(owner, "scheduler-new")

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
        self.assertIn("renewschedulerlease", source)
        self.assertIn('"schedulerleaseexpiresat">=current_timestamp', source.replace(" ", ""))
        self.assertIn("startschedulerleaseheartbeat", source)
        self.assertNotIn("approval_required','blocked", source.replace(" ", ""))


if __name__ == "__main__":
    unittest.main()
