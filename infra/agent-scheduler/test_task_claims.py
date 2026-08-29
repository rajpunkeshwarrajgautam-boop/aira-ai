import os
import time
import unittest
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

FENCE_BLOCK_SQL = '''
update "AgentTask"
set "status"='BLOCKED', "leaseOwner"=null, "leaseExpiresAt"=null, "updatedAt"=current_timestamp
where "id"=%s and "status"='CLAIMED' and "leaseOwner"=%s
  and "leaseExpiresAt" >= current_timestamp
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

    def test_typescript_store_fences_pre_runtime_transitions_by_exact_claim_owner(self):
        store = Path(__file__).resolve().parents[2] / "perplexity-clone/my-turborepo/apps/web/lib/agent-platform/store.ts"
        source = store.read_text(encoding="utf-8")
        compact = source.replace(" ", "")
        self.assertIn("localTaskClaims", source)
        self.assertIn('and"leaseOwner"=${expectedOwner}', compact)
        self.assertIn('and"leaseExpiresAt">=current_timestamp', compact)
        self.assertIn('and"leaseOwner"=${claimedOwner}', compact)
        self.assertIn("TaskClaimLostError", source)
        self.assertIn("currentTaskId\"=null", source)


if __name__ == "__main__":
    unittest.main()
