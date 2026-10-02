import assert from "node:assert/strict";
import test from "node:test";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { streamGroundedAnswer } from "../src/services/answer";
import type { ProviderRouter } from "../src/services/providers/provider-router";
import type { ExaSearchService } from "../src/services/search";

const history = [
	{ role: "user" as const, content: "What is my certification code?" },
	{ role: "assistant" as const, content: "Your certification code is CEDAR-6412." },
];

for (const query of [
	"Give me notes of it.",
	"Give me detailed notes of it and explain each part in a useful table for revision.",
	"What is my Aira certification QA test code that I asked you to remember? Answer only with the code.",
]) {
	test(`provider receives active thread throughout synthesis: ${query}`, async () => {
		const calls: ChatCompletionMessageParam[][] = [];
		const router = {
			streamChat: async function* (messages: ChatCompletionMessageParam[]) {
				calls.push(messages);
				yield "CEDAR-6412";
			},
		} as unknown as ProviderRouter;
		const exa = { search: async () => { assert.fail("Personal recall and thread transformations must not search the web"); } } as unknown as ExaSearchService;
		const result = await streamGroundedAnswer({ query, chatHistory: history, router, exa, disableSearch: true });
		let answer = "";
		for await (const chunk of result.textStream) answer += chunk;
		assert.equal(answer, "CEDAR-6412");
		assert.equal(result.sources.length, 0);
		assert.ok(calls.length >= 1);
		for (const messages of calls) {
			const userIndex = messages.findIndex((m) => m.role === "user" && m.content === history[0]!.content);
			assert.ok(userIndex > 0, "Every generation, including the verifier, must receive the actual active thread");
			assert.equal(messages[userIndex + 1]?.content, history[1]!.content);
			assert.equal(messages[userIndex + 1]?.role, "assistant");
		}
		assert.match(String(calls[0]![0]!.content), /Do not claim this conversation just started/);
		if (query.includes("detailed") || query.includes("asked you")) assert.equal(calls.length, 2, "Exercise the agentic verifier, not just the direct answer");
	});
}

test("personal recall and explicit remember commands skip retrieval without a caller override", async () => {
	for (const query of ["Remember that my certification code is CEDAR-6412.", "What is my private code? Answer UNKNOWN if unavailable."]) {
		const calls: ChatCompletionMessageParam[][] = [];
		const router = { streamChat: async function* (messages: ChatCompletionMessageParam[]) { calls.push(messages); yield "UNKNOWN"; } } as unknown as ProviderRouter;
		const exa = { search: async () => assert.fail("A user's personal fact is not public web evidence") } as unknown as ExaSearchService;
		const result = await streamGroundedAnswer({ query, router, exa });
		for await (const chunk of result.textStream) assert.equal(chunk, "UNKNOWN");
		assert.equal(result.sources.length, 0);
		assert.match(String(calls[0]![0]!.content), /Never substitute a different code/);
	}
});
