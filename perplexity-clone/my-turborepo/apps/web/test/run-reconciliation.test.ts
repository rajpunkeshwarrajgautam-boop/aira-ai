import assert from "node:assert/strict";
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

test("closes a run that never recorded a remote execution id", () => {
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
	// An accepted run is never closed by the shorter unsubmitted grace period.
	assert.equal(
		classifyStaleRun({
			remoteExecutionId: "thread|run",
			createdAt: agedBy(UNSUBMITTED_GRACE_MS + 1),
			now: NOW,
		}),
		null,
	);
});

test("closes an accepted run that never reported a final state", () => {
	const decision = classifyStaleRun({
		remoteExecutionId: "thread|run",
		createdAt: agedBy(MAX_RUN_LIFETIME_MS),
		now: NOW,
	});
	assert.equal(decision?.reason, "STALLED");
	assert.match(decision!.errorMessage, /24 hours/);
});

test("the unsubmitted bound is shorter than the accepted-run bound", () => {
	assert.ok(UNSUBMITTED_GRACE_MS < MAX_RUN_LIFETIME_MS);
	// The grace period must comfortably exceed the longest possible submit request.
	assert.ok(UNSUBMITTED_GRACE_MS >= 5 * 60 * 1_000);
});
