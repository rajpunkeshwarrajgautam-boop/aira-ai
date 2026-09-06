import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("durable run steps reuse the immutable run-owned event ledger", () => {
	const source = readWeb("lib/agents/run-steps.ts");

	assert.ok(source.includes('type: "RUN_STEP"'));
	assert.ok(source.includes('eventKey: `step:${stepKey}:${attempt}:${options.status}`'));
	assert.ok(source.includes('run: { userId }'));
	assert.ok(source.includes("const steps = new Map<string, AgentRunStepDto>()"));
	assert.ok(!source.includes("executeAutoGptGraph"));
	assert.ok(!source.includes("createDeerFlowRun"));
});

test("run status mapping does not misrepresent provider review as human approval", () => {
	const source = readWeb("lib/agents/run-steps.ts");
	const reviewCase = source.match(/case "REVIEW":\s*return "([A-Z_]+)"/);

	assert.equal(reviewCase?.[1], "WAITING_FOR_REVIEW");
	assert.ok(source.includes('"WAITING_FOR_APPROVAL"'));
});

test("step API authenticates and scopes reads through run ownership", () => {
	const source = readWeb("app/api/agents/runs/[runId]/steps/route.ts");

	assert.ok(source.includes("const session = await auth()"));
	assert.ok(source.includes('code: "UNAUTHENTICATED"'));
	assert.ok(source.includes("getAgentRun(session.user.id, runId)"));
	assert.ok(source.includes("listAgentRunSteps(session.user.id, runId, limit)"));
	assert.ok(source.includes('"Cache-Control": "no-store"'));
});

test("submission and reconciliation record only AIRA-observable provider boundaries", () => {
	const submit = readWeb("app/api/agents/runs/route.ts");
	const refresh = readWeb("app/api/agents/runs/[runId]/route.ts");

	assert.ok(submit.includes('stepKey: "provider-submission"'));
	assert.ok(submit.includes('type: "PROVIDER_SUBMISSION"'));
	assert.ok(submit.includes('stepKey: "provider-execution"'));
	assert.ok(submit.includes("agentRunStatusToStepStatus(submitted.run.status)"));
	assert.ok(refresh.includes('stepKey: "provider-execution"'));
	assert.ok(refresh.includes("agentRunStatusToStepStatus(run.status)"));
	assert.ok(!submit.includes("chainOfThought"));
	assert.ok(!refresh.includes("chainOfThought"));
});

test("runtime cancellation is capability-gated and records truthful durable steps", () => {
	const source = readWeb("app/api/agents/runs/[runId]/cancel/route.ts");

	assert.ok(source.includes('stepKey: "provider-cancellation"'));
	assert.ok(source.includes('type: "PROVIDER_CANCELLATION"'));
	assert.ok(source.includes('status: "RUNNING"'));
	assert.ok(source.includes('status: "FAILED"'));
	assert.ok(source.includes("getAgentRuntime(cached.provider)"));
	assert.ok(source.includes("!selectedRuntime.capabilities.cancel || !selectedRuntime.cancelRun"));
	assert.ok(source.includes("selectedRuntime.cancelRun(session.user.id, runId)"));
	assert.ok(source.includes("runtimeLabel(cached.provider)"));
	assert.ok(source.includes('code: "CANCEL_NOT_SUPPORTED"'));
});
