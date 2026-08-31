import os
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg

DATABASE_URL = os.environ.get("AIRA_SCHEDULER_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/postgres")

CLAIM_TASK_SQL = '''
update "AgentTask"
set "status"='CLAIMED', "leaseOwner"=%s,
    "leaseExpiresAt"=current_timestamp + (%s * interval '1 second'),
    "heartbeatAt"=current_timestamp, "updatedAt"=current_timestamp
where "id"=%s and "status" in ('QUEUED','READY')
  and ("leaseExpiresAt" is null or "leaseExpiresAt" < current_timestamp)
returning "id","leaseOwner"
'''

CREATE_AGENT_SQL = '''
insert into "AgentInstance" ("id","projectId","runId","status","currentTaskId")
select %s,'project-1','run-1','IDLE',t."id"
from "AgentTask" t
where t."id"=%s and t."projectId"='project-1' and t."runId"='run-1'
  and t."status"='CLAIMED' and t."leaseOwner"=%s
  and t."leaseExpiresAt" >= current_timestamp
  and not exists (
    select 1 from "AgentInstance" i
    where i."currentTaskId"=t."id" and i."status" in ('IDLE','WORKING','WAITING','PAUSED')
  )
returning "id"
'''

MARK_RUNNING_SQL = '''
update "AgentTask"
set "status"='RUNNING', "runtimeRunId"=%s, "attempt"="attempt"+1,
    "leaseOwner"=null, "leaseExpiresAt"=null, "heartbeatAt"=current_timestamp,
    "updatedAt"=current_timestamp
where "id"=%s and "status"='CLAIMED' and "leaseOwner"=%s
  and "leaseExpiresAt" >= current_timestamp
returning "id"
'''

CONSUME_ATTEMPT_SQL = '''
update "AgentTask"
set "attempt"="attempt"+1, "updatedAt"=current_timestamp
where "id"=%s and "status"='CLAIMED' and "leaseOwner"=%s
  and "leaseExpiresAt" >= current_timestamp
returning "attempt","maxAttempts"
'''

FAIL_CONSUMED_ATTEMPT_SQL = '''
update "AgentTask"
set "status"=case when "attempt" < "maxAttempts" then 'QUEUED' else 'FAILED' end,
    "leaseOwner"=null, "leaseExpiresAt"=null, "updatedAt"=current_timestamp
where "id"=%s and "status"='CLAIMED' and "leaseOwner"=%s
  and "leaseExpiresAt" >= current_timestamp
returning "status","attempt","maxAttempts"
'''

FENCE_BLOCK_SQL = '''
update "AgentTask"
set "status"='BLOCKED', "leaseOwner"=null, "leaseExpiresAt"=null, "updatedAt"=current_timestamp
where "id"=%s and "status"='CLAIMED' and "leaseOwner"=%s
  and "leaseExpiresAt" >= current_timestamp
returning "id"
'''

CANCEL_RUN_TASKS_SQL = '''
update "AgentTask"
set "status"='CANCELLED', "leaseOwner"=null, "leaseExpiresAt"=null, "updatedAt"=current_timestamp
where "runId"=%s and "status" not in ('COMPLETED','FAILED','CANCELLED')
returning "id"
'''


class TaskClaimIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        deadline = time.time() + 30
        last_error = None
        while time.time() < deadline:
            try:
                with psycopg.connect(DATABASE_URL) as connection:
                    connection.execute("select 1")
                break
            except Exception as error:  # pragma: no cover
                last_error = error
                time.sleep(0.5)
        else:
            raise RuntimeError(f"Postgres did not become ready: {last_error}")

    def setUp(self):
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute('drop table if exists "AgentInstance"')
            connection.execute('drop table if exists "AgentTask"')
            connection.execute('''
                create table "AgentTask" (
                  "id" text primary key,
                  "projectId" text not null,
                  "runId" text not null,
                  "status" text not null default 'QUEUED',
                  "runtimeRunId" text,
                  "attempt" integer not null default 0,
                  "maxAttempts" integer not null default 3,
                  "leaseOwner" text,
                  "leaseExpiresAt" timestamptz,
                  "heartbeatAt" timestamptz,
                  "updatedAt" timestamptz not null default current_timestamp
                )
            ''')
            connection.execute('''
                create table "AgentInstance" (
                  "id" text primary key,
                  "projectId" text not null,
                  "runId" text not null,
                  "status" text not null default 'IDLE',
                  "currentTaskId" text
                )
            ''')
            connection.execute(
                '''insert into "AgentTask" ("id","projectId","runId")
                   values ('task-1','project-1','run-1')'''
            )

    def claim(self, owner, seconds=90):
        with psycopg.connect(DATABASE_URL) as connection:
            return connection.execute(CLAIM_TASK_SQL, (owner, seconds, "task-1")).fetchone()

    def create_agent(self, agent_id, owner):
        with psycopg.connect(DATABASE_URL) as connection:
            return connection.execute(CREATE_AGENT_SQL, (agent_id, "task-1", owner)).fetchone()

    def expire_and_recover(self):
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute(
                '''update "AgentTask" set "leaseExpiresAt"=current_timestamp - interval '1 second'
                   where "id"='task-1' '''
            )
            recovered = connection.execute(
                '''update "AgentTask"
                   set "status"='QUEUED',"leaseOwner"=null,"leaseExpiresAt"=null,"heartbeatAt"=null
                   where "id"='task-1' and "status"='CLAIMED' and "leaseExpiresAt" < current_timestamp
                   returning "id"'''
            ).fetchone()
            if recovered:
                connection.execute(
                    '''update "AgentInstance" set "status"='STOPPED',"currentTaskId"=null
                       where "currentTaskId"='task-1' and "status"='IDLE' '''
                )
            return recovered

    def test_concurrent_dispatchers_have_exactly_one_claim_winner(self):
        barrier = threading.Barrier(2)

        def race(owner):
            barrier.wait(timeout=5)
            return self.claim(owner)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(race, ["worker-a", "worker-b"]))

        winners = [row for row in results if row is not None]
        self.assertEqual(len(winners), 1, results)
        self.assertIn(winners[0][1], {"worker-a", "worker-b"})

    def test_definitive_pre_runtime_failures_consume_bounded_attempts(self):
        for expected_attempt in (1, 2, 3):
            owner = f"worker-{expected_attempt}"
            self.assertIsNotNone(self.claim(owner))
            with psycopg.connect(DATABASE_URL) as connection:
                consumed = connection.execute(CONSUME_ATTEMPT_SQL, ("task-1", owner)).fetchone()
                outcome = connection.execute(FAIL_CONSUMED_ATTEMPT_SQL, ("task-1", owner)).fetchone()
            self.assertEqual(consumed, (expected_attempt, 3))
            expected_status = "FAILED" if expected_attempt == 3 else "QUEUED"
            self.assertEqual(outcome, (expected_status, expected_attempt, 3))

        self.assertIsNone(self.claim("worker-4"), "an exhausted task must never be dispatched again")

    def test_expired_claim_recovery_stops_pre_runtime_agent(self):
        self.assertIsNotNone(self.claim("worker-old"))
        self.assertEqual(self.create_agent("agent-old", "worker-old"), ("agent-old",))
        self.assertIsNotNone(self.expire_and_recover())
        with psycopg.connect(DATABASE_URL) as connection:
            agent = connection.execute(
                'select "status","currentTaskId" from "AgentInstance" where "id"=\'agent-old\''
            ).fetchone()
        self.assertEqual(agent, ("STOPPED", None))

    def test_stale_dispatcher_cannot_create_agent_after_new_owner_reclaims(self):
        self.assertIsNotNone(self.claim("worker-old"))
        self.assertIsNotNone(self.expire_and_recover())
        self.assertIsNotNone(self.claim("worker-new"))
        self.assertIsNone(self.create_agent("agent-old", "worker-old"))
        self.assertEqual(self.create_agent("agent-new", "worker-new"), ("agent-new",))

    def test_stale_dispatcher_cannot_mark_running_after_reclaim(self):
        self.assertIsNotNone(self.claim("worker-old"))
        self.assertEqual(self.create_agent("agent-old", "worker-old"), ("agent-old",))
        self.assertIsNotNone(self.expire_and_recover())
        self.assertIsNotNone(self.claim("worker-new"))
        self.assertEqual(self.create_agent("agent-new", "worker-new"), ("agent-new",))
        with psycopg.connect(DATABASE_URL) as connection:
            stale = connection.execute(MARK_RUNNING_SQL, ("runtime-1", "task-1", "worker-old")).fetchone()
            current = connection.execute(MARK_RUNNING_SQL, ("runtime-1", "task-1", "worker-new")).fetchone()
            state = connection.execute(
                'select "status","runtimeRunId","attempt" from "AgentTask" where "id"=\'task-1\''
            ).fetchone()
        self.assertIsNone(stale)
        self.assertEqual(current, ("task-1",))
        self.assertEqual(state, ("RUNNING", "runtime-1", 1))

    def test_stale_dispatcher_cannot_block_current_claim(self):
        self.assertIsNotNone(self.claim("worker-old"))
        self.assertIsNotNone(self.expire_and_recover())
        self.assertIsNotNone(self.claim("worker-new"))
        with psycopg.connect(DATABASE_URL) as connection:
            stale = connection.execute(FENCE_BLOCK_SQL, ("task-1", "worker-old")).fetchone()
            state = connection.execute(
                'select "status","leaseOwner" from "AgentTask" where "id"=\'task-1\''
            ).fetchone()
        self.assertIsNone(stale)
        self.assertEqual(state, ("CLAIMED", "worker-new"))

    def test_cancellation_fences_a_claim_before_it_can_be_marked_running(self):
        self.assertIsNotNone(self.claim("worker-a"))
        self.assertEqual(self.create_agent("agent-a", "worker-a"), ("agent-a",))
        with psycopg.connect(DATABASE_URL) as connection:
            cancelled = connection.execute(CANCEL_RUN_TASKS_SQL, ("run-1",)).fetchall()
            connection.execute(
                '''update "AgentInstance" set "status"='STOPPED',"currentTaskId"=null
                   where "runId"='run-1' and "status" not in ('COMPLETED','FAILED','STOPPED')'''
            )
            stale_mark = connection.execute(MARK_RUNNING_SQL, ("runtime-after-cancel", "task-1", "worker-a")).fetchone()
            task_state = connection.execute(
                'select "status","leaseOwner","runtimeRunId","attempt" from "AgentTask" where "id"=\'task-1\''
            ).fetchone()
            agent_state = connection.execute(
                'select "status","currentTaskId" from "AgentInstance" where "id"=\'agent-a\''
            ).fetchone()
        self.assertEqual(cancelled, [("task-1",)])
        self.assertIsNone(stale_mark)
        self.assertEqual(task_state, ("CANCELLED", None, None, 0))
        self.assertEqual(agent_state, ("STOPPED", None))
        self.assertIsNone(self.claim("worker-after-cancel"), "a cancelled task must never be reclaimed")

    def test_typescript_store_and_orchestrator_fence_retry_transitions(self):
        root = Path(__file__).resolve().parents[2] / "perplexity-clone/my-turborepo/apps/web/lib/agent-platform"
        store = (root / "store.ts").read_text(encoding="utf-8")
        orchestrator = (root / "orchestrator.ts").read_text(encoding="utf-8")
        compact_store = store.replace(" ", "")
        compact_orchestrator = orchestrator.replace(" ", "")
        self.assertIn("localTaskClaims", store)
        self.assertIn('and"leaseOwner"=${expectedOwner}', compact_store)
        self.assertIn('and"leaseExpiresAt">=current_timestamp', compact_store)
        self.assertIn('and"leaseOwner"=${claimedOwner}', compact_store)
        self.assertIn("TaskClaimLostError", store)
        self.assertIn("currentTaskId\"=null", store)
        self.assertIn("consumeClaimedDispatchAttempt", orchestrator)
        self.assertIn('and"leaseOwner"=${task.leaseOwner}', compact_orchestrator)
        self.assertIn('and"leaseExpiresAt">=current_timestamp', compact_orchestrator)
        self.assertIn("runtimeAttemptRequestId", orchestrator)
        self.assertIn("runtime_outcome_unknown", orchestrator)
        self.assertIn("run_cancelled_before_runtime_submission", orchestrator)
        self.assertIn("run_cancelled_after_runtime_submission", orchestrator)
        self.assertIn("run_cancelled_during_dispatch", orchestrator)


if __name__ == "__main__":
    unittest.main()
