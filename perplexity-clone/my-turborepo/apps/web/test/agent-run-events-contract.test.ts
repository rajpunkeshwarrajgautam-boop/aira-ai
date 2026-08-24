import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../../../..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

function readRepo(relative: string): string {
	return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

test("agent lifecycle events are immutable run-owned records with bounded indexes", () => {
	const schema = readRepo("prisma/schema.prisma");
	assert.ok(schema.includes("model AgentRunEvent"));
	assert.ok(schema.includes("events            AgentRunEvent[]"));
	assert.ok(schema.includes("@@unique([runId, eventKey])"));
	assert.ok(schema.includes("@@index([runId, createdAt])"));
	assert.ok(schema.includes("@relation(fields: [runId], references: [id], onDelete: Cascade)"));
});

test("agent lifecycle migration remains closed to the Supabase Data API", () => {
	const migration = readRepo("prisma/migrations/20260824_add_agent_run_events/migration.sql");
	assert.ok(migration.includes('alter table "AgentRunEvent" enable row level security'));
	assert.ok(migration.includes('create policy "deny_direct_data_api_access"'));
	assert.ok(migration.includes("to anon, authenticated"));
	assert.ok(migration.includes("using (false)"));
	assert.ok(migration.includes("with check (false)"));
	assert.ok(migration.includes("from anon, authenticated, service_role"));
	assert.ok(migration.includes('on delete cascade on update cascade'));
	assert.ok(migration.includes("notify pgrst, 'reload schema'"));
});

test("run event persistence is idempotent and ownership is inherited through AgentRun", () => {
	const source = readWeb("lib/agents/run-events.ts");
	assert.ok(source.includes("prisma.agentRunEvent.upsert"));
	assert.ok(source.includes("runId_eventKey"));
	assert.ok(source.includes("run: { userId }"));
	assert.ok(source.includes("Math.min(100, Math.max(1, limit))"));
	assert.ok(source.includes("recordAgentRunEventBestEffort"));
	assert.ok(source.includes("must never turn a successfully accepted autonomous task"));
});

test("agent request routes publish only real lifecycle facts", () => {
	const submit = readWeb("app/api/agents/runs/route.ts");
	const detail = readWeb("app/api/agents/runs/[runId]/route.ts");
	const cancel = readWeb("app/api/agents/runs/[runId]/cancel/route.ts");
	assert.ok(submit.includes('eventKey: "submitted"'));
	assert.ok(submit.includes('type: "SUBMITTED"'));
	assert.ok(detail.includes("if (run.status !== cached.status)"));
	assert.ok(detail.includes('type: "STATUS_CHANGED"'));
	assert.ok(detail.includes('type: "SYNC_WARNING"'));
	assert.ok(cancel.includes('eventKey: "cancel-requested"'));
	assert.ok(cancel.includes('type: "CANCEL_REQUESTED"'));
});

test("run lifecycle endpoint authenticates and checks run ownership before listing events", () => {
	const source = readWeb("app/api/agents/runs/[runId]/events/route.ts");
	assert.ok(source.includes("await auth()"));
	assert.ok(source.includes("UNAUTHENTICATED"));
	assert.ok(source.includes("status: 401"));
	assert.ok(source.includes("getAgentRun(session.user.id, runId)"));
	assert.ok(source.includes("listAgentRunEvents(session.user.id, run.id, limit)"));
	assert.ok(source.includes("Cache-Control"));
	assert.ok(source.includes("no-store"));
});

test("run center renders persisted lifecycle activity and does not synthesize legacy history", () => {
	const page = readWeb("app/runs/page.tsx");
	assert.ok(page.includes("/events?limit=60"));
	assert.ok(page.includes("Lifecycle activity"));
	assert.ok(page.includes("AIRA does not synthesize history that was never persisted"));
	assert.ok(page.includes("Generated files"));
	assert.ok(page.includes("artifactHref(selectedRun.id, path)"));
	assert.ok(page.includes('type="button"'));
});
