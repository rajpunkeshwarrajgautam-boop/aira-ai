import os
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import psycopg

DATABASE_URL = os.environ.get("AIRA_SCHEDULER_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/postgres")
APPROVAL_TTL_MINUTES = 30


class ApprovalIntegrationTests(unittest.TestCase):
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
            connection.execute('drop table if exists "AgentApproval"')
            connection.execute('''
                create table "AgentApproval" (
                  "id" text primary key,
                  "userId" text not null,
                  "status" text not null default 'PENDING',
                  "context" jsonb not null default '{}'::jsonb,
                  "createdAt" timestamptz not null default current_timestamp,
                  "resolvedAt" timestamptz
                )
            ''')
            connection.execute('''
                create table "AgentToolCall" (
                  "id" text primary key,
                  "userId" text not null,
                  "approvalId" text references "AgentApproval"("id"),
                  "inputHash" text not null,
                  "status" text not null default 'APPROVAL_REQUIRED',
                  "errorCode" text,
                  "completedAt" timestamptz
                )
            ''')

    def insert_approval(self, approval_id="approval-1", user_id="user-1", status="PENDING", age_minutes=0, input_hash="hash-a"):
        created_at = datetime.now(timezone.utc) - timedelta(minutes=age_minutes)
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute(
                '''insert into "AgentApproval" ("id","userId","status","context","createdAt")
                   values (%s,%s,%s,jsonb_build_object('inputHash',%s),%s)''',
                (approval_id, user_id, status, input_hash, created_at),
            )
            connection.execute(
                '''insert into "AgentToolCall" ("id","userId","approvalId","inputHash")
                   values (%s,%s,%s,%s)''',
                (f"tool-{approval_id}", user_id, approval_id, input_hash),
            )

    def resolve(self, approval_id, user_id, approve):
        with psycopg.connect(DATABASE_URL) as connection:
            with connection.transaction():
                connection.execute(
                    '''update "AgentApproval"
                       set "status"='EXPIRED', "resolvedAt"=coalesce("resolvedAt",current_timestamp)
                       where "id"=%s and "userId"=%s and "status"='PENDING'
                         and "createdAt" < current_timestamp - (%s * interval '1 minute')''',
                    (approval_id, user_id, APPROVAL_TTL_MINUTES),
                )
                linked = connection.execute(
                    '''select c."id"
                       from "AgentToolCall" c join "AgentApproval" a on a."id"=c."approvalId"
                       where a."id"=%s and a."userId"=%s and c."userId"=%s
                         and a."status"='PENDING'
                         and a."createdAt" >= current_timestamp - (%s * interval '1 minute')
                       for update of a,c''',
                    (approval_id, user_id, user_id, APPROVAL_TTL_MINUTES),
                ).fetchone()
                if not linked:
                    return None
                decision = "APPROVED" if approve else "REJECTED"
                updated = connection.execute(
                    '''update "AgentApproval" set "status"=%s,"resolvedAt"=current_timestamp
                       where "id"=%s and "userId"=%s and "status"='PENDING'
                       returning "status"''',
                    (decision, approval_id, user_id),
                ).fetchone()
                if not updated:
                    return None
                if not approve:
                    connection.execute(
                        '''update "AgentToolCall" set "status"='DENIED',"errorCode"='USER_REJECTED',"completedAt"=current_timestamp
                           where "id"=%s and "userId"=%s and "status"='APPROVAL_REQUIRED' ''',
                        (linked[0], user_id),
                    )
                return decision

    def approval_valid(self, approval_id, user_id, input_hash):
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                '''select exists(
                     select 1 from "AgentApproval" a
                     join "AgentToolCall" c on c."approvalId"=a."id"
                     where a."id"=%s and a."userId"=%s and c."userId"=%s
                       and c."inputHash"=%s and a."context"->>'inputHash'=%s
                       and a."status"='APPROVED'
                       and a."createdAt" >= current_timestamp - (%s * interval '1 minute')
                   )''',
                (approval_id, user_id, user_id, input_hash, input_hash, APPROVAL_TTL_MINUTES),
            ).fetchone()
            return bool(row[0])

    def status(self, approval_id="approval-1"):
        with psycopg.connect(DATABASE_URL) as connection:
            return connection.execute('select "status" from "AgentApproval" where "id"=%s', (approval_id,)).fetchone()[0]

    def test_parallel_approve_resolves_exactly_once(self):
        self.insert_approval()
        workers = 8
        barrier = threading.Barrier(workers)

        def approve_once(_):
            barrier.wait(timeout=5)
            return self.resolve("approval-1", "user-1", True)

        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(approve_once, range(workers)))
        self.assertEqual(results.count("APPROVED"), 1, results)
        self.assertEqual(self.status(), "APPROVED")

    def test_parallel_approve_reject_has_one_winner(self):
        self.insert_approval()
        barrier = threading.Barrier(2)

        def decide(approve):
            barrier.wait(timeout=5)
            return self.resolve("approval-1", "user-1", approve)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(decide, [True, False]))
        winners = [value for value in results if value is not None]
        self.assertEqual(len(winners), 1, results)
        self.assertEqual(self.status(), winners[0])

    def test_rejected_approval_cannot_be_approved_later(self):
        self.insert_approval()
        self.assertEqual(self.resolve("approval-1", "user-1", False), "REJECTED")
        self.assertIsNone(self.resolve("approval-1", "user-1", True))
        self.assertEqual(self.status(), "REJECTED")

    def test_wrong_user_cannot_resolve_approval(self):
        self.insert_approval()
        self.assertIsNone(self.resolve("approval-1", "user-2", True))
        self.assertEqual(self.status(), "PENDING")

    def test_stale_pending_approval_expires_instead_of_resolving(self):
        self.insert_approval(age_minutes=APPROVAL_TTL_MINUTES + 5)
        self.assertIsNone(self.resolve("approval-1", "user-1", True))
        self.assertEqual(self.status(), "EXPIRED")

    def test_approved_authorization_requires_exact_hash_and_fresh_age(self):
        self.insert_approval(status="APPROVED", input_hash="hash-a")
        self.assertTrue(self.approval_valid("approval-1", "user-1", "hash-a"))
        self.assertFalse(self.approval_valid("approval-1", "user-1", "hash-b"))

        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute(
                'update "AgentApproval" set "createdAt"=current_timestamp - interval \'2 hours\' where "id"=%s',
                ("approval-1",),
            )
        self.assertFalse(self.approval_valid("approval-1", "user-1", "hash-a"))


if __name__ == "__main__":
    unittest.main()
