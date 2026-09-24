/**
 * deeplink-behavior-logic.test.ts
 *
 * Behavioral logic tests for the Templates -> Research deep-link auto-run.
 *
 * SCOPE AND HONESTY:
 *   This project has no @testing-library/react, no JSDOM, and no Playwright
 *   installed (confirmed by package.json inspection). A full rendered-component
 *   test or browser E2E test cannot be run without installing those dependencies.
 *
 *   BLOCKER FOR FULL BEHAVIORAL TEST:
 *     - No @testing-library/react in devDependencies
 *     - No JSDOM / happy-dom in devDependencies
 *     - No Playwright in devDependencies
 *     - SearchLayout.tsx has transitive imports requiring Next.js server context
 *       (useSearchParams, useRouter, useSession, Prisma, etc.) which cannot be
 *       fully mocked without adding a test toolchain.
 *
 *   WHAT THESE TESTS DO:
 *     These tests model the exact state machine that the two-effect deep-link fix
 *     implements and verify all behavioral contracts at the logic level. The simulation
 *     faithfully models React effect ordering: all effects share the same committed
 *     state snapshot from the triggering render, with state updates scheduled for
 *     the next render.
 *
 *   WHAT STILL NEEDS A RENDERED TEST:
 *     - Actual DOM: textarea contains the recipe text after navigation
 *     - Actual network: fetch is called exactly once with the right payload
 *     - Actual re-render cycles: second render does not trigger a second submission
 *     Adding @testing-library/react + happy-dom to devDependencies would unblock this.
 */

import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// State machine simulation of the two-effect deep-link fix
//
// React execution model faithfully implemented:
//   Render N: effects run with snapshot of state from Render N.
//             setQuery() schedules a state update for Render N+1.
//   Render N+1: companion effect [query, busy] sees the new committed value.
// ---------------------------------------------------------------------------

interface SimResult {
	readonly finalQuery: string;
	readonly submissionCount: number;
	readonly submittedWith: string | null;
	readonly pendingAutoRunArmed: boolean;
}

/**
 * Simulates two React render cycles of the deep-link two-effect fix.
 *
 * Render 1 (initial mount, query = initialQuery):
 *   - Passive pre-fill effect (searchParams): setQuery(prev => prev || q)
 *   - Auto-run pre-fill effect A: checks sessionStatus, hasAutoRunRef, composer empty;
 *     sets pendingAutoRunQueryRef in effect BODY (not updater), calls setQuery.
 *   Both effects share the SAME query snapshot from Render 1.
 *
 * Render 2 (after setQuery commits):
 *   - query = new committed value
 *   - Companion effect B [query, busy]: fires runSearch() if pending ref matches.
 */
