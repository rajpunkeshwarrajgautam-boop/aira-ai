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

test("managed runs have normalized durable tasks, messages and artifact metadata", () => {
	const schema = readRepo("prisma/schema.prisma");
	for (const model of ["AgentRunTask", "AgentRunMessage", "AgentRunArtifact"]) {
		assert.ok(schema.includes(`model ${model}`));
	}
	assert.ok(schema.includes("tasks             AgentRunTask[]"));
	assert.ok(schema.includes("messages          AgentRunMessage[]"));
	assert.ok(schema.includes("artifacts         AgentRunArtifact[]"));
	assert.ok(schema.includes("@@unique([runId, taskKey])"));
	assert.ok(schema.includes("dependencies       String[]"));
	assert.ok(schema.includes("requiredCapabilities String[]"));
});

test("managed-run persistence migration is additive and closed to the Supabase Data API", () => {
	const migration = readRepo("prisma/migrations/20260829_add_managed_agent_runtime/migration.sql");
	for (const table of ["AgentRunTask", "AgentRunMessage", "AgentRunArtifact"]) {
		assert.ok(migration.includes(`create table "${table}"`));
		assert.ok(migration.includes(`alter table "${table}" enable row level security`));
	}
	assert.ok(migration.match(/create policy "deny_direct_data_api_access"/g)?.length === 3);
	assert.ok(migration.includes("to anon, authenticated"));
	assert.ok(migration.includes("using (false)"));
	assert.ok(migration.includes("with check (false)"));
	assert.ok(migration.includes('references "AgentRun"("id")'));
	assert.ok(migration.includes("on delete cascade on update cascade"));
	assert.ok(migration.includes("notify pgrst, 'reload schema'"));
});

test("managed task persistence remains run-owned and idempotent", () => {
	const source = readWeb("lib/agent-runtime/run-persistence.ts");
	assert.ok(source.includes("prisma.agentRunTask.upsert"));
	assert.ok(source.includes("runId_taskKey"));
	assert.ok(source.includes("run: { userId }"));
	assert.ok(source.includes("persistExecutionPlan"));
	assert.ok(source.includes("persistRuntimeTaskResult"));
	assert.ok(source.includes("recordAgentRunMessage"));
	assert.ok(source.includes("recordAgentRunArtifact"));
	assert.ok(source.includes("MAX_MESSAGE_CHARS"));
	assert.ok(source.includes("MAX_STORAGE_REF_CHARS"));
});

test("planner emits execution metadata needed by production orchestration", () => {
	const planner = readWeb("lib/agent-runtime/planner.ts");
	const types = readWeb("lib/agent-runtime/types.ts");
	for (const field of [
		"requiredCapabilities",
		"expectedOutput",
		"acceptanceCriteria",
		"riskClass",
		"preferredModelClass",
		"maxAttempts",
	]) {
		assert.ok(planner.includes(field));
		assert.ok(types.includes(field));
	}
	assert.ok(planner.includes('"safe", "caution", "consequential"'));
	assert.ok(planner.includes('"fast", "reasoning", "coding", "vision", "long_context", "local_private"'));
});
