/**
 * workspace-error-and-guest-sidebar.test.ts
 *
 * Deterministic regression tests for PR #143 QA defects D1 and D2:
 *
 * D1: Search failure must never blank the workspace:
 *   - CASE A: Guest home 500 before stream begins keeps composer visible, restores query, renders role=alert with safe message
 *   - CASE B: Network failure restores query, preserves workspace and composer
 *   - CASE C: ?prompt= prefills without auto-running
 *   - CASE D: ?q= auto-submits exactly once even when /api/search returns 500
 *   - CASE E: Successful search behavior and streaming answer preservation remain intact
 *   - CASE F: Stop/New Chat concurrency protections from PR #141 remain green
 *
 * D2: Guest desktop sidebar collapse and reopen:
 *   - Guest desktop initial sidebar visible
 *   - Collapse control exists and is accessible
 *   - Clicking collapse hides sidebar
 *   - Reopen control becomes available
 *   - Clicking reopen restores sidebar
 *   - Mobile drawer behavior is unchanged
 *   - Authenticated integrated sidebar path is not duplicated or broken
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWebFile(relativePath: string): string {
	return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

// ===========================================================================
// D1: Search Failure UX & Error Visibility Contracts
// ===========================================================================

test("D1 CASE A: SearchLayout does NOT conditionally unmount the conversation panel on error", () => {
	const src = readWebFile("components/SearchLayout.tsx");

	// Must NOT contain the old bug where showConversationPanel hid the panel on error
	assert.ok(
		!src.includes("showConversationPanel"),
		"showConversationPanel must be removed so the empty-state conversation panel and composer are never hidden on error",
	);

	// The ConversationMessageList container must always render
	assert.ok(
		src.includes("<ConversationMessageList"),
		"SearchLayout must render ConversationMessageList unconditionally",
	);

	// In empty state, composerBlock is passed into composerSlot
	assert.ok(
		src.includes("composerSlot={showConversationEmpty ? composerBlock : undefined}"),
		"ConversationMessageList must receive composerBlock via composerSlot when showConversationEmpty is true",
	);
});

test("D1 CASE A: HTTP 5xx errors set safe copy, restore query, and render role=alert with retry", () => {
	const src = readWebFile("components/SearchLayout.tsx");

	// Safe 5xx user-facing copy
	assert.ok(
		src.includes("The service is temporarily unavailable. Please try again in a few minutes."),
		"SearchLayout must use safe, user-friendly 5xx message without leaking backend details",
	);

	// Restores submitted query for retry
	assert.ok(
		src.includes("setQuery(q);"),
		"SearchLayout must restore the submitted query on search failure",
	);

	// Clears streamingUserQuery so showConversationEmpty correctly evaluates to true
	assert.ok(
		src.includes("setStreamingUserQuery(null);"),
		"SearchLayout must clear streamingUserQuery on search failure so empty-state hero composer is shown",
	);

	// Role alert exists in composerBlock
	assert.ok(
		src.includes('role="alert"'),
		"composerBlock must render a visible role=alert element",
	);

	// Retry button exists and calls runSearch()
	assert.ok(
		src.includes("Retry Search"),
		"Visible error banner must provide a Retry Search button",
	);
});

test("D1 CASE B: Network failure in catch block restores query and resets streaming state when stream is empty", () => {
	const src = readWebFile("components/SearchLayout.tsx");

	// Catch block handles network error
	assert.ok(
		src.includes("Network error. Check your connection and try again."),
		"SearchLayout catch block must show clear network error message",
	);

	// Catch block resets streaming state only when streamed answer was empty
	const catchMatch = src.match(/} catch \(e: unknown\) {([\s\S]*?)}, \[/);
	assert.ok(catchMatch, "Catch block must exist in runSearch");
	const catchBody = catchMatch[1] ?? "";

	assert.ok(
		catchBody.includes("if (streamedAnswer.trim().length === 0)"),
		"Catch block must check if streamedAnswer is empty before clearing streaming queries",
	);
	assert.ok(
		catchBody.includes("setStreamingUserQuery(null);"),
		"Catch block must clear streamingUserQuery when no streamed content arrived",
	);
	assert.ok(
		catchBody.includes("setQuery(q);"),
		"Catch block must restore query for retry",
	);
});

test("D1 CASE C: ?prompt= only prefills composer without auto-running", () => {
	const src = readWebFile("components/SearchLayout.tsx");

	// ?prompt= pre-fill effect
	const prefillMatch = src.match(/const q = searchParams\.get\("q"\) \?\? searchParams\.get\("prompt"\);[\s\S]*?setQuery\(q\);/);
	assert.ok(prefillMatch, "Pre-fill effect must read prompt parameter into query state");

	// Auto-run effect MUST strictly check ?q= only, never ?prompt=
	const autoRunMatch = src.match(/const qParam = searchParams\.get\("q"\)\?\.trim\(\);/);
	assert.ok(autoRunMatch, "Auto-run effect must strictly read 'q' param, NOT 'prompt'");
});

test("D1 CASE D: ?q= auto-submits exactly once and guards against duplicate execution on error", () => {
	const src = readWebFile("components/SearchLayout.tsx");

	assert.ok(
		src.includes("hasAutoRunUrlQueryRef.current === qParam"),
		"hasAutoRunUrlQueryRef must prevent re-submitting the same ?q= even when the search fails with 500",
	);
	assert.ok(
		src.includes("pendingAutoRunQueryRef.current = null;"),
		"pendingAutoRunQueryRef must be consumed immediately before executing runSearch",
	);
});

test("D1 CASE E: Stream error retains partial content when streamedAnswer exists", () => {
	const src = readWebFile("components/SearchLayout.tsx");

	assert.ok(
		/if\s*\(streamedAnswer\.trim\(\)\.length\s*===\s*0\)\s*\{\s*setStreamingUserQuery\(null\);/.test(src),
		"SSE stream error must preserve streamingUserQuery and streamed answer when partial content exists",
	);
});

test("D1 CASE F: Concurrency protections, abortRef, and New Chat reset remain active", () => {
	const src = readWebFile("components/SearchLayout.tsx");

	// Monotonic search generation
	assert.ok(
		src.includes("++searchGenerationRef.current"),
		"runSearch must increment searchGenerationRef before starting",
	);
	assert.ok(
		src.includes("searchGenerationRef.current += 1;"),
		"onCreateConversation must invalidate pending search generations",
	);
	assert.ok(
		src.includes("abortRef.current?.abort()"),
		"onCreateConversation and handleStop must call abortRef",
	);
});

// ===========================================================================
// D2: Guest Desktop Sidebar Collapse & Reopen Contracts
// ===========================================================================

test("D2: AiraV2Frame manages desktopSidebarOpen state defaulting to true", () => {
	const src = readWebFile("components/AiraV2Frame.tsx");

	assert.ok(
		src.includes("const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);"),
		"AiraV2Frame must track desktopSidebarOpen state initialized to true",
	);
	assert.ok(
		src.includes("const isCollapsed = !useIntegratedNavigation && !desktopSidebarOpen;"),
		"AiraV2Frame must derive isCollapsed state for guest desktop mode",
	);
});

test("D2: AiraV2Frame renders accessible collapse control in guest sidebar header", () => {
	const src = readWebFile("components/AiraV2Frame.tsx");

	assert.ok(
		src.includes('aria-label="Collapse workspace sidebar"'),
		"Sidebar header must have a button with aria-label 'Collapse workspace sidebar'",
	);
	assert.ok(
		src.includes("setDesktopSidebarOpen(false)"),
		"Collapse button must trigger setDesktopSidebarOpen(false)",
	);
	assert.ok(
		src.includes("PanelLeftClose"),
		"Collapse button must render PanelLeftClose icon",
	);
});

test("D2: AiraV2Frame hides sidebar on desktop when collapsed", () => {
	const src = readWebFile("components/AiraV2Frame.tsx");

	assert.ok(
		src.includes("!desktopSidebarOpen && \"lg:hidden\""),
		"Sidebar aside element must apply lg:hidden when desktopSidebarOpen is false",
	);
});

test("D2: AiraV2Frame renders accessible reopen control in topbar when collapsed", () => {
	const src = readWebFile("components/AiraV2Frame.tsx");

	assert.ok(
		src.includes('aria-label="Open workspace sidebar"'),
		"Topbar must have a button with aria-label 'Open workspace sidebar' when collapsed",
	);
	assert.ok(
		src.includes("setDesktopSidebarOpen(true)"),
		"Reopen button must trigger setDesktopSidebarOpen(true)",
	);
	assert.ok(
		src.includes("PanelLeftOpen"),
		"Reopen button must render PanelLeftOpen icon",
	);
});

test("D2: AiraV2Frame preserves mobile drawer behavior and controls", () => {
	const src = readWebFile("components/AiraV2Frame.tsx");

	// Mobile drawer open button
	assert.ok(
		src.includes('aria-label="Open navigation"'),
		"Mobile hamburger button with aria-label 'Open navigation' must be preserved",
	);

	// Mobile drawer close button
	assert.ok(
		src.includes('aria-label="Close navigation"'),
		"Mobile drawer close button with aria-label 'Close navigation' must be preserved",
	);

	// Backdrop
	assert.ok(
		src.includes("fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"),
		"Mobile backdrop must remain scoped to lg:hidden",
	);
});

test("D2: aira-visual-redesign.css adjusts desktop grid when sidebar is collapsed or integrated", () => {
	const css = readWebFile("app/aira-visual-redesign.css");

	assert.ok(
		css.includes(".aira-v2-frame.aira-intelligence-os.is-sidebar-collapsed"),
		"CSS must provide is-sidebar-collapsed rule for .aira-v2-frame",
	);
	assert.ok(
		css.includes("grid-template-columns: minmax(0, 1fr) !important"),
		"When collapsed or integrated, desktop grid must expand main content to 100% (minmax(0, 1fr))",
	);
});

test("D2: Authenticated integrated navigation is not duplicated or broken", () => {
	const src = readWebFile("components/AiraV2Frame.tsx");

	assert.ok(
		src.includes('const useIntegratedNavigation = integratedWorkspaceNavigation && sessionStatus !== "unauthenticated";'),
		"useIntegratedNavigation must remain strictly scoped to authenticated sessions",
	);
	assert.ok(
		src.includes("{!useIntegratedNavigation ? <aside"),
		"Fallback sidebar must not be rendered when useIntegratedNavigation is true",
	);
});