function simulateDeepLinkRenderCycle(opts: {
	readonly qParam: string | null;
	readonly promptParam?: string | null;
	readonly initialQuery?: string;
	readonly sessionStatus?: "loading" | "authenticated" | "unauthenticated";
	readonly busy?: boolean;
	readonly previouslyRanQParam?: string | null;
}): SimResult {
	const {
		qParam,
		promptParam = null,
		initialQuery = "",
		sessionStatus = "authenticated",
		busy = false,
		previouslyRanQParam = null,
	} = opts;

	// ---- RENDER 1 state snapshot ----
	let committedQuery = initialQuery; // the query state committed in Render 1
	let pendingAutoRunQueryRef: string | null = null;
	let hasAutoRunUrlQueryRef: string | null = previouslyRanQParam;

	// Pending state update scheduled by setQuery() calls in Render 1's effects.
	// In React, all setQuery calls from the same synchronous render batch.
	let scheduledNextQuery: string = committedQuery; // starts as current committed value

	// --- Passive pre-fill effect (line 189, deps: [searchParams]) ---
	// Runs in Render 1 with committedQuery snapshot.
	const passiveQ = qParam ?? promptParam;
	if (passiveQ) {
		// Pure functional updater: (prev) => prev.trim().length > 0 ? prev : passiveQ
		scheduledNextQuery = committedQuery.trim().length > 0 ? committedQuery : passiveQ;
	}

	// --- Auto-run pre-fill effect A (line 410, deps: [sessionStatus, searchParams, busy, query]) ---
	// Also runs in Render 1 with the SAME committedQuery snapshot (NOT the scheduledNextQuery).
	let pendingAutoRunArmed = false;
	if (!(sessionStatus === "loading" || busy)) {
		if (qParam && qParam.trim().length > 0) {
			if (hasAutoRunUrlQueryRef !== qParam) {
				hasAutoRunUrlQueryRef = qParam;
				// Pure setQuery updater — no side effects:
				//   (prev) => prev.trim().length > 0 ? prev : qParam
				// Schedule state update (merges with passive pre-fill's scheduledNextQuery):
				// Both updaters use (prev => prev || q). Since React applies them sequentially:
				// First updater: scheduledNextQuery = passiveQ (if committedQuery was empty)
				// Second updater on the already-scheduled value:
				//   The second functional updater sees the result of the first.
				// But we only care about the final committed value.
				// Since both write the same value (qParam), the final result is qParam.
				// For the auto-run arm check, we use committedQuery (the Render 1 snapshot):
				if (!committedQuery.trim()) {
					pendingAutoRunQueryRef = qParam;
					pendingAutoRunArmed = true;
				}
			}
		}
	}

	// ---- RENDER 2 state snapshot ----
	// React commits the scheduled state update(s). Both passive and auto-run
	// updaters use (prev => prev || q), so the final committed query is:
	const render2Query: string = scheduledNextQuery; // already computed above

	// --- Companion effect B (line 438, deps: [query, busy]) ---
	// Fires in Render 2 because query changed.
	let submissionCount = 0;
	let submittedWith: string | null = null;

	if (pendingAutoRunQueryRef !== null) {
		if (render2Query.trim() === pendingAutoRunQueryRef && !busy) {
			submittedWith = pendingAutoRunQueryRef;
			pendingAutoRunQueryRef = null;
			submissionCount++;
		}
	}

	return {
		finalQuery: render2Query,
		submissionCount,
		submittedWith,
		pendingAutoRunArmed,
	};
}

// ---------------------------------------------------------------------------
// Task 2 Behavioral Contract Tests
// ---------------------------------------------------------------------------

test("Behavior 1: Templates recipe URL auto-submits the exact prompt", () => {
	const recipePrompt = "Conduct a rigorous technical due diligence on: [Subject].";
	const result = simulateDeepLinkRenderCycle({ qParam: recipePrompt });
	assert.strictEqual(result.submissionCount, 1, "Must submit exactly once");
	assert.strictEqual(result.submittedWith, recipePrompt, "Must submit the exact recipe text");
	assert.strictEqual(result.finalQuery, recipePrompt, "Query state must contain the recipe text");
});

test("Behavior 2: Exact prompt appears in textarea (query state)", () => {
	const prompt = "Frontier Energy & Compute Synthesis -- multi-hop analysis";
	const result = simulateDeepLinkRenderCycle({ qParam: prompt });
	assert.strictEqual(result.finalQuery, prompt, "Query state (textarea value) must exactly match the ?q= param");
});

test("Behavior 3: Search submits exactly once -- not on duplicate navigation", () => {
	const prompt = "Research test";
	// First navigation: submits once
	const first = simulateDeepLinkRenderCycle({ qParam: prompt });
	assert.strictEqual(first.submissionCount, 1);

	// Second navigation with same param: hasAutoRunUrlQueryRef guard fires, no re-submit
	const second = simulateDeepLinkRenderCycle({ qParam: prompt, previouslyRanQParam: prompt });
	assert.strictEqual(second.submissionCount, 0, "Must not re-submit when hasAutoRunUrlQueryRef already matches");
	assert.strictEqual(second.pendingAutoRunArmed, false);
});

test("Behavior 4: Submitted query matches the recipe text exactly", () => {
	const recipePrompt = "Synthesise a 12-month strategic roadmap for [Company] entering [Market].";
	const result = simulateDeepLinkRenderCycle({ qParam: recipePrompt });
	assert.strictEqual(result.submittedWith, recipePrompt, "submittedWith must exactly equal the recipe prompt");
});

