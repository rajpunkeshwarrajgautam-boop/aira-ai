import os
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import psycopg

DATABASE_URL = os.environ.get("AIRA_SCHEDULER_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/postgres")


class ManagedMissionQuotaIntegrationTests(unittest.TestCase):
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
            connection.execute('drop table if exists "AgentManagedMissionQuotaReservation"')
            connection.execute('drop table if exists "UsageRecord"')
            connection.execute('''
                create table "UsageRecord" (
                  "userId" text not null,
                  "periodStart" timestamptz not null,
                  "agentRuns" integer not null default 0,
                  primary key ("userId", "periodStart")
                )
            ''')
            connection.execute('''
                create table "AgentManagedMissionQuotaReservation" (
                  "id" text primary key,
                  "userId" text not null,
                  "clientRequestId" text not null,
                  "periodStart" timestamptz not null,
                  "createdAt" timestamptz not null default current_timestamp,
                  unique ("userId", "clientRequestId")
                )
            ''')

    def reserve(self, user_id, request_id, limit=100):
        period_start = datetime(2026, 8, 1, tzinfo=timezone.utc)
        reservation_id = f"reservation:{threading.get_ident()}:{time.time_ns()}"
        with psycopg.connect(DATABASE_URL) as connection:
            with connection.transaction():
                inserted = connection.execute(
                    '''insert into "AgentManagedMissionQuotaReservation"
                       ("id","userId","clientRequestId","periodStart")
                       values (%s,%s,%s,%s)
                       on conflict ("userId","clientRequestId") do nothing
                       returning "id"''',
                    (reservation_id, user_id, request_id, period_start),
                ).fetchone()
                if not inserted:
                    usage = connection.execute(
                        'select "agentRuns" from "UsageRecord" where "userId"=%s and "periodStart"=%s',
                        (user_id, period_start),
                    ).fetchone()
                    return False, usage[0] if usage else 0

                row = connection.execute(
                    '''insert into "UsageRecord" ("userId","periodStart","agentRuns")
                       values (%s,%s,1)
                       on conflict ("userId","periodStart") do update
                         set "agentRuns"="UsageRecord"."agentRuns"+1
                       returning "agentRuns"''',
                    (user_id, period_start),
                ).fetchone()
                if row[0] > limit:
                    raise RuntimeError("AGENT_QUOTA_EXCEEDED")
                return True, row[0]

    def refund(self, user_id, request_id):
        with psycopg.connect(DATABASE_URL) as connection:
            with connection.transaction():
                released = connection.execute(
                    '''delete from "AgentManagedMissionQuotaReservation"
                       where "userId"=%s and "clientRequestId"=%s
                       returning "periodStart"''',
                    (user_id, request_id),
                ).fetchone()
                if not released:
                    return False
                connection.execute(
                    '''update "UsageRecord"
                       set "agentRuns"=greatest(0,"agentRuns"-1)
                       where "userId"=%s and "periodStart"=%s''',
                    (user_id, released[0]),
                )
                return True

    def usage(self, user_id="user-1"):
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                'select coalesce(sum("agentRuns"),0) from "UsageRecord" where "userId"=%s',
                (user_id,),
            ).fetchone()
            reservations = connection.execute(
                'select count(*) from "AgentManagedMissionQuotaReservation" where "userId"=%s',
                (user_id,),
            ).fetchone()
        return row[0], reservations[0]

    def test_parallel_same_request_reserves_exactly_one_quota_unit(self):
        workers = 8
        barrier = threading.Barrier(workers)

        def reserve_once(_):
            barrier.wait(timeout=5)
            return self.reserve("user-1", "same-client-request-id")

        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(reserve_once, range(workers)))

        inserted = sum(1 for created, _ in results if created)
        self.assertEqual(inserted, 1, results)
        self.assertEqual(self.usage(), (1, 1))

    def test_distinct_request_over_limit_rolls_back_reservation_and_usage(self):
        self.assertEqual(self.reserve("user-1", "request-one", limit=1), (True, 1))
        with self.assertRaisesRegex(RuntimeError, "AGENT_QUOTA_EXCEEDED"):
            self.reserve("user-1", "request-two", limit=1)
        self.assertEqual(self.usage(), (1, 1))

    def test_refund_is_exact_request_scoped_and_idempotent(self):
        self.reserve("user-1", "request-refund")
        self.assertTrue(self.refund("user-1", "request-refund"))
        self.assertFalse(self.refund("user-1", "request-refund"))
        self.assertEqual(self.usage(), (0, 0))

    def test_orchestrator_uses_managed_quota_and_preserves_concurrent_winner(self):
        orchestrator = Path(__file__).resolve().parents[2] / "perplexity-clone/my-turborepo/apps/web/lib/agent-platform/orchestrator.ts"
        source = orchestrator.read_text(encoding="utf-8")
        self.assertIn("consumeManagedMissionQuota(input.userId, input.clientRequestId)", source)
        self.assertNotIn("consumeAgentRunQuota(input.userId)", source)
        start = source.index("export async function startManagedRun")
        concurrent = source.index("const concurrent = await getRunByClientRequestId", start)
        reuse = source.index("if (concurrent) return tickManagedRun", concurrent)
        refund = source.index("refundManagedMissionQuota(input.userId, input.clientRequestId)", concurrent)
        self.assertLess(concurrent, reuse)
        self.assertLess(reuse, refund)


if __name__ == "__main__":
    unittest.main()
