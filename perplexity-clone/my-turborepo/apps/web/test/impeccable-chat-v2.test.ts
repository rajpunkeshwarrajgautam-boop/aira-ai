import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("chat home uses a single focused shell", () => {
	const page = read("app/page.tsx");
	assert.ok(!page.includes("<AiraV2Frame>"), "home chat should not be nested inside the global workspace rail");
	assert.ok(page.includes("<SearchLayout />"));
	assert.ok(page.includes("impeccable-chat-v2.css"));
});

test("composer exposes real commands and connected context destinations", () => {
	const searchBox = read("components/SearchBox.tsx");
	for (const command of ["/deep ", "/new", "/history", "/share"]) {
		assert.ok(searchBox.includes(command), `expected ${command} command in composer`);
	}
	for (const destination of ["/knowledge", "/agents", "/local-ai"]) {
		assert.ok(searchBox.includes(`href=\"${destination}\"`), `expected connected ${destination} action`);
	}
	assert.ok(searchBox.includes("aira:reuse-message"));
});

test("conversation sidebar has search, grouping, and a working new-chat shortcut", () => {
	const sidebar = read("components/conversations/ConversationSidebar.tsx");
	assert.ok(sidebar.includes("Search chats"));
	assert.ok(sidebar.includes("Previous 7 days"));
	assert.ok(sidebar.includes("event.metaKey || event.ctrlKey"));
	assert.ok(sidebar.includes("event.shiftKey"));
	assert.ok(sidebar.includes('event.key.toLowerCase() === "o"'));
});

test("message list provides copy and reuse actions without mutating persistence", () => {
	const messages = read("components/conversations/ConversationMessageList.tsx");
	assert.ok(messages.includes("navigator.clipboard.writeText"));
	assert.ok(messages.includes("ReusePromptButton"));
	assert.ok(messages.includes("aira:reuse-message"));
	assert.ok(!messages.includes("/api/conversations/"), "message actions should not silently mutate stored conversation history");
});
