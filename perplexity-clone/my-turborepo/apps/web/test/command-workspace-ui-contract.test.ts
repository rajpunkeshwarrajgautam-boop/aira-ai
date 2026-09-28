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

test("ConversationRow provides persistent visual differentiation and discoverable affordance for pinned conversations", () => {
	const sidebar = source("components/conversations/ConversationSidebar.tsx");

	// 1. Pinned conversation receives persistent pinned-state styling and data attribute
	assert.match(sidebar, /data-pinned=\{pinned \? "true" : undefined\}/);
	assert.match(sidebar, /pinned\s*\?\s*"bg-\[#3A0CA3\]\/\[0\.035\]/);
	assert.match(sidebar, /ring-1 ring-\[#3A0CA3\]\/12/);
	assert.match(sidebar, /pinned && !selected \? "font-medium text-\[#241442\]"/);

	// 2. PinOff control is visually discoverable without hover for pinned rows
	assert.match(sidebar, /pinned\s*\?\s*"text-\[#5C4D82\] opacity-75 hover:bg-white hover:text-\[#3A0CA3\] hover:opacity-100"/);

	// 3. Unpinned rows retain normal appearance with hover-only pin icon
	assert.match(sidebar, /"text-\[#9A99A3\] opacity-0 hover:bg-white hover:text-\[#3A0CA3\] group-hover\/row:opacity-100"/);
	assert.match(sidebar, /"text-\[#5F5E68\] hover:bg-\[#111115\]\/\[0\.035\] hover:text-\[#111115\]"/);

	// 4. Selected state remains intact with strong identity
	assert.match(sidebar, /selected\s*\?\s*pinned\s*\?\s*"bg-\[#3A0CA3\]\/\[0\.08\] font-semibold text-\[#2D0A82\] ring-1 ring-\[#3A0CA3\]\/20"/);

	// 5. Accessible label flips between Pin and Unpin
	assert.match(sidebar, /aria-label=\{pinned \? `Unpin \$\{conversation\.title\}` : `Pin \$\{conversation\.title\}`\}/);
	assert.match(sidebar, /title=\{pinned \? "Unpin conversation" : "Pin conversation"\}/);
});