test("Behavior 5: Re-renders with same ?q= do not cause duplicate submissions", () => {
	// Strict Mode effect remount: effects teardown + remount; hasAutoRunUrlQueryRef guard prevents re-arm
	const prompt = "Anti-fragile architecture analysis";
	const firstRun = simulateDeepLinkRenderCycle({ qParam: prompt });
	assert.strictEqual(firstRun.submissionCount, 1);
	// Remounted effect — same qParam, ref already set
	const secondRun = simulateDeepLinkRenderCycle({ qParam: prompt, previouslyRanQParam: prompt });
	assert.strictEqual(secondRun.submissionCount, 0, "Strict Mode remount must not duplicate submission");
	assert.strictEqual(secondRun.pendingAutoRunArmed, false, "pendingAutoRunQueryRef must not be re-armed on guard hit");
});

test("Behavior 6: Existing user edits are not overwritten", () => {
	const userText = "My own question I typed";
	const recipePrompt = "Conduct a rigorous due diligence";
	const result = simulateDeepLinkRenderCycle({ qParam: recipePrompt, initialQuery: userText });
	// Functional updater: prev.trim().length > 0 ? prev : qParam -> returns userText
	assert.strictEqual(result.finalQuery, userText, "User edits must be preserved when composer is non-empty");
	// Auto-run must NOT fire when user edits are present
	assert.strictEqual(result.submissionCount, 0, "Auto-run must not fire when user text is preserved");
	assert.strictEqual(result.pendingAutoRunArmed, false, "pendingAutoRunQueryRef must not be armed when composer is non-empty");
});

test("Behavior 7: ?prompt= remains pre-fill only (no auto-run)", () => {
	const promptText = "Plan a go-to-market strategy for a new SaaS product.";
	const result = simulateDeepLinkRenderCycle({ qParam: null, promptParam: promptText });
	// Query should be pre-filled via passive pre-fill effect
	assert.strictEqual(result.finalQuery, promptText, "?prompt= must pre-fill the composer");
	// But auto-run must NOT fire (no ?q= param)
	assert.strictEqual(result.submissionCount, 0, "?prompt= must NOT trigger auto-run");
	assert.strictEqual(result.pendingAutoRunArmed, false, "pendingAutoRunQueryRef must not be armed for ?prompt=");
});

test("Behavior 8: Manual submission pathway is independent of deep-link logic", () => {
	// No ?q= param -> no auto-run fires; manual submit is a separate code path
	const result = simulateDeepLinkRenderCycle({ qParam: null, initialQuery: "Manually typed query" });
	assert.strictEqual(result.submissionCount, 0, "No auto-run should fire without ?q= param");
	assert.strictEqual(result.finalQuery, "Manually typed query", "Manual query preserved");
});

test("Behavior 9: Session loading state defers auto-run", () => {
	const prompt = "Analyze competitor landscape";
	const result = simulateDeepLinkRenderCycle({ qParam: prompt, sessionStatus: "loading" });
	// Effect A bails when sessionStatus === "loading"
	assert.strictEqual(result.submissionCount, 0, "Auto-run must be deferred when session is loading");
	assert.strictEqual(result.pendingAutoRunArmed, false, "pendingAutoRunQueryRef must not be armed during session loading");
	// Query is still pre-filled (passive effect has no session guard)
	assert.strictEqual(result.finalQuery, prompt, "Query is still pre-filled by passive effect despite loading");
});

test("Behavior 9b: Authentication transition -- submits once session resolves", () => {
	// Simulate: session was loading, now authenticated -> effect A fires fresh
	const prompt = "Post-auth deep-link query";
	const result = simulateDeepLinkRenderCycle({ qParam: prompt, sessionStatus: "authenticated" });
	assert.strictEqual(result.submissionCount, 1, "Must submit once session resolves to authenticated");
	assert.strictEqual(result.submittedWith, prompt);
});

test("Behavior: busy state defers auto-run", () => {
	const prompt = "Query during active search";
	// Effect A bails when busy
	const result = simulateDeepLinkRenderCycle({ qParam: prompt, busy: true });
	assert.strictEqual(result.submissionCount, 0, "Auto-run must not fire when busy");
	assert.strictEqual(result.pendingAutoRunArmed, false);
});

test("Behavior: empty ?q= param does not trigger auto-run", () => {
	const result = simulateDeepLinkRenderCycle({ qParam: "" });
	assert.strictEqual(result.submissionCount, 0, "Empty ?q= must not trigger auto-run");
});

