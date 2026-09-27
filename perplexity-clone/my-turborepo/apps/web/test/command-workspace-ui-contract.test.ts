import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath: string): string {
	return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

test("workspace sidebar derives Pinned and Recent from the production grouping helper", () => {
	const sidebar = source("components/conversations/ConversationSidebar.tsx");
	assert.match(sidebar, /partitionConversations\(filtered\)/);
	assert.match(sidebar, /partitioned\.pinned/);
	assert.match(sidebar, /partitioned\.recentGroups/);
	assert.doesNotMatch(sidebar, /localStorage|sessionStorage/);
});

test("SearchLayout owns real projects and authenticated pin mutations", () => {
	const layout = source("components/SearchLayout.tsx");
	assert.match(layout, /\/api\/agent-platform\/projects/);
	assert.match(layout, /sessionStatus !== "authenticated"/);
	assert.match(layout, /JSON\.stringify\(\{ pinned \}\)/);
	assert.match(layout, /optimisticPinnedAt/);
	assert.match(layout, /setConversations\(\(current\).*previous/s);
});

test("composer exposes real search mode control and fail-closed reasoning effort", () => {
	const composer = source("components/SearchBox.tsx");
	const capability = source("lib/reasoning-effort.ts");
	assert.match(composer, /onResearchModeChange\?\.\(mode\)/);
	assert.match(composer, /Reasoning effort/);
	assert.match(composer, /activeReasoningCapability\.reason/);
	assert.match(capability, /supported: false/);
	assert.doesNotMatch(capability, /prompt|token budget|rerout/i);
});

test("home frame delegates navigation to the integrated authenticated workspace sidebar", () => {
	const page = source("app/page.tsx");
	const frame = source("components/AiraV2Frame.tsx");
	assert.match(page, /AiraV2Frame integratedWorkspaceNavigation/);
	assert.match(frame, /useIntegratedNavigation/);
});
