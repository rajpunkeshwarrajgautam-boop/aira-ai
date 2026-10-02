import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	isContextOnlyFollowUpQuery,
	isGreetingOnlyQuery,
} from "../lib/search/no-quota-query";

const CONTEXT_ONLY_CASES = [
	"Give me notes of it.",
	"Make them shorter",
	"Give me 5 MCQs from this",
	"Explain the second one",
	"What are its disadvantages?",
	"Which one would you choose?",
	"Tell me more about it",
	"Compare them",
	"How so?",
] as const;

test("THREAD-RETRIEVAL-01: context-only follow-ups bypass a fresh web search", () => {
	for (const query of CONTEXT_ONLY_CASES) {
		assert.equal(isContextOnlyFollowUpQuery(query), true, query);
		assert.equal(isGreetingOnlyQuery(query), true, query);
	}
});

test("THREAD-RETRIEVAL-02: explicit fresh-research intent still uses grounded retrieval", () => {
	for (const query of [
		"Search the web for latest information about it",
		"Verify this with sources",
		"Research current evidence about that",
	]) {
		assert.equal(isContextOnlyFollowUpQuery(query), false, query);
		assert.equal(isGreetingOnlyQuery(query), false, query);
	}
});

test("THREAD-RETRIEVAL-03: standalone substantive queries are not misclassified", () => {
	for (const query of [
		"What is quantum computing?",
		"What is Bitcoin and how does it work?",
		"Summarize the latest changes in Next.js 16",
		"Compare PostgreSQL and MySQL for a SaaS backend",
	]) {
		assert.equal(isContextOnlyFollowUpQuery(query), false, query);
		assert.equal(isGreetingOnlyQuery(query), false, query);
	}
});

test("THREAD-RETRIEVAL-04: search route sends no-search conversational queries through direct synthesis", () => {
	const route = readFileSync(
		new URL("../app/api/search/route-core.ts", import.meta.url),
		"utf8",
	);
	assert.ok(route.includes("isGreetingOnlyQuery(parsed.data.query)"));
	assert.ok(route.includes("} else if (greetingOnly || memoryOnly) {"));
	assert.ok(route.includes("disableSearch: true"));
	assert.ok(route.includes("chatHistory: context.chatHistory"));
});
