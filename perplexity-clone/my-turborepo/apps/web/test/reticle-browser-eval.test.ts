import assert from "node:assert/strict";
import test from "node:test";

import {
	evaluateSemanticSession,
	verifySessionIsolation,
	verifyTabOrigin,
} from "../lib/reticle/reticle-harness";
import type { ReticlePredicate, ReticleSession } from "../lib/reticle/reticle-harness";

const ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"] as const;

test("RETICLE HARNESS: Origin check accepts authorized local dev server and rejects external/attacker origins", () => {
	// Authorized origins pass
	assert.equal(verifyTabOrigin("http://localhost:3000/omniroute", ALLOWED_ORIGINS), true);
	assert.equal(verifyTabOrigin("http://127.0.0.1:3000/build", ALLOWED_ORIGINS), true);
	assert.equal(verifyTabOrigin("http://localhost:3000/api/health", ALLOWED_ORIGINS), true);

	// Malicious/attacker origins fail closed
	assert.equal(verifyTabOrigin("http://attacker.local:3000", ALLOWED_ORIGINS), false);
	assert.equal(verifyTabOrigin("https://evil.com/omniroute", ALLOWED_ORIGINS), false);
	assert.equal(verifyTabOrigin("http://localhost:8080", ALLOWED_ORIGINS), false);
	assert.equal(verifyTabOrigin("javascript:alert(1)", ALLOWED_ORIGINS), false);
	assert.equal(verifyTabOrigin("not-a-url", ALLOWED_ORIGINS), false);
});

test("RETICLE HARNESS: Cross-session access is strictly isolated", () => {
	const activeSessions: ReticleSession[] = [
		{
			sessionId: "sess-user-alpha",
			url: "http://localhost:3000/runs",
			title: "AIRA Runs - Alpha",
			attachedAt: Date.now() - 5000,
			isLiveTab: true,
			origin: "http://localhost:3000",
		},
		{
			sessionId: "sess-user-beta",
			url: "http://localhost:3000/runs",
			title: "AIRA Runs - Beta",
			attachedAt: Date.now() - 3000,
			isLiveTab: true,
			origin: "http://localhost:3000",
		},
	];

	// Matching session passes
	assert.equal(verifySessionIsolation("sess-user-alpha", "sess-user-alpha", activeSessions), true);
	assert.equal(verifySessionIsolation("sess-user-beta", "sess-user-beta", activeSessions), true);

	// Mismatched / cross-tenant session fails
	assert.equal(verifySessionIsolation("sess-user-alpha", "sess-user-beta", activeSessions), false);
	assert.equal(verifySessionIsolation("sess-attacker", "sess-user-alpha", activeSessions), false);
	assert.equal(verifySessionIsolation("", "sess-user-alpha", activeSessions), false);
});

test("RETICLE HARNESS: Live headed browser tab executes semantic evaluation with verified: 'yes'", () => {
	const liveSession: ReticleSession = {
		sessionId: "sess-live-tab-001",
		url: "http://localhost:3000/omniroute",
		title: "AIRA - OmniRoute Workspace",
		attachedAt: Date.now(),
		isLiveTab: true,
		origin: "http://localhost:3000",
	};

	const predicates: ReticlePredicate[] = [
		{ kind: "element", testid: "omniroute-workspace" },
		{ kind: "net", urlContains: "/api/omniroute/models", status: 200 },
		{
			kind: "state",
			predicateFn: (state: Record<string, unknown>) => state.activeModel === "nvidia/openai/gpt-oss-20b",
		},
	];

	const verdict = evaluateSemanticSession(
		liveSession,
		{
			targetUrl: "http://localhost:3000/omniroute",
			allowedOrigins: ALLOWED_ORIGINS,
			flowName: "omniroute_navigation_journey",
		},
		predicates,
		{
			"omniroute-workspace": true,
			url: "http://localhost:3000/api/omniroute/models",
			status: 200,
			activeModel: "nvidia/openai/gpt-oss-20b",
		},
	);

	assert.equal(verdict.verified, "yes");
	assert.equal(verdict.flowName, "omniroute_navigation_journey");
	assert.equal(verdict.sessionId, "sess-live-tab-001");
	assert.equal(verdict.assertions.length, 5); // origin_check + tab_attachment + 3 predicates
	assert.ok(verdict.assertions.every((a) => a.passed));
});

