import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("remote acceptance checkpoints are run-owned and never resubmit provider work", () => {
	const source = readWeb("lib/agents/run-checkpoints.ts");

	assert.ok(source.includes('REMOTE_ACCEPTED_EVENT = "CHECKPOINT_REMOTE_ACCEPTED"'));
	assert.ok(source.includes('eventKey: "checkpoint:remote-accepted"'));
	assert.ok(source.includes("recoverRemoteExecutionIdFromCheckpoint"));
	assert.ok(source.includes("run: { userId: options.userId, provider: options.provider }"));
	assert.ok(source.includes("remoteExecutionId: null"));
	assert.ok(source.includes("CHECKPOINT_RECOVERED"));
	assert.ok(!source.includes("executeAutoGptGraph"));
	assert.ok(!source.includes("createDeerFlowRun"));
});

test("checkpoint provider handles remain server-only in lifecycle history", () => {
	const events = readWeb("lib/agents/run-events.ts");
	assert.ok(events.includes('event.type === "CHECKPOINT_REMOTE_ACCEPTED"'));
	assert.ok(events.includes("return null"));
	assert.ok(events.includes("metadata: publicEventMetadata(event)"));
});

test("AutoGPT saves a checkpoint before mutable remote-id persistence and recovers it on refresh", () => {
	const source = readWeb("lib/autogpt/runs.ts");
	const checkpoint = source.indexOf("await recordRemoteAcceptedCheckpoint({");
	const persist = source.indexOf("const persistRemoteId = () =>");

	assert.ok(checkpoint >= 0);
	assert.ok(persist > checkpoint);
	assert.ok(source.includes("row.remoteExecutionId ??"));
	assert.ok(source.includes("await recoverRemoteExecutionIdFromCheckpoint({"));
	assert.ok(source.includes('provider: "AUTOGPT"'));
	assert.ok(source.includes("getAutoGptExecution(config, row.graphId, remoteExecutionId)"));
	assert.ok(!source.includes("getAutoGptExecution(config, row.graphId, row.remoteExecutionId)"));
	assert.equal(source.match(/executeAutoGptGraph\(/g)?.length, 1);
});

test("DeerFlow separates confirmed remote acceptance from local persistence and recovers on refresh or cancel", () => {
	const source = readWeb("lib/deerflow/runs.ts");
	const remoteCreation = source.indexOf("remoteRun = await createDeerFlowRun(");
	const checkpoint = source.indexOf("await recordRemoteAcceptedCheckpoint({");
	const persist = source.indexOf("const persistRemoteId = () =>");

	assert.ok(remoteCreation >= 0);
	assert.ok(checkpoint > remoteCreation);
	assert.ok(persist > checkpoint);
	assert.equal(source.match(/createDeerFlowRun\(/g)?.length, 1);
	assert.ok(source.includes("A local persistence retry is idempotent"));
	assert.ok(source.match(/await recoverRemoteExecutionIdFromCheckpoint\(\{/g)?.length === 2);
	assert.ok(source.includes("refreshDeerFlowAgentRun"));
	assert.ok(source.includes("cancelDeerFlowAgentRun"));
});
