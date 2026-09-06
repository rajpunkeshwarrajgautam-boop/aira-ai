import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("Compare advertises and validates OmniRoute selections through AIRA's product allowlist", () => {
	const compare = read("app/api/compare/route.ts");
	assert.ok(compare.includes("routingModes: OMNIROUTE_ROUTING_MODES"));
	assert.ok(compare.includes("!isOmniRouteRoutingMode(model!)"));
	assert.ok(compare.includes("isAllowedOmniRouteSelection(model, discovered)"));
});

test("the operator workspace exposes validated auto profiles while keeping failed profiles blocked", () => {
const page = read("app/omniroute/page.tsx");

assert.ok(page.includes("OMNIROUTE_ROUTING_MODES"));
assert.ok(page.includes("OMNIROUTE_DISABLED_ROUTING_MODES"));
assert.ok(page.includes('"auto/cheap": { label: "Cheap", detail: "Blocked: validation failed" }'));
assert.ok(page.includes("disabled={!preset.validated}"));
assert.ok(page.includes("if (preset.validated) setSelectedModel(preset.id)"));
assert.ok(page.includes("Live validated"));
assert.ok(!page.includes("AUTOMATIC_ROUTING_VALIDATED"));
});

test("the Preview inference endpoint applies the same product routing allowlist", () => {
	const route = read("app/api/omniroute/test/route.ts");
	assert.ok(route.includes("isOmniRouteRoutingMode(model)"));
	assert.ok(route.includes("isAllowedOmniRouteSelection(model"));
	assert.ok(route.includes("OMNIROUTE_MODEL_NOT_DISCOVERED"));
});
