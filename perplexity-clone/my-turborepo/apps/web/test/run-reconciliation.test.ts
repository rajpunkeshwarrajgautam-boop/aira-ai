import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	classifyStaleRun,
	MAX_RUN_LIFETIME_MS,
	UNSUBMITTED_GRACE_MS,
} from "../lib/agents/run-reconciliation";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function agedBy(ms: number): Date {
	return new Date(NOW.getTime() - ms);
}

test("leaves a freshly created run alone while it may still be submitting", () => {
	assert.equal(
		classifyStaleRun({ remoteExecutionId: null, createdAt: agedBy(0), now: NOW }),
		null,
	);
	assert.equal(
		classifyStaleRun({
			remoteExecutionId: null,
			createdAt: agedBy(UNSUBMITTED_GRACE_MS - 1),
			now: NOW,
		}),
		null,
	);
});

test("classifies a run that never recorded a remote execution id as uncertain", () => {
	const decision = classifyStaleRun({
		remoteExecutionId: null,
		createdAt: agedBy(UNSUBMITTED_GRACE_MS),
		now: NOW,
	});
	assert.equal(decision?.reason, "UNSUBMITTED");
	// The message must tell the user AIRA deliberately did not retry, because the
	// submission outcome is unknown and a retry could start duplicate agent work.
	assert.match(decision!.errorMessage, /not retried automatically/i);
});

test("leaves an accepted run alone for its full lifetime bound", () => {
	assert.equal(
		classifyStaleRun({
			remoteExecutionId: "thread|run",
			createdAt: agedBy(MAX_RUN_LIFETIME_MS - 1),
			now: NOW,
		}),
		null,
	);
	// An accepted run is never classified by the shorter unsubmitted grace period.
	assert.equal(
		classifyStaleRun({
			remoteExecutionId: "thread|run",
			createdAt: agedBy(UNSUBMITTED_GRACE_MS + 1),
			now: NOW,
		}),
		null,
	);
});

test("classifies an accepted run with no final state as uncertain rather than definitively failed", () => {
	const decision = classifyStaleRun({
		remoteExecutionId: "thread|run",
		createdAt: agedBy(MAX_RUN_LIFETIME_MS),
		now: NOW,
	});
	assert.equal(decision?.reason, "STALLED");
	assert.match(decision!.errorMessage, /24 hours/);
});

test("AutoGPT keeps unknown submission and stale execution outcomes in REVIEW", () => {
	const source = readFileSync(new URL("../lib/autogpt/runs.ts", import.meta.url), "utf8");
	assert.match(source, /status:\s*outcomeUnknown\s*\?\s*AgentRunStatus\.REVIEW\s*:\s*AgentRunStatus\.FAILED/);
	assert.match(source, /status:\s*AgentRunStatus\.REVIEW,[\s\S]*?errorMessage:\s*stale\.errorMessage/);
	assert.match(source, /completedAt:\s*outcomeUnknown\s*\?\s*null\s*:\s*new Date\(\)/);
});

test("AutoGPT treats a disappeared accepted execution as uncertain review, not a retryable failure", () => {
	const clientSource = readFileSync(new URL("../lib/autogpt/client.ts", import.meta.url), "utf8");
	const runsSource = readFileSync(new URL("../lib/autogpt/runs.ts", import.meta.url), "utf8");
	assert.match(clientSource, /if \(status === 404\)[\s\S]*?code:\s*"AUTOGPT_NOT_FOUND"/);
	assert.match(
		runsSource,
		/error\.code === "AUTOGPT_NOT_FOUND" \|\| error\.code === "AUTOGPT_TARGET_NOT_CONFIGURED"/,
	);
	assert.match(runsSource, /reviewUncertainAutoGptRun\([\s\S]*?requires review before any retry/);
	assert.doesNotMatch(
		runsSource,
		/AUTOGPT_NOT_FOUND[\s\S]{0,300}AgentRunStatus\.FAILED/,
	);
});

test("DeerFlow keeps unknown, stale and disappeared accepted executions in REVIEW", () => {
	const source = readFileSync(new URL("../lib/deerflow/runs.ts", import.meta.url), "utf8");
	assert.match(source, /status:\s*outcomeUnknown\s*\?\s*AgentRunStatus\.REVIEW\s*:\s*AgentRunStatus\.FAILED/);
	assert.match(source, /async function reviewUncertainRun[\s\S]*?status:\s*AgentRunStatus\.REVIEW/);
	assert.match(source, /if \(stale\) return toDto\(await reviewUncertainRun/);
	assert.match(source, /error\.status === 404[\s\S]*?reviewUncertainRun/);
	assert.doesNotMatch(source, /closeStaleRun/);
});

test("the unsubmitted bound is shorter than the accepted-run bound", () => {
	assert.ok(UNSUBMITTED_GRACE_MS < MAX_RUN_LIFETIME_MS);
	// The grace period must comfortably exceed the longest possible submit request.
	assert.ok(UNSUBMITTED_GRACE_MS >= 5 * 60 * 1_000);
});
