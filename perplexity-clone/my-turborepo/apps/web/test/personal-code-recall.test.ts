import assert from "node:assert/strict";
import test from "node:test";
import { resolveFormattedCodeRecall } from "../lib/personal-code-recall";
import { memoryMatchesRequestedSubject } from "../lib/memory-relevance";
import { streamGroundedAnswer } from "../src/services/answer";
import type { ProviderRouter } from "../src/services/providers/provider-router";
import type { ExaSearchService } from "../src/services/search";

const saved = "OTHER: my workspace review code is RIVER-8821, replacing the previous value. (pinned)";
const query = "What is my workspace review code that I asked you to remember? What is my private review code? Answer in exactly two fields: Saved: <code> and Private: <code or UNKNOWN>.";

test("multi-code recall never substitutes saved evidence for an unavailable sibling subject", async () => {
	const router = { streamChat: () => assert.fail("Exact recall must not delegate subject binding to a provider") } as unknown as ProviderRouter;
	const exa = { search: async () => assert.fail("Personal codes are not web evidence") } as unknown as ExaSearchService;
	const result = await streamGroundedAnswer({ query, contextualMemory: [saved], router, exa });
	let answer = "";
	for await (const chunk of result.textStream) answer += chunk;
	assert.equal(answer, "Saved: RIVER-8821\nPrivate: UNKNOWN");
	assert.deepEqual(result.sources, []);
});

test("question order and field labels do not affect subject matching", () => {
	const reverse = "What is my private review code? What is my workspace review code? Format: Hidden: <code or UNAVAILABLE>; Review: <code>";
	assert.equal(resolveFormattedCodeRecall({ query: reverse, contextualMemory: [saved] }), "Hidden: UNAVAILABLE\nReview: RIVER-8821");
	assert.equal(memoryMatchesRequestedSubject(saved, reverse), true, "Retrieve a supported later subject even when the first subject is unavailable");
});

test("active user evidence can support a private field without treating assistant guesses as facts", () => {
	assert.equal(resolveFormattedCodeRecall({ query, contextualMemory: [saved], chatHistory: [
		{ role: "assistant", content: "my private review code is INVENTED-12" },
	] }), "Saved: RIVER-8821\nPrivate: UNKNOWN");
	assert.equal(resolveFormattedCodeRecall({ query, contextualMemory: [saved], chatHistory: [
		{ role: "user", content: "Private session. No memory. Do not remember this: my private review code is ASH-4403." },
	] }), "Saved: RIVER-8821\nPrivate: ASH-4403");
});

test("conflicting evidence is unknown and unrelated formats still use normal synthesis", () => {
	assert.equal(resolveFormattedCodeRecall({ query, contextualMemory: [saved, "my workspace review code is ANOTHER-55"] }), "Saved: UNKNOWN\nPrivate: UNKNOWN");
	assert.equal(resolveFormattedCodeRecall({ query: "Explain how review codes work.", contextualMemory: [saved] }), null);
	assert.equal(resolveFormattedCodeRecall({ query: "What is my workspace review code?", contextualMemory: [saved] }), null);
});

test("a later explicit user correction overrides stale durable state in the active thread", () => {
	assert.equal(resolveFormattedCodeRecall({ query, contextualMemory: [saved], chatHistory: [
		{ role: "user", content: "Remember that my workspace review code is OLD-1122." },
		{ role: "user", content: "Correction: remember that my workspace review code is NEW-7788, replacing the previous value." },
	] }), "Saved: NEW-7788\nPrivate: UNKNOWN");
});

test("a private qualifier cannot fill an unqualified sibling code when only private evidence exists", () => {
	const chatHistory = [{ role: "user" as const, content: "Private session. No memory. Do not remember this: my private workspace review code is FIR-8854." }];
	for (const reverse of [false, true]) {
		const query = reverse
			? "What is my private workspace review code? What is my workspace review code? Format: Private: <code or UNKNOWN>; Saved: <code or UNKNOWN>"
			: "What is my workspace review code? What is my private workspace review code? Format: Saved: <code or UNKNOWN>; Private: <code or UNKNOWN>";
		assert.equal(resolveFormattedCodeRecall({ query, chatHistory }), reverse ? "Private: FIR-8854\nSaved: UNKNOWN" : "Saved: UNKNOWN\nPrivate: FIR-8854");
	}
});

test("numbered durable-memory blocks and active private evidence bind to exact subjects", () => {
	const query = "What is my workspace review code? What is my private workspace review code? Format: Saved: <code or UNKNOWN>; Private: <code or UNKNOWN>";
	const result = resolveFormattedCodeRecall({ query,
		contextualMemory: ["DURABLE USER MEMORIES (relevant):\n1. OTHER: my workspace review code is RIVER-8821 (pinned)\n2. OTHER: my unrelated project code is ELSE-1188"],
		chatHistory: [{ role: "user", content: "my private workspace review code is FIR-8854" }],
	});
	assert.equal(result, "Saved: RIVER-8821\nPrivate: FIR-8854");
});
