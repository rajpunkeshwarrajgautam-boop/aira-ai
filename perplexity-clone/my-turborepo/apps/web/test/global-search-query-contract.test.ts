import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWebFile(relativePath: string): string {
	return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

test("global message search is one bounded user-scoped database query", () => {
	const helper = readWebFile("lib/global-search.ts");

	assert.ok(helper.includes("prisma.conversationMessage.findMany"));
	assert.ok(helper.includes("userId,"));
	assert.ok(helper.includes("content: { contains: needle, mode: \"insensitive\" }"));
	assert.ok(helper.includes("archivedAt: null"));
	assert.ok(helper.includes("Math.min(Math.max(limit, 1), 60)"));
	assert.ok(helper.includes("conversation: {"));
});

test("global-search route does not fan out through conversation histories", () => {
	const route = readWebFile("app/api/global-search/route.ts");

	assert.ok(route.includes("searchConversationMessages(session.user.id, q, 40)"));
	assert.ok(route.includes("Promise.all(["));
	assert.equal(route.includes("listConversationMessages"), false);
	assert.equal(route.includes("Promise.allSettled"), false);
	assert.ok(route.includes('"Cache-Control": "no-store"'));
});
