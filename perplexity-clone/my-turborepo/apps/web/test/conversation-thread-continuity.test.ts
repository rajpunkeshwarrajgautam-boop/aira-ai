import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	canonicalDurableMemoryText,
	isExplicitDurableMemoryRequest,
	isMemoryDisabledRequest,
	isThreadLocalFollowUp,
	toModelChatHistory,
	walkConversationAncestry,
	type ConversationThreadNode,
} from "../lib/conversation-thread";

type Node = ConversationThreadNode & { readonly createdAt: Date };

function node(
	id: string,
	role: "USER" | "ASSISTANT",
	content: string,
	parentMessageId: string | null,
): Node {
	return { id, role, content, parentMessageId, createdAt: new Date() };
}

test("CHAT-CONT-01: active ancestry includes the immediately preceding assistant answer", async () => {
	const rows = new Map<string, Node>([
		["u1", node("u1", "USER", "What is quantum computing?", null)],
		["a1", node("a1", "ASSISTANT", "Quantum computing uses quantum information processing.", "u1")],
	]);
	const chain = await walkConversationAncestry({
		parentMessageId: "a1",
		limit: 10,
		loadMessage: async (id) => rows.get(id) ?? null,
	});
	assert.deepEqual(chain.map((item) => item.id), ["u1", "a1"]);
	assert.deepEqual(toModelChatHistory(chain), [
		{ role: "user", content: "What is quantum computing?" },
		{ role: "assistant", content: "Quantum computing uses quantum information processing." },
	]);
});

test("CHAT-CONT-02: active ancestry follows only the selected branch", async () => {
	const rows = new Map<string, Node>([
		["u1", node("u1", "USER", "Compare React and Vue", null)],
		["a1", node("a1", "ASSISTANT", "Comparison", "u1")],
		["u2", node("u2", "USER", "Tell me more about React", "a1")],
		["a2", node("a2", "ASSISTANT", "React details", "u2")],
		["u3", node("u3", "USER", "Tell me more about Vue", "a1")],
		["a3", node("a3", "ASSISTANT", "Vue details", "u3")],
	]);
	const chain = await walkConversationAncestry({
		parentMessageId: "a3",
		limit: 10,
		loadMessage: async (id) => rows.get(id) ?? null,
	});
	assert.deepEqual(chain.map((item) => item.id), ["u1", "a1", "u3", "a3"]);
	assert.equal(chain.some((item) => item.id === "u2" || item.id === "a2"), false);
});

test("CHAT-CONT-03: invalid parents and cycles fail closed", async () => {
	await assert.rejects(
		walkConversationAncestry({
			parentMessageId: "missing",
			limit: 10,
			loadMessage: async () => null,
		}),
		/parent message was not found/i,
	);

	const rows = new Map<string, Node>([
		["a1", node("a1", "ASSISTANT", "A", "u1")],
		["u1", node("u1", "USER", "U", "a1")],
	]);
	await assert.rejects(
		walkConversationAncestry({
			parentMessageId: "a1",
			limit: 10,
			loadMessage: async (id) => rows.get(id) ?? null,
		}),
		/contains a cycle/i,
	);
});

test("CHAT-CONT-04: referential and transformation follow-ups are topic-agnostic", () => {
	for (const query of [
		"Give me notes of it",
		"Make them shorter",
		"Give 5 MCQs from this",
		"Explain the second one",
		"What are its disadvantages?",
		"Turn that into an implementation plan",
	]) {
		assert.equal(isThreadLocalFollowUp(query), true, query);
	}
	assert.equal(isThreadLocalFollowUp("What is quantum computing?"), false);
	assert.equal(isThreadLocalFollowUp("How does a carburetor work?"), false);
});

test("CHAT-MEM-01: explicit durable memory commands are normalized", () => {
	assert.equal(isExplicitDurableMemoryRequest("Remember that this project uses PostgreSQL 18."), true);
	assert.equal(canonicalDurableMemoryText("Remember that this project uses PostgreSQL 18."), "this project uses PostgreSQL 18.");
	assert.equal(isExplicitDurableMemoryRequest("What is PostgreSQL?"), false);
});

test("CHAT-MEM-02: private/no-memory commands override memory writes", () => {
	assert.equal(isMemoryDisabledRequest("Private session: do not remember this."), true);
	assert.equal(isExplicitDurableMemoryRequest("Private session: remember that my token is abc."), false);
});

test("CHAT-CONT-05: production facade fails closed and suppresses background recall for thread-local requests", () => {
	const facade = readFileSync(new URL("../lib/conversation-memory.ts", import.meta.url), "utf8");
	const core = readFileSync(new URL("../lib/conversation-memory-core.ts", import.meta.url), "utf8");
	assert.ok(facade.includes("if (args.conversationId || args.parentMessageId) throw error;"));
	assert.ok(facade.includes("!memoryDisabled && !threadLocalFollowUp"));
	assert.ok(core.includes("walkConversationAncestry"));
	assert.equal(core.includes("id: { not: parentMessageId }"), false);
	assert.ok(core.includes("createManualMemory"));
});
