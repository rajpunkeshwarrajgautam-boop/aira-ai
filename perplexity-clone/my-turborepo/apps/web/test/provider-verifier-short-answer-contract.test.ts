import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("private verifier accepts concise non-empty answers instead of using arbitrary character thresholds", () => {
const core = read("src/services/providers/provider-router-core.ts");
const router = read("src/services/providers/provider-router.ts");

assert.ok(core.includes("if (!finalText || looksLikePrivateAuditLeak(finalText)) return null;"));
assert.ok(core.includes("if (firstTrimmed && !containsVerifierEnvelopeMarkup(firstTrimmed) && !looksLikePrivateAuditLeak(firstTrimmed)) {"));
assert.ok(router.includes("if (violations.length > 0 || !candidate) {"));

assert.ok(!core.includes("finalText.length < 80"));
assert.ok(!core.includes("firstTrimmed.length >= 120"));
assert.ok(!router.includes("candidate.length < 80"));
});

test("removing length heuristics preserves verifier privacy and publication safeguards", () => {
const core = read("src/services/providers/provider-router-core.ts");
const router = read("src/services/providers/provider-router.ts");

assert.ok(core.includes('const open = "<aira_final>"'));
assert.ok(core.includes('const close = "</aira_final>"'));
assert.ok(core.includes("function containsVerifierEnvelopeMarkup(text: string): boolean"));
assert.ok(core.includes("normalized.includes(\"<aira_final>\")"));
assert.ok(core.includes("normalized.includes(\"</aira_final>\")"));
assert.ok(core.includes("looksLikePrivateAuditLeak(finalText)"));
assert.ok(core.includes("looksLikePrivateAuditLeak(firstTrimmed)"));
assert.ok(core.includes("Private verifier failed to produce a safe final-answer envelope."));

assert.ok(router.includes("normalizeModelCitations(candidateInput).trim()"));
assert.ok(router.includes("validatePublicationCandidate(candidate, messages)"));
assert.ok(router.includes("sanitizeRemainingPublicationViolations"));
assert.ok(router.includes("violations.length > 0 || !candidate"));
});