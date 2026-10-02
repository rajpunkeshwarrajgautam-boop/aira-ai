import assert from "node:assert/strict";
import test, { mock } from "node:test";

let semanticCalls = 0;
let scores = new Map<string, number>();
const memories = [
	{ id: "cert", kind: "OTHER", content: "The user's Aira certification QA test code is CEDAR-6412", pinned: true, importance: 5 },
	{ id: "meal", kind: "OTHER", content: "My favorite meal is pasta", pinned: false, importance: 4 },
];
mock.module("../lib/persistent-memory-core", { exports: {
	createManualMemory: async () => memories[0],
	getRelevantPersistentMemories: async () => [],
	listUserMemories: async (userId: string) => { assert.equal(userId, "owner"); return memories; },
	refreshPersistentMemory: async () => ({ upserts: 0, deletes: 0 }),
	deleteUserMemory: async () => false,
	setUserMemoryPinned: async () => false,
} });
mock.module("@/lib/semantic-memory", { exports: {
	EmbeddingCircuitOpenError: class extends Error {},
	getSemanticMemoryScores: async (userId: string) => { assert.equal(userId, "owner"); semanticCalls++; return scores; },
	resolveSemanticEmbeddingRouteForUser: async () => ({}),
	upsertUserMemoryEmbedding: async () => undefined,
} });
const { getRelevantPersistentMemories } = await import("../lib/persistent-memory");

test("semantic recall requires evidence of relevance even for pinned memories", async () => {
	for (const similarity of [undefined, 0.1, 0.54]) {
		scores = similarity === undefined ? new Map() : new Map([["cert", similarity]]);
		assert.deepEqual(await getRelevantPersistentMemories("owner", "Explain lunar eclipses"), []);
	}
});

test("even high vector similarity cannot substitute another requested personal subject", async () => {
	scores = new Map([["cert", 0.98]]);
	assert.deepEqual(await getRelevantPersistentMemories("owner", "What is my Aira private QA test code?"), []);
	assert.equal((await getRelevantPersistentMemories("owner", "What is my Aira certification QA test code?")).length, 1);
});

test("semantic recall preserves relevant paraphrases", async () => {
	scores = new Map([["meal", 0.85]]);
	const recalled = await getRelevantPersistentMemories("owner", "Suggest dinner I would enjoy");
	assert.equal(recalled.length, 1);
	assert.match(recalled[0]!, /pasta/);
});

test("private requests and greetings never invoke vector recall", async () => {
	semanticCalls = 0;
	for (const query of ["hello", "Private session. No memory. What is my certification code?"]) {
		assert.deepEqual(await getRelevantPersistentMemories("owner", query), []);
	}
	assert.equal(semanticCalls, 0);
});
