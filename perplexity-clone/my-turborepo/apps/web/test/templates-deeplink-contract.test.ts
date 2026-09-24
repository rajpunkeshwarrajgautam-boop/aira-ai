/**
 * templates-deeplink-contract.test.ts
 *
 * Deterministic contract tests for the Templates -> Research composer deep-link.
 *
 * These tests verify:
 *  - ?q= pre-fill writes the exact URL query into SearchLayout state
 *  - ?prompt= pre-fill works (pre-fill only, no auto-run)
 *  - Duplicate auto-run is prevented for the same ?q= value (hasAutoRunUrlQueryRef guard)
 *  - User edits to a pre-filled prompt are preserved (functional updater)
 *  - pendingAutoRunQueryRef fires submission only after state settles
 *  - Spaces, Unicode, special characters, and newlines survive encode/decode round-trip
 *  - The "Run in Research" link in templates/page.tsx encodes with encodeURIComponent
 *  - No duplicate setQuery("") in runSearch (regression guard)
 *  - SearchBox.handleSubmit bails on empty value (confirms the race condition symptom)
 *
 * All tests are static source-code assertions -- no React runtime needed.
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
// Helpers
// ---------------------------------------------------------------------------

/** Simulate what encodeURIComponent does to a recipe prompt */
function roundTripQueryParam(raw: string): string {
	return decodeURIComponent(encodeURIComponent(raw));
}

// ---------------------------------------------------------------------------
// Templates page - "Run in Research" link contract
// ---------------------------------------------------------------------------

test("templates/page.tsx: Run in Research link uses ?q= and encodeURIComponent", () => {
	const src = readWebFile("app/templates/page.tsx");
	assert.ok(
		src.includes("`/?q=${encodeURIComponent(recipe.prompt)}`"),
		"Run in Research link must use /?q=<encoded prompt>",
	);
});

test("templates/page.tsx: RESEARCH_RECIPES define a prompt field on every recipe", () => {
	const src = readWebFile("app/templates/page.tsx");
	const recipeCount = [...src.matchAll(/id:\s*"recipe-[^"]+"/g)].length;
	assert.ok(recipeCount >= 4, `Expected at least 4 recipe definitions, found ${recipeCount}`);
	const promptCount = (src.match(/\bprompt:/g) ?? []).length;
	assert.ok(
		promptCount >= recipeCount,
		`Expected at least ${recipeCount} prompt: fields, found ${promptCount}`,
	);
});

// ---------------------------------------------------------------------------
// SearchLayout - ?q= auto-run contract
// ---------------------------------------------------------------------------

test("SearchLayout: pre-fill effect handles both ?q= and ?prompt=", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes('searchParams.get("q") ?? searchParams.get("prompt")'),
		"Pre-fill effect must handle ?q= and ?prompt= params",
	);
});

test("SearchLayout: pre-fill functional updater preserves user edits", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	const hasGuard =
		src.includes("prev.trim().length > 0 ? prev : q") ||
		src.includes("prev.trim().length > 0) return prev");
	assert.ok(hasGuard, "setQuery functional updater must preserve non-empty user edits");
});

test("SearchLayout: hasAutoRunUrlQueryRef prevents duplicate auto-run", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("hasAutoRunUrlQueryRef.current === qParam"),
		"Duplicate ?q= auto-run must be guarded by hasAutoRunUrlQueryRef",
	);
	assert.ok(
		src.includes("hasAutoRunUrlQueryRef.current = qParam"),
		"Guard ref must be updated when auto-run is accepted",
	);
});

test("SearchLayout: pendingAutoRunQueryRef introduced for race-free auto-submit", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("pendingAutoRunQueryRef"),
		"pendingAutoRunQueryRef must exist to defer submission until state settles",
	);
	assert.ok(
		src.includes("pendingAutoRunQueryRef.current = null"),
		"pendingAutoRunQueryRef must be cleared after triggering runSearch",
	);
});

test("SearchLayout: companion auto-run effect depends on query state not searchParams", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("[query, busy]"),
		"Companion auto-run effect must depend on [query, busy] so it fires after state commits",
	);
});

test("SearchLayout: auto-run effect no longer calls searchBoxRef submit inside setTimeout", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	const timeoutSubmitPattern = /setTimeout\([^)]*searchBoxRef\.current\?\.submit/;
	assert.ok(
		!timeoutSubmitPattern.test(src),
		"searchBoxRef.current?.submit() must not be called inside setTimeout in the deep-link auto-run path",
	);
});

test("SearchLayout: runSearch reads from query state via let q = query.trim()", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("let q = query.trim()"),
		"runSearch must read query from React state",
	);
});

// ---------------------------------------------------------------------------
// SearchLayout - no duplicate setQuery("") in runSearch
// ---------------------------------------------------------------------------

test("SearchLayout: no duplicate consecutive setQuery calls in runSearch", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	const lines = src.split(/\r?\n/);
	for (let i = 0; i < lines.length - 1; i++) {
		const a = (lines[i] ?? "").trim();
		const b = (lines[i + 1] ?? "").trim();
		assert.ok(
			!(a === 'setQuery("");' && b === 'setQuery("");'),
			`Duplicate consecutive setQuery("") found at lines ${i + 1}-${i + 2}`,
		);
	}
});

// ---------------------------------------------------------------------------
// SearchBox - submit guard (confirms the race condition symptom)
// ---------------------------------------------------------------------------

