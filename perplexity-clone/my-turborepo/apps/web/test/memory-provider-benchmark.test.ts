import assert from "node:assert/strict";
import test from "node:test";

import {
	agentMemoryPrincipalId,
	containsProhibitedMemoryData,
	persistAgentMemoryTurn,
	recallAgentMemoryContext,
} from "../lib/cognitive/agentmemory";
import {
	buildMem0BenchmarkSearchPayload,
	buildMem0BenchmarkWritePayload,
	isMem0BenchmarkConfigured,
	mem0BenchmarkPrincipalId,
	mem0BenchmarkProjectScope,
	parseMem0BenchmarkRecall,
	persistMem0BenchmarkTurn,
	recallMem0BenchmarkContext,
} from "../lib/cognitive/mem0-benchmark";

const SALT = "benchmark-salt-at-least-sixteen-chars";

function elapsedMs(started: number): number {
	return Math.round((performance.now() - started) * 100) / 100;
}

async function retryRecall(
	fn: () => Promise<string[]>,
	needle: string,
	attempts = 10,
): Promise<{ memories: string[]; elapsedMs: number }> {
	const started = performance.now();
	let memories: string[] = [];
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		memories = await fn();
		if (memories.some((item) => item.toLowerCase().includes(needle.toLowerCase()))) break;
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	return { memories, elapsedMs: elapsedMs(started) };
}

test("MEM-BENCH-01: both providers use deterministic pseudonymous Aira principals", () => {
	const rawA = "user-a-internal-id";
	const rawB = "user-b-internal-id";
	const agentA = agentMemoryPrincipalId(rawA, SALT);
	const mem0A = mem0BenchmarkPrincipalId(rawA, SALT);
	assert.equal(agentA, agentMemoryPrincipalId(rawA, SALT));
	assert.equal(mem0A, mem0BenchmarkPrincipalId(rawA, SALT));
	assert.notEqual(agentA, agentMemoryPrincipalId(rawB, SALT));
	assert.notEqual(mem0A, mem0BenchmarkPrincipalId(rawB, SALT));
	assert.equal(agentA.includes(rawA), false);
	assert.equal(mem0A.includes(rawA), false);
});

test("MEM-BENCH-02: Mem0 benchmark payload never sends raw Aira user/project identifiers", () => {
	const userId = "raw-user-123";
	const projectId = "raw-project-456";
	const search = buildMem0BenchmarkSearchPayload({
		userId,
		query: "What database did we choose?",
		entitySalt: SALT,
	});
	const write = buildMem0BenchmarkWritePayload({
		userId,
		projectId,
		userMessage: "Remember that this project uses PostgreSQL 18.",
		entitySalt: SALT,
	});
	const serialized = JSON.stringify({ search, write });
	assert.equal(serialized.includes(userId), false);
	assert.equal(serialized.includes(projectId), false);
	assert.equal(
		(write.metadata as Record<string, unknown>).aira_project_scope,
		mem0BenchmarkProjectScope(userId, projectId, SALT),
	);
});

test("MEM-BENCH-03: Mem0 recall fails closed on user or project scope mismatch", () => {
	const expectedUserId = mem0BenchmarkPrincipalId("user-a", SALT);
	const expectedProjectScope = mem0BenchmarkProjectScope("user-a", "project-a", SALT);
	const otherUserId = mem0BenchmarkPrincipalId("user-b", SALT);
	const otherProjectScope = mem0BenchmarkProjectScope("user-a", "project-b", SALT);
	const result = {
		results: [
			{ memory: "correct", user_id: expectedUserId, metadata: { aira_project_scope: expectedProjectScope } },
			{ memory: "wrong user", user_id: otherUserId, metadata: { aira_project_scope: expectedProjectScope } },
			{ memory: "wrong project", user_id: expectedUserId, metadata: { aira_project_scope: otherProjectScope } },
		],
	};
	assert.deepEqual(parseMem0BenchmarkRecall({ result, expectedUserId, expectedProjectScope }), ["correct"]);
});

test("MEM-BENCH-04: shared Aira secret filter rejects credential-like durable memories", () => {
	assert.equal(containsProhibitedMemoryData("Remember api_key = sk-example-secret-value-123"), true);
	assert.equal(containsProhibitedMemoryData("Remember that Aira uses PostgreSQL 18."), false);
});

const liveEnabled = process.env.AIRA_MEMORY_PROVIDER_LIVE_BENCHMARK === "true";
const liveAgentMemoryConfigured =
	process.env.AIRA_AGENTMEMORY_ENABLED === "true" &&
	Boolean(process.env.AIRA_AGENTMEMORY_URL && process.env.AIRA_AGENTMEMORY_SECRET && process.env.AIRA_AGENTMEMORY_ENTITY_SALT);

test(
	"MEM-BENCH-LIVE: Aira-specific recall, isolation and latency comparison",
	{ skip: !(liveEnabled && liveAgentMemoryConfigured && isMem0BenchmarkConfigured()) },
	async () => {
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const userA = `bench-a-${suffix}`;
		const userB = `bench-b-${suffix}`;
		const projectA = `project-a-${suffix}`;
		const projectB = `project-b-${suffix}`;
		const marker = `Aira benchmark ${suffix} uses PostgreSQL 18 as its database baseline.`;
		const query = `Which database baseline is recorded for Aira benchmark ${suffix}?`;

		const agentWriteStarted = performance.now();
		assert.equal(
			await persistAgentMemoryTurn({
				userId: userA,
				userMessage: `Remember that ${marker}`,
				assistantResponse: "Recorded for benchmark certification.",
				projectId: projectA,
			}),
			true,
		);
		const agentWriteMs = elapsedMs(agentWriteStarted);

		const mem0WriteStarted = performance.now();
		assert.equal(
			await persistMem0BenchmarkTurn({
				userId: userA,
				userMessage: `Remember that ${marker}`,
				projectId: projectA,
			}),
			true,
		);
		const mem0WriteMs = elapsedMs(mem0WriteStarted);

		const agentRecall = await retryRecall(
			() => recallAgentMemoryContext({ userId: userA, query, projectId: projectA }),
			"PostgreSQL 18",
		);
		const mem0Recall = await retryRecall(
			() => recallMem0BenchmarkContext({ userId: userA, query, projectId: projectA }),
			"PostgreSQL 18",
		);

		assert.ok(agentRecall.memories.some((item) => item.includes("PostgreSQL 18")));
		assert.ok(mem0Recall.memories.some((item) => item.includes("PostgreSQL 18")));

		assert.equal(
			(await recallAgentMemoryContext({ userId: userB, query, projectId: projectA })).some((item) => item.includes(suffix)),
			false,
		);
		assert.equal(
			(await recallMem0BenchmarkContext({ userId: userB, query, projectId: projectA })).some((item) => item.includes(suffix)),
			false,
		);
		assert.equal(
			(await recallAgentMemoryContext({ userId: userA, query, projectId: projectB })).some((item) => item.includes(suffix)),
			false,
		);
		assert.equal(
			(await recallMem0BenchmarkContext({ userId: userA, query, projectId: projectB })).some((item) => item.includes(suffix)),
			false,
		);

		console.info(
			"[AiraMemoryBenchmark]",
			JSON.stringify({
				agentMemory: { writeMs: agentWriteMs, recallMs: agentRecall.elapsedMs, recallCount: agentRecall.memories.length },
				mem0: { writeMs: mem0WriteMs, recallMs: mem0Recall.elapsedMs, recallCount: mem0Recall.memories.length },
			}),
		);
	},
);