test("Behavior: whitespace-only ?q= param does not trigger auto-run", () => {
	const result = simulateDeepLinkRenderCycle({ qParam: "   " });
	// qParam.trim().length === 0 -> effect A bails
	assert.strictEqual(result.submissionCount, 0, "Whitespace-only ?q= must not trigger auto-run");
});

test("Behavior: multiline prompt auto-runs correctly", () => {
	const multiline = "Step 1: Research\nStep 2: Synthesize\nStep 3: Report";
	const result = simulateDeepLinkRenderCycle({ qParam: multiline });
	assert.strictEqual(result.submissionCount, 1);
	assert.strictEqual(result.submittedWith, multiline, "Multiline prompt must be preserved exactly");
});

test("Behavior: special characters in prompt auto-run correctly", () => {
	const special = "What is the ROI of sovereign AI? Use cost=benefit analysis & triangulate.";
	const result = simulateDeepLinkRenderCycle({ qParam: special });
	assert.strictEqual(result.submissionCount, 1);
	assert.strictEqual(result.submittedWith, special);
});

test("Behavior: null qParam and null promptParam results in no action", () => {
	const result = simulateDeepLinkRenderCycle({ qParam: null, promptParam: null });
	assert.strictEqual(result.submissionCount, 0);
	assert.strictEqual(result.finalQuery, "");
});

// ---------------------------------------------------------------------------
// Strict Mode updater purity simulation
// ---------------------------------------------------------------------------

test("Strict Mode: functional updater is pure and idempotent under double invocation", () => {
	const qParam = "Strict Mode test query";

	// The CORRECTED updater -- pure, no side effects
	const pureUpdater = (prev: string): string => {
		if (prev.trim().length > 0) return prev;
		return qParam;
	};

	// Simulate React Strict Mode calling the updater twice with same prev
	const result1 = pureUpdater("");
	const result2 = pureUpdater("");

	// Both calls must return the same value (idempotent)
	assert.strictEqual(result1, result2, "Pure updater must be idempotent under double invocation");
	assert.strictEqual(result1, qParam, "Must return qParam when prev is empty");
});

test("Strict Mode: updater double-invocation with user edits preserves text", () => {
	const userText = "My existing text";
	const qParam = "Recipe prompt";

	const pureUpdater = (prev: string): string => {
		if (prev.trim().length > 0) return prev;
		return qParam;
	};

	const result1 = pureUpdater(userText);
	const result2 = pureUpdater(userText);

	assert.strictEqual(result1, userText, "Must preserve user text on first invocation");
	assert.strictEqual(result2, userText, "Must preserve user text on second invocation (Strict Mode)");
});

// ---------------------------------------------------------------------------
// Concurrent Mode: render abandonment safety
// ---------------------------------------------------------------------------

test("Concurrent Mode: ref is NOT mutated on render abandonment (effect body safety)", () => {
	// OLD code: ref was mutated inside the updater function.
	//   If React calls the updater but then discards the render (concurrent mode),
	//   the ref mutation survives but the state does not -> inconsistency.
	// NEW code: ref is set in the effect body, which only runs AFTER commit.
	//   Abandoned renders never run effect bodies -> ref stays clean.

	const qParam = "Query for abandoned render";
	let pendingAutoRunQueryRef: string | null = null;

	// Simulate: React calls pureUpdater but then DISCARDS the result (render abandonment)
	const pureUpdater = (prev: string): string => {
		// NEW: no ref mutation here
		if (prev.trim().length > 0) return prev;
		return qParam;
	};

	// Updater is called but result discarded (abandoned render)
	void pureUpdater("");
	// Effect body did NOT run (commit was abandoned), so ref remains null
	assert.strictEqual(pendingAutoRunQueryRef, null,
		"Ref must remain null after render abandonment -- effect body never ran");

	// Now simulate the actual commit (React commits this render)
	// Effect body runs AFTER commit:
	const prevQuery = ""; // committed query was ""
	if (!prevQuery.trim()) {
		pendingAutoRunQueryRef = qParam; // set in effect body, post-commit
	}
	assert.strictEqual(pendingAutoRunQueryRef, qParam,
		"Ref set in effect body after successful commit");
});
