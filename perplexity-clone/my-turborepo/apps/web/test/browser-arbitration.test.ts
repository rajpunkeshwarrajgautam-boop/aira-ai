import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	browserControlTarget,
	browserControlTransitionAllowed,
} from "../lib/agent-platform/browser-arbitration";

test("browser control state machine permits only explicit ownership transitions", () => {
	assert.equal(browserControlTransitionAllowed("ACTIVE", "human"), true);
	assert.equal(browserControlTransitionAllowed("HUMAN_CONTROL", "human"), false);
	assert.equal(browserControlTransitionAllowed("HUMAN_CONTROL", "agent"), true);
	assert.equal(browserControlTransitionAllowed("ACTIVE", "agent"), false);
	assert.equal(browserControlTransitionAllowed("ACTIVE", "pause"), true);
	assert.equal(browserControlTransitionAllowed("HUMAN_CONTROL", "pause"), true);
	assert.equal(browserControlTransitionAllowed("PAUSED", "resume"), true);
	assert.equal(browserControlTransitionAllowed("ACTIVE", "resume"), false);
	assert.equal(browserControlTarget("human"), "HUMAN_CONTROL");
	assert.equal(browserControlTarget("agent"), "ACTIVE");
	assert.equal(browserControlTarget("pause"), "PAUSED");
	assert.equal(browserControlTarget("resume"), "ACTIVE");
});

test("browser adapter claims and releases an action lease around remote execution", () => {
	const source = readFileSync(new URL("../lib/tool-gateway/adapters.ts", import.meta.url), "utf8");
	assert.match(source, /claimBrowserActionLease/);
	assert.match(source, /runRemoteBrowserAction/);
	assert.match(source, /finally\s*\{[\s\S]*releaseBrowserActionLease/);
});

test("browser control endpoint uses atomic transition instead of direct status mutation", () => {
	const source = readFileSync(new URL("../app/api/browser/sessions/[sessionId]/control/route.ts", import.meta.url), "utf8");
	assert.match(source, /transitionBrowserControl/);
	assert.doesNotMatch(source, /updateBrowserSession/);
});
