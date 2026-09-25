/**
 * conversation-stabilization-contract.test.ts
 *
 * Deterministic contract tests for the 10 UI/UX and conversation stabilization areas:
 * 1. New Chat during active research / streaming request lifecycle
 * 2. Slow research experience & cancellation controls
 * 3. Desktop conversation width & reading measure
 * 4. Sources panel responsiveness & space efficiency (desktop collapse, mobile sheet)
 * 5. Mobile UI completely fixed (320px-768px, zero horizontal overflow)
 * 6. Model selector clipping fixed on desktop and mobile
 * 7. One-click floating scroll-to-bottom downward arrow
 * 8. Composer stability (typing during streaming, stop control, textarea bounds)
 * 9. Real cross-device verification & responsive layouts
 * 10. Regression protection (preserve PR #140 deep-link fixes, PR #139 isolation, provider routing, auth/billing)
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

// ---------------------------------------------------------------------------
// 1. New Chat During Active Research
// ---------------------------------------------------------------------------

test("SearchLayout: onCreateConversation is NOT blocked when busy", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	// Should not have if (busy) return; at the start of onCreateConversation
	const onCreateMatch = src.match(/const onCreateConversation = useCallback\(async \(\) => {([\s\S]*?)}, \[/);
	assert.ok(onCreateMatch, "onCreateConversation must be defined");
	const onCreateBody = onCreateMatch[1] ?? "";
	assert.ok(
		!onCreateBody.includes("if (busy) return;"),
		"onCreateConversation must not be blocked when busy",
	);
});

test("SearchLayout: onCreateConversation aborts in-flight request and resets phase to idle", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	const onCreateMatch = src.match(/const onCreateConversation = useCallback\(async \(\) => {([\s\S]*?)}, \[/);
	assert.ok(onCreateMatch, "onCreateConversation must be defined");
	const onCreateBody = onCreateMatch[1] ?? "";
	assert.ok(
		onCreateBody.includes("abortRef.current?.abort()"),
		"onCreateConversation must abort in-flight fetch/reader",
	);
	assert.ok(
		onCreateBody.includes('setPhase("idle")'),
		"onCreateConversation must reset phase to idle",
	);
	assert.ok(
		onCreateBody.includes("setMessages([])"),
		"onCreateConversation must clear previous messages",
	);
	assert.ok(
		onCreateBody.includes("setSelectedConversationId(null)"),
		"onCreateConversation must clear selectedConversationId",
	);
});

test("SearchLayout: listens to aira:new-chat event to handle New Chat globally", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes('window.addEventListener("aira:new-chat"'),
		"SearchLayout must register aira:new-chat event listener",
	);
});

test("AiraV2Frame: New Chat button dispatches aira:new-chat event", () => {
	const src = readWebFile("components/AiraV2Frame.tsx");
	assert.ok(
		src.includes('window.dispatchEvent(new CustomEvent("aira:new-chat"))'),
		"AiraV2Frame New Chat button must dispatch aira:new-chat event",
	);
});

test("ConversationSidebar: New conversation button is not disabled when busy", () => {
	const src = readWebFile("components/conversations/ConversationSidebar.tsx");
	const btnMatch = src.match(/<button[\s\S]*?className="aira-new-chat[\s\S]*?>/);
	assert.ok(btnMatch, "New conversation button must exist in ConversationSidebar");
	assert.ok(
		!btnMatch[0].includes("disabled={disabled}"),
		"New conversation button must remain enabled during busy state",
	);
});

test("SearchLayout: onSelectConversation aborts active research before switching threads", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	const selectMatch = src.match(/const onSelectConversation = useCallback\(\s*async \(id: string\) => {([\s\S]*?)},/);
	assert.ok(selectMatch, "onSelectConversation must be defined");
	const selectBody = selectMatch[1] ?? "";
	assert.ok(
		selectBody.includes("abortRef.current?.abort()"),
		"onSelectConversation must abort active research when switching conversations",
	);
});

// ---------------------------------------------------------------------------
// 2. Slow Research Experience & Live Timer & Stop Controls
// ---------------------------------------------------------------------------

test("AiraNeuralDeliberation: displays live elapsed seconds and exposes Stop control", () => {
	const src = readWebFile("components/AiraNeuralDeliberation.tsx");
	assert.ok(
		src.includes("(elapsedMs / 1000).toFixed(1)"),
		"AiraNeuralDeliberation must format live elapsed seconds",
	);
	assert.ok(
		src.includes("onCancel?: () => void"),
		"AiraNeuralDeliberation must declare onCancel prop",
	);
	assert.ok(
		src.includes("aria-label=\"Stop research\""),
		"AiraNeuralDeliberation must provide Stop research accessible control",
	);
});

test("SearchLayout: computes live elapsedMs while busy", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("setElapsedMs(Date.now() - startTime)"),
		"SearchLayout must track elapsedMs using interval",
	);
});

test("SearchBox: renders Stop button when isBusy is true and onCancel is provided", () => {
	const src = readWebFile("components/SearchBox.tsx");
	assert.ok(
		src.includes("aria-label=\"Stop research\""),
		"SearchBox must render accessible Stop research button",
	);
	assert.ok(
		src.includes("onClick={onCancel}"),
		"SearchBox Stop button must trigger onCancel",
	);
});

// ---------------------------------------------------------------------------
// 3 & 4. Desktop Conversation Width & Sources Panel Responsiveness
// ---------------------------------------------------------------------------

test("ConversationMessageList: exposes sources toggle with count badge and collapsible inspector", () => {
	const src = readWebFile("components/conversations/ConversationMessageList.tsx");
	assert.ok(
		src.includes("desktopSourcesOpen?: boolean"),
		"ConversationMessageList must accept desktopSourcesOpen prop",
	);
	assert.ok(
		src.includes("onToggleDesktopSources?: () => void"),
		"ConversationMessageList must accept onToggleDesktopSources prop",
	);
	assert.ok(
		src.includes("xl:grid-cols-[minmax(0,1fr)_320px]"),
		"ConversationMessageList must adapt grid columns based on sources open state",
	);
	assert.ok(
		src.includes("max-w-4xl"),
		"ConversationMessageList must expand reading measure up to max-w-4xl when sources are collapsed",
	);
});

test("SearchLayout: renders mobile sources sheet when mobileSourcesOpen is true", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("mobileSourcesOpen"),
		"SearchLayout must manage mobileSourcesOpen state",
	);
	assert.ok(
		src.includes("aria-label=\"Research sources\""),
		"SearchLayout must render accessible Research sources sheet on mobile",
	);
});

// ---------------------------------------------------------------------------
// 5. Mobile UI Zero Horizontal Overflow
// ---------------------------------------------------------------------------

test("aira-visual-redesign.css: aira-v2-frame is flex on mobile and grid only on lg (min-width: 1024px)", () => {
	const css = readWebFile("app/aira-visual-redesign.css");
	assert.ok(
		css.includes(".aira-v2-frame.aira-intelligence-os"),
		"aira-v2-frame class must be styled",
	);
	assert.ok(
		css.includes("@media (min-width: 1024px)"),
		"Rail grid must be guarded by media query for desktop only",
	);
	assert.ok(
		css.includes("max-width: 100vw !important"),
		"aira-v2-frame must clamp max-width to viewport on mobile",
	);
});

test("SearchLayout: mobile sticky composer does not use overflowing negative margins", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	// Should use w-full max-w-full instead of -mx-4
	assert.ok(
		!src.includes("sticky bottom-0 z-20 -mx-4"),
		"Mobile sticky composer must not use -mx-4 which overflows viewports",
	);
	assert.ok(
		src.includes("sticky bottom-0 z-20 w-full max-w-full"),
		"Mobile sticky composer must be contained within w-full max-w-full",
	);
});

// ---------------------------------------------------------------------------
// 6. Model Selector Clipping & Responsive Positioning
// ---------------------------------------------------------------------------

test("SearchBox: model selector handles both desktop popover and mobile sheet", () => {
	const src = readWebFile("components/SearchBox.tsx");
	assert.ok(
		src.includes("hidden sm:block absolute"),
		"SearchBox must render bounded popover on desktop",
	);
	assert.ok(
		src.includes("fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm sm:hidden"),
		"SearchBox must render dedicated bottom modal sheet on mobile",
	);
});

// ---------------------------------------------------------------------------
// 7. Floating Scroll-To-Bottom Downward Arrow
// ---------------------------------------------------------------------------

test("SearchLayout: floating scroll-to-bottom button appears on scroll and respects reduced motion", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("aria-label=\"Scroll to latest message\""),
		"SearchLayout must render floating scroll-to-bottom button with accessible label",
	);
	assert.ok(
		src.includes("prefers-reduced-motion"),
		"SearchLayout scroll-to-bottom must respect reduced motion preference",
	);
	assert.ok(
		src.includes("distanceFromBottom > 150"),
		"SearchLayout must toggle scroll-to-bottom button visibility based on scroll distance",
	);
});

// ---------------------------------------------------------------------------
// 8. Composer Usability During Active Streaming
// ---------------------------------------------------------------------------

test("SearchLayout: composer does not disable textarea during active research", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	const composerMatch = src.match(/<SearchBox[\s\S]*?\/>/);
	assert.ok(composerMatch, "SearchBox must be rendered in SearchLayout");
	assert.ok(
		composerMatch[0].includes("disabled={false}"),
		"SearchBox textarea must not be disabled during busy state so user can type follow-ups",
	);
});

// ---------------------------------------------------------------------------
// 9. Markdown Components Overflow Protection
// ---------------------------------------------------------------------------

test("markdownComponents: tables and pre blocks are wrapped in overflow-x-auto", () => {
	const src = readWebFile("components/markdownComponents.tsx");
	assert.ok(
		src.includes("max-w-full overflow-x-auto rounded-lg"),
		"markdownComponents must wrap tables in overflow-x-auto container",
	);
	assert.ok(
		src.includes("max-w-full overflow-x-auto rounded-xl"),
		"markdownComponents must wrap code pre blocks in overflow-x-auto container",
	);
});

// ---------------------------------------------------------------------------
// 10. Regression Protection: PR #140 Deep Link Invariants Intact
// ---------------------------------------------------------------------------

test("SearchLayout: PR #140 deep-link pre-fill and auto-run refs remain intact", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("hasAutoRunUrlQueryRef"),
		"hasAutoRunUrlQueryRef must exist for duplicate auto-run prevention",
	);
	assert.ok(
		src.includes("pendingAutoRunQueryRef"),
		"pendingAutoRunQueryRef must exist for race-free submission",
	);
});

// ---------------------------------------------------------------------------
// 11. Concurrency Safety: Generation Tokens & Race-Condition Guards (Gate 2)
// ---------------------------------------------------------------------------

test("SearchLayout: monotonic generation tokens guard request and selection lifecycles", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("const searchGenerationRef = useRef(0);"),
		"searchGenerationRef must track active search generation",
	);
	assert.ok(
		src.includes("const conversationSelectionGenerationRef = useRef(0);"),
		"conversationSelectionGenerationRef must track active conversation selection",
	);
});

test("SearchLayout: onCreateConversation invalidates generation tokens and aborts active requests", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	const match = src.match(/const onCreateConversation = useCallback\(async \(\) => {([\s\S]*?)}, \[router\]\);/);
	assert.ok(match, "onCreateConversation must be defined");
	const body = match[1] ?? "";
	assert.ok(
		body.includes("searchGenerationRef.current += 1;"),
		"onCreateConversation must advance searchGenerationRef to cancel in-flight search callbacks",
	);
	assert.ok(
		body.includes("conversationSelectionGenerationRef.current += 1;"),
		"onCreateConversation must advance conversationSelectionGenerationRef",
	);
	assert.ok(
		body.includes("abortRef.current?.abort()"),
		"onCreateConversation must abort active network fetch",
	);
});

test("SearchLayout: runSearch initializes AbortController and generation token before conversation creation", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	const runSearchIdx = src.indexOf("const runSearch = useCallback");
	const createConvIdx = src.indexOf("await createConversation(q, controller.signal, currentGeneration)", runSearchIdx);
	const controllerInitIdx = src.indexOf("const controller = new AbortController();", runSearchIdx);
	const genInitIdx = src.indexOf("const currentGeneration = ++searchGenerationRef.current;", runSearchIdx);

	assert.ok(runSearchIdx > 0, "runSearch must exist");
	assert.ok(controllerInitIdx > 0, "AbortController must be instantiated in runSearch");
	assert.ok(genInitIdx > 0, "currentGeneration must be incremented in runSearch");
	assert.ok(createConvIdx > 0, "createConversation must receive controller.signal and currentGeneration");
	assert.ok(
		controllerInitIdx < createConvIdx,
		"AbortController must be assigned BEFORE createConversation is awaited",
	);
	assert.ok(
		genInitIdx < createConvIdx,
		"Generation token must be assigned BEFORE createConversation is awaited",
	);
});

test("SearchLayout: catch block rejects stale AbortError and errors from previous generations", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		/if\s*\(currentGeneration\s*!==\s*searchGenerationRef\.current\)\s*{\s*return;\s*}/.test(src),
		"Catch block must verify currentGeneration === searchGenerationRef.current before modifying state",
	);
});

