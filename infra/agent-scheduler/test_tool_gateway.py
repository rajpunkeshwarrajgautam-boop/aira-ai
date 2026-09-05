import os
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

import psycopg
from psycopg.errors import UniqueViolation

DATABASE_URL = os.environ.get("AIRA_SCHEDULER_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/postgres")


class ToolGatewayDatabaseTests(unittest.TestCase):
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
            connection.execute('drop table if exists "AgentToolCall"')
            connection.execute('drop table if exists "AgentPlatformRun"')
            connection.execute('''
                create table "AgentPlatformRun" (
                  "id" text primary key,
                  "status" text not null,
                  "budgets" jsonb not null,
                  "toolCallsUsed" integer not null default 0,
                  "updatedAt" timestamptz not null default current_timestamp
                )
            ''')
            connection.execute('''
                create table "AgentToolCall" (
                  "id" text primary key,
                  "clientRequestId" text not null,
                  "userId" text not null,
                  "runId" text not null,
                  "tool" text not null,
                  "action" text not null,
                  "inputHash" text not null,
                  "status" text not null default 'PENDING',
                  unique ("userId","clientRequestId")
                )
            ''')
            connection.execute(
                '''insert into "AgentPlatformRun" ("id","status","budgets")
                   values ('run-1','RUNNING','{"maxToolCalls":3}'::jsonb)'''
            )

    def create_call(self, row_id):
        try:
            with psycopg.connect(DATABASE_URL) as connection:
                connection.execute(
                    '''insert into "AgentToolCall"
                       ("id","clientRequestId","userId","runId","tool","action","inputHash")
                       values (%s,'request-1','user-1','run-1','files','write','hash-a')''',
                    (row_id,),
                )
            return True
        except UniqueViolation:
            return False

    def claim(self):
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                '''update "AgentToolCall" set "status"='EXECUTING'
                   where "userId"='user-1' and "clientRequestId"='request-1' and "inputHash"='hash-a'
                     and "status"='PENDING'
                   returning "id"'''
            ).fetchone()
            return bool(row)

    def reserve_budget(self):
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                '''update "AgentPlatformRun"
                   set "toolCallsUsed"="toolCallsUsed"+1,"updatedAt"=current_timestamp
                   where "id"='run-1'
                     and "status" not in ('COMPLETED','FAILED','CANCELLED')
                     and "toolCallsUsed" < coalesce(("budgets"->>'maxToolCalls')::integer,0)
                   returning "toolCallsUsed"'''
            ).fetchone()
            return row[0] if row else None

    def test_parallel_same_request_creates_one_immutable_record(self):
        workers = 8
        barrier = threading.Barrier(workers)

        def create(index):
            barrier.wait(timeout=5)
            return self.create_call(f"call-{index}")

        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(create, range(workers)))
        self.assertEqual(results.count(True), 1, results)
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                '''select count(*),min("inputHash"),min("tool"),min("action")
                   from "AgentToolCall" where "userId"='user-1' and "clientRequestId"='request-1' '''
            ).fetchone()
        self.assertEqual(row, (1, "hash-a", "files", "write"))

    def test_parallel_execution_claim_has_one_winner(self):
        self.create_call("call-1")
        workers = 8
        barrier = threading.Barrier(workers)

        def claim_once(_):
            barrier.wait(timeout=5)
            return self.claim()

        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(claim_once, range(workers)))
        self.assertEqual(results.count(True), 1, results)

    def test_parallel_budget_reservations_never_exceed_limit(self):
        workers = 10
        barrier = threading.Barrier(workers)

        def reserve_once(_):
            barrier.wait(timeout=5)
            return self.reserve_budget()

        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(reserve_once, range(workers)))
        successes = [value for value in results if value is not None]
        self.assertEqual(len(successes), 3, results)
        with psycopg.connect(DATABASE_URL) as connection:
            used = connection.execute('select "toolCallsUsed" from "AgentPlatformRun" where "id"=\'run-1\'').fetchone()[0]
        self.assertEqual(used, 3)

    def test_cancelled_run_cannot_reserve_new_tool_budget(self):
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute('update "AgentPlatformRun" set "status"=\'CANCELLED\' where "id"=\'run-1\'')
        self.assertIsNone(self.reserve_budget())
        with psycopg.connect(DATABASE_URL) as connection:
            used = connection.execute('select "toolCallsUsed" from "AgentPlatformRun" where "id"=\'run-1\'').fetchone()[0]
        self.assertEqual(used, 0)


if __name__ == "__main__":
    unittest.main()
