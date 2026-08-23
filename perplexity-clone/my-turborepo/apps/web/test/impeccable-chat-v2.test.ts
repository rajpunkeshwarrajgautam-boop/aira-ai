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

test("composer exposes real commands, tools, and voice input", () => {
	const searchBox = read("components/SearchBox.tsx");
	for (const command of ["/deep ", "/new", "/history", "/share"]) {
		assert.ok(searchBox.includes(command), `expected ${command} command in composer`);
	}
	for (const destination of ["/knowledge", "/agents", "/omniroute"]) {
		assert.ok(searchBox.includes(`href="${destination}"`), `expected connected ${destination} action`);
	}
	assert.ok(searchBox.includes("aira:reuse-message"));
	assert.ok(searchBox.includes("aira:command"));
	assert.ok(searchBox.includes("SpeechRecognition"));
	assert.ok(searchBox.includes("Start voice input"));
});

test("conversation sidebar matches reference app rail and searchable history", () => {
	const sidebar = read("components/conversations/ConversationSidebar.tsx");
	assert.ok(sidebar.includes("aira-app-rail"));
	assert.ok(sidebar.includes("Search conversations"));
	assert.ok(sidebar.includes("Previous 7 Days"));
	for (const label of ["Chat", "Agents", "Files", "OmniRoute", "Compare", "Memory", "Search", "Integrations", "Settings"]) {
		assert.ok(sidebar.includes(label), `expected ${label} in app rail`);
	}
	assert.ok(sidebar.includes("event.metaKey || event.ctrlKey"));
	assert.ok(sidebar.includes("event.shiftKey"));
	assert.ok(sidebar.includes('event.key.toLowerCase() === "o"'));
});

test("message workspace has live inspector and non-placeholder actions", () => {
	const messages = read("components/conversations/ConversationMessageList.tsx");
	assert.ok(messages.includes("aira-live-inspector"));
	assert.ok(messages.includes("AIRA Auto"));
	assert.ok(messages.includes("Provider routing follows workspace policy"));
	assert.ok(!messages.includes("OmniRoute + AIRA policy"), "chat chrome must not imply a configured gateway");
	assert.ok(messages.includes("hostnameFromUrl"));
	assert.ok(messages.includes("navigator.clipboard.writeText"));
	assert.ok(messages.includes("navigator.share"));
	assert.ok(messages.includes("shareConversation"));
	assert.ok(messages.includes("window.print()"));
	assert.ok(messages.includes("ReusePromptButton"));
	assert.ok(messages.includes("aira:reuse-message"));
	assert.ok(!messages.includes('onClick={() => emitComposerCommand("/share")}'), "share controls should execute directly rather than recurse through a slash command");
	assert.ok(messages.includes('emitComposerCommand("/new")'));
	assert.ok(!messages.includes("GPT-4.1"), "reference shell must not fake a provider model label");
	assert.ok(!messages.includes("/api/conversations/"), "message actions should not silently mutate stored conversation history");
});
