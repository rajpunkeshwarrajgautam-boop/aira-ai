import os
import time
import unittest
from pathlib import Path

import psycopg

DATABASE_URL = os.environ.get("AIRA_SCHEDULER_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/postgres")

AUTH_SQL = '''
select exists(
  select 1
  from "AgentPlatformRun" r
  join "AgentProject" p on p."id"=r."projectId"
  join "AgentTask" t on t."id"=%s and t."runId"=r."id" and t."projectId"=p."id"
  join "AgentInstance" a on a."id"=%s
    and a."runId"=r."id" and a."projectId"=p."id" and a."currentTaskId"=t."id"
  where r."id"=%s
    and r."projectId"=%s
    and r."userId"=%s
    and p."userId"=%s
    and r."status" in ('RUNNING','WAITING','APPROVAL_REQUIRED')
    and t."status" in ('CLAIMED','RUNNING','WAITING','APPROVAL_REQUIRED')
    and a."status" in ('WORKING','WAITING','PAUSED')
    and a."allowedTools" @> %s::jsonb
) as ok
'''


class ToolAuthorizationDatabaseTests(unittest.TestCase):
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
            connection.execute('drop table if exists "AgentPlatformRun"')
            connection.execute('drop table if exists "AgentProject"')
            connection.execute('''create table "AgentProject" (
              "id" text primary key, "userId" text not null
            )''')
            connection.execute('''create table "AgentPlatformRun" (
              "id" text primary key, "projectId" text not null, "userId" text not null, "status" text not null
            )''')
            connection.execute('''create table "AgentTask" (
              "id" text primary key, "projectId" text not null, "runId" text not null, "status" text not null
            )''')
            connection.execute('''create table "AgentInstance" (
              "id" text primary key, "projectId" text not null, "runId" text not null,
              "currentTaskId" text, "status" text not null, "allowedTools" jsonb not null
            )''')
            connection.execute('''insert into "AgentProject" values
              ('project-a','user-a'),('project-b','user-a'),('project-c','user-b')''')
            connection.execute('''insert into "AgentPlatformRun" values
              ('run-a','project-a','user-a','RUNNING'),
              ('run-b','project-b','user-a','RUNNING'),
              ('run-c','project-c','user-b','RUNNING')''')
            connection.execute('''insert into "AgentTask" values
              ('task-a','project-a','run-a','RUNNING'),
              ('task-a2','project-a','run-a','RUNNING'),
              ('task-b','project-b','run-b','RUNNING'),
              ('task-c','project-c','run-c','RUNNING')''')
            connection.execute('''insert into "AgentInstance" values
              ('agent-a','project-a','run-a','task-a','WORKING','["files","git"]'::jsonb),
              ('agent-a2','project-a','run-a','task-a2','WORKING','["web"]'::jsonb),
              ('agent-b','project-b','run-b','task-b','WORKING','["files"]'::jsonb),
              ('agent-c','project-c','run-c','task-c','WORKING','["files"]'::jsonb)''')

    def allowed(self, *, user='user-a', project='project-a', run='run-a', task='task-a', agent='agent-a', tool='files'):
        import json
        with psycopg.connect(DATABASE_URL) as connection:
            return bool(connection.execute(AUTH_SQL, (task, agent, run, project, user, user, json.dumps([tool]))).fetchone()[0])

    def test_exact_active_agent_task_tool_binding_is_allowed(self):
        self.assertTrue(self.allowed())
        self.assertTrue(self.allowed(tool='git'))
        self.assertTrue(self.allowed(project='project-b', run='run-b', task='task-b', agent='agent-b'))

    def test_cross_user_project_run_task_and_agent_contexts_are_denied(self):
        self.assertFalse(self.allowed(user='user-b'))
        self.assertFalse(self.allowed(project='project-b'))
        self.assertFalse(self.allowed(run='run-b'))
        self.assertFalse(self.allowed(task='task-b'))
        self.assertFalse(self.allowed(agent='agent-b'))

    def test_same_user_wrong_project_and_same_run_wrong_task_are_denied(self):
        self.assertFalse(self.allowed(project='project-b', run='run-a', task='task-a', agent='agent-a'))
        self.assertFalse(self.allowed(project='project-a', run='run-b', task='task-b', agent='agent-b'))
        self.assertFalse(self.allowed(task='task-a2'))
        self.assertFalse(self.allowed(agent='agent-a2'))
        self.assertFalse(self.allowed(task='task-a2', agent='agent-a'))

    def test_agent_cannot_request_tool_outside_allowed_tools(self):
        self.assertFalse(self.allowed(tool='browser'))
        self.assertFalse(self.allowed(agent='agent-a2', task='task-a2', tool='files'))
        self.assertTrue(self.allowed(agent='agent-a2', task='task-a2', tool='web'))

    def test_inactive_run_task_or_agent_fails_closed(self):
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute('update "AgentPlatformRun" set "status"=\'CANCELLED\' where "id"=\'run-a\'')
        self.assertFalse(self.allowed())
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute('update "AgentPlatformRun" set "status"=\'RUNNING\', "userId"=\'user-a\' where "id"=\'run-a\'')
            connection.execute('update "AgentTask" set "status"=\'COMPLETED\' where "id"=\'task-a\'')
        self.assertFalse(self.allowed())
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute('update "AgentTask" set "status"=\'RUNNING\' where "id"=\'task-a\'')
            connection.execute('update "AgentInstance" set "status"=\'STOPPED\' where "id"=\'agent-a\'')
        self.assertFalse(self.allowed())

    def test_typescript_generic_agent_gateway_requires_bound_agent_task_and_allowed_tool(self):
        route = Path(__file__).resolve().parents[2] / "perplexity-clone/my-turborepo/apps/web/app/api/internal/tool-gateway/execute/route.ts"
        source = route.read_text(encoding="utf-8")
        self.assertIn('taskId: z.string().min(8).max(160),', source)
        self.assertIn('agentId: z.string().min(8).max(160),', source)
        self.assertIn('a."currentTaskId"=t."id"', source)
        self.assertIn('a."allowedTools" @>', source)
        self.assertIn('AGENT_TOOL_CONTEXT_FORBIDDEN', source)


if __name__ == "__main__":
    unittest.main()
