import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relative: string): string {
	return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("swarm project creation is gated on AGENT_SWARM readiness before persistence", () => {
	const route = source("../app/api/agent-platform/projects/route.ts");

	assert.match(route, /source === "work-mode" \|\| source === "swarm-workspace"/);
	assert.match(route, /source === "swarm-workspace" \? "AGENT_SWARM" : undefined/);

	const gateIndex = route.indexOf("const gate = await runtimeGate");
	const createIndex = route.indexOf("await createProject");
	assert.ok(gateIndex >= 0, "runtime gate must exist");
	assert.ok(createIndex >= 0, "project persistence must exist");
	assert.ok(gateIndex < createIndex, "runtime readiness must be checked before project persistence");
});