test("RETICLE HARNESS: Inactive or detached tab reports verified: 'unknown' with explicit USER ACTION REQUIRED", () => {
	const inactiveSession: ReticleSession = {
		sessionId: "sess-detached-tab",
		url: "http://localhost:3000/omniroute",
		title: "AIRA",
		attachedAt: Date.now(),
		isLiveTab: false, // Detached/unfocused
		origin: "http://localhost:3000",
	};

	const verdict = evaluateSemanticSession(
		inactiveSession,
		{
			targetUrl: "http://localhost:3000/omniroute",
			allowedOrigins: ALLOWED_ORIGINS,
			flowName: "omniroute_live_check",
		},
		[{ kind: "element", testid: "main-view" }],
	);

	assert.equal(verdict.verified, "unknown");
	assert.ok(verdict.userActionRequired);
	assert.ok(verdict.userActionRequired.includes("keep the AIRA application tab visible"));
});

test("RETICLE HARNESS: Unauthorized tab origin rejects with verified: 'no' and security boundary error", () => {
	const unauthorizedSession: ReticleSession = {
		sessionId: "sess-external-tab",
		url: "https://unauthorized.external.site/app",
		title: "Attacker Site",
		attachedAt: Date.now(),
		isLiveTab: true,
		origin: "https://unauthorized.external.site",
	};

	const verdict = evaluateSemanticSession(
		unauthorizedSession,
		{
			targetUrl: "http://localhost:3000/omniroute",
			allowedOrigins: ALLOWED_ORIGINS,
			flowName: "unauthorized_origin_eval",
		},
		[],
	);

	assert.equal(verdict.verified, "no");
	assert.ok(verdict.error?.includes("Security boundary violation"));
});

test("REGRESSION: Predicate without observed semantic evidence returns verified: 'unknown' and prevents false positive PASS", () => {
	const liveSession: ReticleSession = {
		sessionId: "sess-live-tab-no-evidence",
		url: "http://localhost:3000/omniroute",
		title: "AIRA",
		attachedAt: Date.now(),
		isLiveTab: true,
		origin: "http://localhost:3000",
	};

	// Predicates specified without observed state or evaluator
	const predicates: ReticlePredicate[] = [
		{ kind: "element", testid: "unverified-element" },
	];

	const verdict = evaluateSemanticSession(
		liveSession,
		{
			targetUrl: "http://localhost:3000/omniroute",
			allowedOrigins: ALLOWED_ORIGINS,
			flowName: "unverified_evidence_check",
		},
		predicates,
		// Omit observedState
	);

	assert.equal(verdict.verified, "unknown");
	assert.equal(verdict.assertions.find((a) => a.kind === "element")?.passed, false);
	assert.ok(verdict.error?.includes("missing live observed state"));
});

test("REGRESSION: Mismatched observed state evaluates to verified: 'no'", () => {
	const liveSession: ReticleSession = {
		sessionId: "sess-live-tab-mismatch",
		url: "http://localhost:3000/omniroute",
		title: "AIRA",
		attachedAt: Date.now(),
		isLiveTab: true,
		origin: "http://localhost:3000",
	};

	const predicates: ReticlePredicate[] = [
		{ kind: "net", urlContains: "/api/nonexistent", status: 200 },
	];

	const verdict = evaluateSemanticSession(
		liveSession,
		{
			targetUrl: "http://localhost:3000/omniroute",
			allowedOrigins: ALLOWED_ORIGINS,
			flowName: "mismatched_state_check",
		},
		predicates,
		{ url: "http://localhost:3000/api/other", status: 404 },
	);

	assert.equal(verdict.verified, "no");
	assert.equal(verdict.assertions.find((a) => a.kind === "net")?.passed, false);
});
