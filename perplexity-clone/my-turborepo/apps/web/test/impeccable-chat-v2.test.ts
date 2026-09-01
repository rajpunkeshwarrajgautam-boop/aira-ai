import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("chat home uses the canonical AIRA shell and narrow SearchLayout bridge", () => {
	const page = read("app/page.tsx");
	assert.ok(page.includes("<AiraV2Frame>"), "home chat should share the global AIRA application shell");
	assert.ok(page.includes('<SearchLayout className="aira-core-search" />'));
	assert.ok(page.includes('import "./aira-v2.css"'));
	assert.ok(!page.includes("impeccable-chat-v2.css"), "home must not restore the retired polish layer");
	assert.ok(!page.includes("AiraPreloader"), "home must not mount the preloader after its legacy stylesheet was retired");
});

test("composer exposes real commands, tools, and voice input", () => {
	const searchBox = read("components/SearchBox.tsx");
	for (const command of ["/deep ", "/new", "/history", "/share"]) {
		assert.ok(searchBox.includes(command), `expected ${command} command in composer`);
	}
	for (const destination of ["/knowledge", "/agents", "/local-ai"]) {
		assert.ok(searchBox.includes(`href="${destination}"`), `expected connected ${destination} action`);
	}
	assert.ok(searchBox.includes("aira:reuse-message"));
	assert.ok(searchBox.includes("aira:command"));
	assert.ok(searchBox.includes("SpeechRecognition"));
	assert.ok(searchBox.includes("Start voice input"));
});

test("conversation sidebar is context-only while the shared shell owns application navigation", () => {
	const sidebar = read("components/conversations/ConversationSidebar.tsx");
	const frame = read("components/AiraV2Frame.tsx");
	assert.ok(!sidebar.includes("aira-app-rail"), "Research must not render a second application rail inside conversation history");
	assert.ok(sidebar.includes("Search conversations"));
	assert.ok(sidebar.includes("Previous 7 Days"));
	assert.ok(frame.includes('aria-label="AIRA workspace navigation"'));
	for (const label of ["Ask AIRA", "Search", "Agents", "Runs", "Knowledge", "Local AI", "Model Lab", "Memory", "Settings"]) {
		assert.ok(frame.includes(label), `expected ${label} in shared workspace navigation`);
	}
	assert.ok(sidebar.includes("event.metaKey || event.ctrlKey"));
	assert.ok(sidebar.includes("event.shiftKey"));
	assert.ok(sidebar.includes('event.key.toLowerCase() === "o"'));
});

test("message workspace exposes grounded inspector and real non-placeholder actions", () => {
	const messages = read("components/conversations/ConversationMessageList.tsx");
	assert.ok(messages.includes('import styles from "./ConversationMessageList.module.css"'));
	assert.ok(messages.includes('aria-label="Conversation inspector"'));
	assert.ok(messages.includes("AIRA Auto"));
	assert.ok(messages.includes("Provider router + task policy"));
	assert.ok(messages.includes("hostnameFromUrl"));
	assert.ok(messages.includes("navigator.clipboard.writeText"));
	assert.ok(messages.includes("navigator.share"));
	assert.ok(messages.includes("shareConversation"));
	assert.ok(messages.includes("window.print()"));
	assert.ok(messages.includes("ReusePromptButton"));
	assert.ok(messages.includes("aira:reuse-message"));
	assert.ok(messages.includes('emitComposerCommand("/new")'));
	assert.ok(messages.includes('emitComposerCommand("/deep ")'));
	assert.ok(!messages.includes('onClick={() => emitComposerCommand("/share")}'), "share controls should execute directly rather than recurse through a slash command");
	assert.ok(!messages.includes("GPT-4.1"), "workspace must not fake a provider model label");
	assert.ok(!messages.includes("/api/conversations/"), "message actions should not silently mutate stored conversation history");
});
