import assert from "node:assert/strict";
import test from "node:test";

import {
	agentMemoryPrincipalId,
	containsProhibitedMemoryData,
} from "../lib/cognitive/agentmemory";
import { routeCognitiveCapabilities } from "../lib/cognitive/policy";

test("cognitive router keeps simple factual questions on the fast path", () => {
	const routed = routeCognitiveCapabilities("What is the capital of France?");
	assert.equal(routed.advancedReasoning, false);
	assert.equal(routed.memoryRecall, false);
	assert.equal(routed.memoryWrite, false);
	assert.equal(routed.memoryDisabled, false);
});

test("cognitive router selects advanced reasoning for architecture hypothesis analysis", () => {
	const routed = routeCognitiveCapabilities(
		"Compare these two architectures, test the likely bottleneck hypotheses, and challenge the assumptions.",
	);
	assert.equal(routed.advancedReasoning, true);
	assert.ok(routed.reasonCodes.includes("ADVANCED_REASONING_SIGNAL"));
});

test("cognitive router recalls memory only when prior context is requested", () => {
	const routed = routeCognitiveCapabilities("Continue the migration plan we decided last time.");
	assert.equal(routed.memoryRecall, true);
	assert.equal(routed.memoryWrite, false);
	assert.ok(routed.reasonCodes.includes("PRIOR_CONTEXT_REQUIRED"));
});

test("cognitive router selects durable memory writes for explicit remember commands", () => {
	const routed = routeCognitiveCapabilities("Remember that this project must use PostgreSQL 18.");
	assert.equal(routed.memoryWrite, true);
	assert.ok(routed.reasonCodes.includes("DURABLE_MEMORY_WRITE_SIGNAL"));
});

test("private/no-memory commands override recall and writes without disabling reasoning", () => {
	const routed = routeCognitiveCapabilities(
		"Private session: do not remember this. Compare the architecture trade-offs and diagnose likely bottlenecks.",
	);
	assert.equal(routed.memoryDisabled, true);
	assert.equal(routed.memoryRecall, false);
	assert.equal(routed.memoryWrite, false);
	assert.equal(routed.advancedReasoning, true);
});

test("AgentMemory tenant principals are deterministic and isolated by user", () => {
	const salt = "test-only-agentmemory-salt";
	const first = agentMemoryPrincipalId("user-a", salt);
	assert.equal(first, agentMemoryPrincipalId("user-a", salt));
	assert.notEqual(first, agentMemoryPrincipalId("user-b", salt));
	assert.match(first, /^aira_[0-9a-f]{48}$/);
	assert.equal(first.includes("user-a"), false);
});

test("AgentMemory write filter blocks credential-like durable memory", () => {
	assert.equal(containsProhibitedMemoryData("api_key = sk-secret-value"), true);
	assert.equal(containsProhibitedMemoryData("password: hunter2"), true);
	assert.equal(containsProhibitedMemoryData("Remember that this project uses PostgreSQL 18."), false);
});
