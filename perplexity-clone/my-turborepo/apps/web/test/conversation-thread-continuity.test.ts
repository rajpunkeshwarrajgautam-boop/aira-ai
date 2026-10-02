import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
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

test("CHAT-CONT-01: ancestry includes the active parent assistant answer", async () => {
	const rows = new Map<string, Node>([
		["u1", node("u1", "USER", "What is quantum computing?", null)],
		["a1", node("a1", "ASSISTANT", "Quantum computing uses quantum-mechanical information processing.", "u1")],
	]);
	const chain = await walkConversationAncestry({
		parentMessageId: "a1",
		limit: 10,
		loadMessage: async (id) => rows.get(id) ?? null,
	});
	assert.deepEqual(chain.map((item) => item.id), ["u1", "a1"]);
	assert.deepEqual(toModelChatHistory(chain), [
		{ role: "user", content: "What is quantum computing?" },
		{ role: "assistant", content: "Quantum computing uses quantum-mechanical information processing." },
	]);
});

test("CHAT-CONT-02: ancestry follows only the selected branch and excludes siblings", async () => {
	const rows = new Map<string, Node>([
		["u1", node("u1", "USER", "Compare A and B", null)],
		["a1", node("a1", "ASSISTANT", "Comparison", "u1")],
		["u2", node("u2", "USER", "Tell me more about A", "a1")],
		["a2", node("a2", "ASSISTANT", "A details", "u2")],
		["u3", node("u3", "USER", "Tell me more about B", "a1")],
		["a3", node("a3", "ASSISTANT", "B details", "u3")],
	]);
	const chain = await walkConversationAncestry({
		parentMessageId: "a3",
		limit: 10,
		loadMessage: async (id) => rows.get(id) ?? null,
	});
	assert.deepEqual(chain.map((item) => item.id), ["u1", "a1", "u3", "a3"]);
	assert.equal(chain.some((item) => item.id === "u2" || item.id === "a2"), false);
});

test("CHAT-CONT-03: invalid parent fails closed instead of answering without context", async () => {
	await assert.rejects(
		walkConversationAncestry({
			parentMessageId: "missing",
			limit: 10,
			loadMessage: async () => null,
		}),
		/parent message was not found/i,
	);
});

test("CHAT-CONT-04: ancestry cycle is rejected", async () => {
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

test("CHAT-CONT-05: short referential and transformation follow-ups are thread-local", () => {
	for (const query of [
		"Give me notes of it",
		"Make them shorter",
		"Give 5 MCQs from this",
		"Explain the second one",
		"What are its disadvantages?",
	]) {
		assert.equal(isThreadLocalFollowUp(query), true, query);
	}
	assert.equal(isThreadLocalFollowUp("What is quantum computing?"), false);
});

test("CHAT-CONT-06: facade uses branch-aware context and does not silently drop active-thread errors", () => {
	const facade = readFileSync(new URL("../lib/conversation-memory.ts", import.meta.url), "utf8");
	const contextLoader = readFileSync(
		new URL("../lib/conversation-thread-context.ts", import.meta.url),
		"utf8",
	);
	assert.ok(
		facade.includes('from "./conversation-thread-context"'),
		"conversation facade must use the branch-aware context loader",
	);
	assert.ok(
		facade.includes("if (args.conversationId || args.parentMessageId) throw error;"),
		"active-thread context failures must fail closed",
	);
	assert.ok(
		contextLoader.includes("...(resolvedConversationId ? { conversationId: resolvedConversationId } : {})"),
		"prior research must be scoped to the active conversation when one exists",
	);
	assert.equal(
		contextLoader.includes("id: { not: parentMessageId }"),
		false,
		"the active parent assistant message must never be excluded from context",
	);
});

test("CHAT-CONT-07: no-memory mode suppresses native durable and research recall", () => {
	const contextLoader = readFileSync(
		new URL("../lib/conversation-thread-context.ts", import.meta.url),
		"utf8",
	);
	assert.ok(
		contextLoader.includes("const memoryDisabled = routeCognitiveCapabilities(query).memoryDisabled;"),
		"the native context loader must honor the server-authoritative no-memory policy",
	);
	assert.ok(
		contextLoader.includes("threadLocalFollowUp || memoryDisabled"),
		"durable memory recall must be disabled for private/no-memory commands",
	);
	assert.ok(
		contextLoader.includes("!memoryDisabled && !threadLocalFollowUp"),
		"prior research recall must also be disabled for private/no-memory commands",
	);
});
