import assert from "node:assert/strict";
import test from "node:test";

import {
	normalizeModelCitations,
	sanitizeRemainingPublicationViolations,
	stripStateContradictionLines,
	validatePublicationCandidate,
	type PublicationMessageLike,
	type PublicationViolation,
} from "../src/services/publication-guard";

interface ContextParts {
	readonly question?: string;
	readonly durableState?: string;
	readonly evidence?: readonly { readonly index: number; readonly title: string; readonly body: string }[];
}

/** Builds the private verifier context in the layout the guard parses. */
function verifierMessages(parts: ContextParts): PublicationMessageLike[] {
	const evidence = (parts.evidence ?? [])
		.map((block) => `### [${block.index}] ${block.title}\n${block.body}`)
		.join("\n\n");
	const content = [
		`## User question\n${parts.question ?? "What should I do?"}`,
		`## Durable user state\n${parts.durableState ?? ""}`,
		"## Pre-retrieval decision brief\n",
		`## Supplied evidence\n${evidence}`,
		"## Draft to verify and repair\n",
	].join("\n\n");
	return [{ role: "system", content }];
}

function codes(violations: readonly PublicationViolation[]): string[] {
	return [...new Set(violations.map((violation) => violation.code))].sort();
}

test("normalizes citation glyph variants into [n] syntax", () => {
	assert.equal(normalizeModelCitations("Revenue grew 【1】 last year."), "Revenue grew [1] last year.");
	assert.equal(normalizeModelCitations("See 【 2 】 and [ 3 ]."), "See [2] and [3].");
	assert.equal(normalizeModelCitations("Mixed 【4] and [5】 forms."), "Mixed [4] and [5] forms.");
});

test("moves estimate labels out of the citation marker", () => {
	assert.equal(
		normalizeModelCitations("Around 40% [2, est.] of users churn."),
		"Around 40% [2] (estimate) of users churn.",
	);
	assert.equal(
		normalizeModelCitations("Around 40% 【2, estimate】 of users churn."),
		"Around 40% [2] (estimate) of users churn.",
	);
});

test("flags citations that do not exist in the supplied evidence set", () => {
	const messages = verifierMessages({
		evidence: [{ index: 1, title: "RBI circular", body: "The limit is 5000 crores." }],
	});
	assert.deepEqual(codes(validatePublicationCandidate("The limit is 5000 crores [1].", messages)), []);
	assert.ok(
		codes(validatePublicationCandidate("The limit is 5000 crores [7].", messages)).includes(
			"invalid-citation",
		),
	);
	assert.ok(
		codes(validatePublicationCandidate("The limit is 5000 crores [0].", messages)).includes(
			"invalid-citation",
		),
	);
});

test("rejects any answer that cites sources when no evidence was supplied", () => {
	const messages = verifierMessages({ evidence: [] });
	assert.ok(
		codes(validatePublicationCandidate("This is well established [1].", messages)).includes(
			"invalid-citation",
		),
	);
});

test("flags residual malformed citation glyphs", () => {
	const messages = verifierMessages({
		evidence: [{ index: 1, title: "Source", body: "text" }],
	});
	const violations = validatePublicationCandidate("A claim 【1】 with a stray 】 glyph.", messages);
	assert.ok(codes(violations).includes("malformed-citation"));
});

test("flags precise numbers absent from the cited evidence", () => {
	const messages = verifierMessages({
		question: "What is the GST registration threshold?",
		evidence: [
			{ index: 1, title: "CBIC", body: "The threshold is 40 lakh for goods in most states." },
		],
	});
	assert.deepEqual(
		codes(validatePublicationCandidate("The threshold is 40 lakh for goods [1].", messages)),
		[],
	);
	const fabricated = validatePublicationCandidate(
		"The threshold is 87 lakh for goods [1].",
		messages,
	);
	assert.ok(codes(fabricated).includes("unsupported-cited-number"));
});

test("flags fabricated numeric ranges on a cited line", () => {
	const messages = verifierMessages({
		evidence: [{ index: 1, title: "Report", body: "Adoption reached 20% in 2025." }],
	});
	const violations = validatePublicationCandidate("Adoption is 55-70% today [1].", messages);
	assert.ok(codes(violations).includes("unsupported-cited-number"));
});

test("accepts numbers the user themself supplied", () => {
	const messages = verifierMessages({
		question: "I have a budget of 250000 rupees. How should I allocate it?",
		evidence: [{ index: 1, title: "Guide", body: "Allocate across channels." }],
	});
	assert.deepEqual(
		codes(validatePublicationCandidate("Split your 250000 budget across channels [1].", messages)),
		[],
	);
});

test("ignores numbers on lines that cite nothing", () => {
	const messages = verifierMessages({
		evidence: [{ index: 1, title: "Source", body: "no digits here" }],
	});
	assert.deepEqual(
		codes(validatePublicationCandidate("A rough plan might take 18 months to complete.", messages)),
		[],
	);
});

test("flags instructions to recreate an asset durable memory says exists", () => {
	const messages = verifierMessages({
		question: "How should I grow my business?",
		durableState: "User runs a logistics company and builds an invoicing product.",
		evidence: [{ index: 1, title: "Guide", body: "Growth guidance." }],
	});
	const violations = validatePublicationCandidate(
		"Existing assets: your logistics company.\nFirst, register a logistics company to get started.",
		messages,
	);
	assert.ok(codes(violations).includes("state-contradiction"));
});