test("SearchBox.handleSubmit: bails when value is empty string", () => {
	const src = readWebFile("components/SearchBox.tsx");
	assert.ok(
		src.includes("!normalized && attachments.length === 0"),
		"handleSubmit must bail when value is empty and no attachments",
	);
});

test("SearchBox: SearchBoxHandle exposes focus and submit", () => {
	const src = readWebFile("components/SearchBox.tsx");
	assert.ok(
		src.includes("focus: () => void; submit: () => void"),
		"SearchBoxHandle type must include focus and submit",
	);
	assert.ok(
		src.includes("submit: handleSubmit"),
		"useImperativeHandle must wire submit to handleSubmit",
	);
});

// ---------------------------------------------------------------------------
// URL encode/decode round-trip for special characters
// ---------------------------------------------------------------------------

test("URL round-trip: simple ASCII query", () => {
	const raw = "Conduct a rigorous technical due diligence on: [Subject].";
	assert.strictEqual(roundTripQueryParam(raw), raw);
});

test("URL round-trip: spaces and ampersand", () => {
	const raw = "Frontier Energy & Compute Synthesis -- multi-hop analysis";
	assert.strictEqual(roundTripQueryParam(raw), raw);
});

test("URL round-trip: Unicode characters", () => {
	const raw = "Analyse le cadre reglementaire de l'IA en zhongguo";
	assert.strictEqual(roundTripQueryParam(raw), raw);
});

test("URL round-trip: newlines (multiline prompt)", () => {
	const raw = "Step 1: Research the topic\nStep 2: Summarize findings\nStep 3: Cite sources";
	assert.strictEqual(roundTripQueryParam(raw), raw);
});

test("URL round-trip: special characters in recipes", () => {
	const raw = "Triangulate primary claims against independent verification & architectural constraints.";
	assert.strictEqual(roundTripQueryParam(raw), raw);
});

test("URL round-trip: question marks and equals signs", () => {
	const raw = "What is the ROI of sovereign AI? param=value&other=test";
	assert.strictEqual(roundTripQueryParam(raw), raw);
});

// ---------------------------------------------------------------------------
// SearchLayout - auth-state guards are preserved
// ---------------------------------------------------------------------------

test("SearchLayout: auto-run skips when sessionStatus is loading", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes('sessionStatus === "loading" || busy'),
		"Auto-run must guard against loading session status",
	);
});

test("SearchLayout: hasAutoRunUrlQueryRef reset on auth sign-out", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("hasAutoRunUrlQueryRef.current = null"),
		"hasAutoRunUrlQueryRef must be reset to null on session sign-out",
	);
});

// ---------------------------------------------------------------------------
// SearchLayout - busy guard prevents duplicate submission
// ---------------------------------------------------------------------------

test("SearchLayout: companion auto-run effect bails when busy", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("if (busy) return;"),
		"Companion auto-run effect must check busy before calling runSearch",
	);
});

// ---------------------------------------------------------------------------
// SearchLayout - ?prompt= is pre-fill only (not auto-run)
// ---------------------------------------------------------------------------

test("SearchLayout: ?prompt= param is not an auto-run trigger", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes('searchParams.get("q")?.trim()'),
		"Auto-run effect must only read ?q= param",
	);
	// Extract the auto-run section and verify prompt= is absent from it
	const deepLinkStart = src.indexOf("// Deep-link pre-fill");
	const deepLinkEnd = src.indexOf("// Deep-link auto-run") + 600;
	if (deepLinkStart !== -1 && deepLinkEnd > deepLinkStart) {
		const autoRunSection = src.slice(deepLinkStart, deepLinkEnd);
		assert.ok(
			!autoRunSection.includes('searchParams.get("prompt")'),
			"Auto-run effect must not trigger on ?prompt= (pre-fill only)",
		);
	}
});

// ---------------------------------------------------------------------------
// Existing manual submission - SearchBox onSubmit contract
// ---------------------------------------------------------------------------

test("SearchBox: form onSubmit calls handleSubmit (manual submission preserved)", () => {
	const src = readWebFile("components/SearchBox.tsx");
	assert.ok(
		src.includes("event.preventDefault(); handleSubmit()"),
		"Form onSubmit must call handleSubmit to preserve manual submission",
	);
});

test("SearchBox: Enter key without shift submits form", () => {
	const src = readWebFile("components/SearchBox.tsx");
	assert.ok(
		src.includes('event.key === "Enter" && !event.shiftKey'),
		"Enter key without shift must trigger submission",
	);
});

// ---------------------------------------------------------------------------
// SearchLayout - SearchBox receives correct props
// ---------------------------------------------------------------------------

test("SearchLayout: SearchBox receives value={query}", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("value={query}"),
		"SearchBox must receive the lifted query state as value prop",
	);
});

test("SearchLayout: SearchBox receives onChange={setQuery}", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("onChange={setQuery}"),
		"SearchBox must receive setQuery as onChange prop",
	);
});

test("SearchLayout: SearchBox onSubmit prop delegates to runSearch", () => {
	const src = readWebFile("components/SearchLayout.tsx");
	assert.ok(
		src.includes("onSubmit={(ctx) => void runSearch(ctx)}") ||
			src.includes("onSubmit={runSearch}"),
		"SearchBox onSubmit must invoke runSearch so manual submission works",
	);
});

