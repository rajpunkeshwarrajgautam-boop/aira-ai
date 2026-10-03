import assert from "node:assert/strict";
import test, { mock } from "node:test";

let recallCalls = 0;
let backgroundCalls = 0;
let researchWrites = 0;
let memoryWrites = 0;
let refreshCalls = 0;
let messageWrites = 0;
let allowResearch = false;
let privateConversation = false;
const storedMessages: Array<Record<string, unknown>> = [];
const transaction = {
	conversationMessage: { create: async ({ data }: { data: Record<string, unknown> }) => { storedMessages.push(data); return { id: `message-${++messageWrites}` }; } },
	researchHistory: { create: async () => { researchWrites++; } },
	conversation: { update: async () => undefined },
};
mock.module("@/lib/prisma", { exports: { prisma: {
	conversation: { findFirst: async () => ({ id: "thread", title: "QA thread", summary: "UNRELATED_SUMMARY", messages: privateConversation ? [{ id: "old-private-seed" }] : [] }) },
	$transaction: async (fn: (tx: typeof transaction) => Promise<unknown>) => fn(transaction),
	conversationMessage: { findFirst: async ({ where }: { where: { id: string; userId: string; conversationId: string } }) => {
		assert.equal(where.userId, "owner");
		assert.equal(where.conversationId, "thread");
		return where.id === "assistant" ? { id: "assistant", parentMessageId: "user", role: "ASSISTANT", content: "Your certification code is CEDAR-6412." }
			: { id: "user", parentMessageId: null, role: "USER", content: "What is my certification code?" };
	} },
	researchHistory: { findMany: async () => {
		assert.ok(allowResearch, "Personal recall must not retrieve research containing loosely matching words");
		return [
			{ query: "Private session. No memory. My private code is LARCH-9827.", assistantAnswer: "PRIVATE_SENTINEL" },
			{ query: "What is my code?", assistantAnswer: "LEGACY_PRIVATE_FOLLOWUP", conversation: { messages: [{ id: "private-seed" }] } },
			{ query: "Explain lunar eclipses", assistantAnswer: "An eclipse occurs in the Earth's shadow." },
		];
	} },
} } });
mock.module("@/lib/persistent-memory", { exports: {
	getRelevantPersistentMemories: async (userId: string) => { assert.equal(userId, "owner"); recallCalls++; return []; },
	createManualMemory: async () => { memoryWrites++; },
	refreshPersistentMemory: async () => { refreshCalls++; return { upserts: 0, deletes: 0 }; },
} });
mock.module("@/lib/knowledge-assets", { exports: { getRelevantKnowledgeContext: async () => { backgroundCalls++; return ["UNRELATED_KNOWLEDGE"]; } } });
mock.module("@/lib/graph-memory", { exports: { getRelevantGraphContext: async () => { backgroundCalls++; return ["UNRELATED_GRAPH"]; } } });
const { getFollowUpContext, persistConversationTurn } = await import("../lib/conversation-memory");

test("missing personal fact has no substitute research, knowledge, graph, or summary context", async () => {
	recallCalls = 0;
	const result = await getFollowUpContext({ userId: "owner", query: "What is my private QA test code?", conversationId: "thread", parentMessageId: "assistant" });
	assert.equal(recallCalls, 1);
	assert.deepEqual(result.contextualMemory, []);
	assert.equal(backgroundCalls, 0);
	assert.equal(result.chatHistory.length, 2);
});

test("notes and private requests retain verified active ancestry without durable recall", async () => {
	for (const query of ["Give me notes of it.", "Private session. No memory. Give me notes of it."]) {
		recallCalls = 0;
		const result = await getFollowUpContext({ userId: "owner", query, conversationId: "thread", parentMessageId: "assistant" });
		assert.equal(recallCalls, 0);
		assert.deepEqual(result.contextualMemory, []);
		assert.equal(backgroundCalls, 0);
		assert.deepEqual(result.chatHistory.map((turn) => turn.role), ["user", "assistant"]);
		assert.match(result.chatHistory[1]!.content, /CEDAR-6412/);
	}
});


test("private turn persists its chat ancestry without reusable research or durable memory writes", async () => {
	researchWrites = memoryWrites = refreshCalls = messageWrites = 0;
	const result = await persistConversationTurn({ userId: "owner", conversationId: "thread", query: "Private session. No memory. Remember that my private code is LARCH-9827.", answer: "UNKNOWN", citations: [] });
	assert.equal(messageWrites, 2);
	assert.equal(researchWrites, 0);
	assert.equal(memoryWrites, 0);
	assert.equal(refreshCalls, 0);
	assert.equal(result.assistantMessageId, "message-2");
});

test("ordinary research and authorized memory writes retain persistence behavior", async () => {
	researchWrites = memoryWrites = refreshCalls = messageWrites = 0;
	await persistConversationTurn({ userId: "owner", conversationId: "thread", query: "Remember that my certification code is CEDAR-6412.", answer: "Recorded", citations: [] });
	assert.equal(messageWrites, 2);
	assert.equal(researchWrites, 1);
	assert.equal(memoryWrites, 1);
	assert.equal(refreshCalls, 1);
});

test("confirmed direct memory commands persist their conversation without a second memory write", async () => {
	researchWrites = memoryWrites = refreshCalls = messageWrites = 0;
	await persistConversationTurn({ userId: "owner", conversationId: "thread", query: "Remember that my review code is PINE-8842.", answer: "Saved to memory: my review code is PINE-8842.", citations: [], explicitMemoryAlreadySaved: true });
	assert.equal(messageWrites, 2);
	assert.equal(researchWrites, 1);
	assert.equal(memoryWrites, 0);
	assert.equal(refreshCalls, 1);
});


test("legacy private research rows are excluded from future context", async () => {
	const { getFollowUpContext: getCoreContext } = await import("../lib/conversation-memory-core");
	allowResearch = true;
	try {
	 const result = await getCoreContext({ userId: "owner", conversationId: "thread", parentMessageId: "assistant", query: "Explain lunar eclipses" });
	 assert.ok(result.contextualMemory.some((item) => item.includes("Earth's shadow")));
	 assert.ok(result.contextualMemory.every((item) => !item.includes("LARCH-9827") && !item.includes("PRIVATE_SENTINEL")));
	 assert.ok(result.contextualMemory.every((item) => !item.includes("LEGACY_PRIVATE_FOLLOWUP")));
	} finally { allowResearch = false; }
});

test("private sessions survive history truncation and block follow-up research and memory reuse", async () => {
	privateConversation = true;
	researchWrites = memoryWrites = refreshCalls = messageWrites = recallCalls = backgroundCalls = 0;
	storedMessages.length = 0;
	try {
		const context = await getFollowUpContext({ userId: "owner", query: "Remember that my review code is PRIVATE-44.", conversationId: "thread", parentMessageId: "assistant", messageLimit: 1 });
		assert.equal(context.privateSession, true);
		assert.deepEqual(context.contextualMemory, []);
		assert.equal(recallCalls, 0);
		assert.equal(backgroundCalls, 0);
		await persistConversationTurn({ userId: "owner", conversationId: "thread", query: "What is my review code?", answer: "PRIVATE-44", citations: [], privateSession: context.privateSession });
		assert.equal(messageWrites, 2);
		assert.equal(researchWrites, 0);
		assert.equal(memoryWrites, 0);
		assert.equal(refreshCalls, 0);
		assert.ok(storedMessages.every((message) => (message.metadata as { privateSession?: boolean }).privateSession === true));
	} finally { privateConversation = false; }
});
