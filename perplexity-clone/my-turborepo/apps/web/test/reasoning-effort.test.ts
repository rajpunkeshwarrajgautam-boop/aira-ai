import assert from "node:assert/strict";
import test from "node:test";

import {
	REASONING_EFFORT_CAPABILITIES,
	reasoningEffortCapability,
	supportedReasoningEffort,
} from "../lib/reasoning-effort";

test("current product routing profiles do not claim unsupported native reasoning effort", () => {
	for (const capability of Object.values(REASONING_EFFORT_CAPABILITIES)) {
		assert.equal(capability.supported, false);
		assert.match(capability.reason ?? "", /not available/i);
	}
});

test("unknown model profiles fail closed", () => {
	const capability = reasoningEffortCapability("future-unverified-profile");
	assert.equal(capability.supported, false);
	assert.match(capability.reason ?? "", /not available/i);
});

test("unsupported profiles never emit a reasoning effort parameter", () => {
	assert.equal(supportedReasoningEffort("auto", "low"), undefined);
	assert.equal(supportedReasoningEffort("smart", "high"), undefined);
});