test("flags a business answer that ignores every recalled asset", () => {
	const messages = verifierMessages({
		question: "What business should I launch next?",
		durableState: "User runs a logistics company and builds an invoicing product.",
		evidence: [{ index: 1, title: "Guide", body: "Market guidance." }],
	});
	const violations = validatePublicationCandidate(
		"Start something completely new in an unrelated market.",
		messages,
	);
	assert.ok(codes(violations).includes("state-omission"));
});

test("sanitizer removes offending lines and invalid citation markers", () => {
	const messages = verifierMessages({
		evidence: [{ index: 1, title: "CBIC", body: "The threshold is 40 lakh." }],
	});
	const candidate = "The threshold is 40 lakh [1].\nRevenue will be 93 crores [1].\nSee also [9].";
	const violations = validatePublicationCandidate(candidate, messages);
	const sanitized = sanitizeRemainingPublicationViolations(candidate, violations, messages);

	assert.ok(sanitized.includes("The threshold is 40 lakh [1]."));
	assert.ok(!sanitized.includes("93 crores"), "unsupported number line must be removed");
	assert.ok(!sanitized.includes("[9]"), "invalid citation marker must be removed");
	assert.deepEqual(codes(validatePublicationCandidate(sanitized, messages)), []);
});

test("sanitizer output is itself clean for every checked failure class", () => {
	const messages = verifierMessages({
		question: "How do I grow my logistics business?",
		durableState: "User runs a logistics company and builds an invoicing product.",
		evidence: [{ index: 1, title: "Guide", body: "Focus on retention." }],
	});
	const candidate = [
		"Register a logistics company first.",
		"Retention lifts revenue by 61% [1].",
		"Consult 【4】 for more.",
	].join("\n");
	const violations = validatePublicationCandidate(candidate, messages);
	assert.ok(violations.length > 0);

	const sanitized = sanitizeRemainingPublicationViolations(candidate, violations, messages);
	assert.deepEqual(
		codes(validatePublicationCandidate(sanitized, messages)),
		[],
		"the fail-closed sanitizer must not leave a publishable violation behind",
	);
});

test("compatibility sanitizer reaches the same clean state", () => {
	const messages = verifierMessages({
		evidence: [{ index: 1, title: "CBIC", body: "The threshold is 40 lakh." }],
	});
	const candidate = "The threshold is 40 lakh [1].\nGrowth hit 77% [1].\nAlso [12].";
	const violations = validatePublicationCandidate(candidate, messages);
	const stripped = stripStateContradictionLines(candidate, violations);
	assert.deepEqual(codes(validatePublicationCandidate(stripped, messages)), []);
});

test("does not leak private verifier context into the sanitized answer", () => {
	const messages = verifierMessages({
		question: "Secret internal question marker",
		durableState: "User runs a logistics company.",
		evidence: [{ index: 1, title: "Guide", body: "PRIVATE_EVIDENCE_BODY_MARKER" }],
	});
	const candidate = "Start by registering a logistics company.";
	const violations = validatePublicationCandidate(candidate, messages);
	const sanitized = sanitizeRemainingPublicationViolations(candidate, violations, messages);

	assert.ok(!sanitized.includes("PRIVATE_EVIDENCE_BODY_MARKER"));
	assert.ok(!sanitized.includes("Secret internal question marker"));
	assert.ok(!sanitized.includes("## Supplied evidence"));
	assert.ok(!sanitized.includes("## Draft to verify"));
});

test("stops entity extraction at an 'and <verb>' clause boundary", () => {
	// Regression: a greedy quantifier used to capture
	// "logistics company and builds an invoicing product" as one entity, which
	// matched no real prose and silently disabled the state-contradiction check.
	const messages = verifierMessages({
		question: "Should I launch a new venture?",
		durableState: "User runs a logistics company and builds an invoicing product.",
		evidence: [{ index: 1, title: "Guide", body: "Guidance." }],
	});
	const omission = validatePublicationCandidate("Start from scratch in a new market.", messages).find(
		(violation) => violation.code === "state-omission",
	);
	assert.ok(omission);
	assert.ok(
		omission.detail.includes("logistics company,"),
		`entities must be separated, got: ${omission.detail}`,
	);
	assert.ok(!omission.detail.includes("company and builds"));

	// Each asset is independently matchable against a duplicate-setup instruction.
	for (const line of [
		"First, register a logistics company.",
		"Then create an invoicing product from scratch.",
	]) {
		const violations = validatePublicationCandidate(`Building on your work.\n${line}`, messages);
		assert.ok(
			violations.some((violation) => violation.code === "state-contradiction"),
			`expected a state-contradiction for: ${line}`,
		);
	}
});

test("sanitizing a contradiction never publishes a fresh state-omission", () => {
	// Regression: removing the offending line could delete the only mention of an
	// existing asset. The final boundary then threw on the re-validation, turning a
	// good answer into a hard request failure.
	const messages = verifierMessages({
		question: "How should I grow my business?",
		durableState: "User runs a logistics company and builds an invoicing product.",
		evidence: [{ index: 1, title: "Guide", body: "Guidance." }],
	});
	const candidate = "Register a logistics company to begin.";
	const violations = validatePublicationCandidate(candidate, messages);
	assert.ok(violations.some((violation) => violation.code === "state-contradiction"));

	for (const sanitized of [
		sanitizeRemainingPublicationViolations(candidate, violations, messages),
		stripStateContradictionLines(candidate, violations, messages),
	]) {
		assert.deepEqual(codes(validatePublicationCandidate(sanitized, messages)), []);
		assert.ok(sanitized.toLowerCase().includes("logistics company"));
	}
});
