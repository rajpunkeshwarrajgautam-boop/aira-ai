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

test("the operator workspace cannot select an unvalidated auto profile", () => {
	const page = read("app/omniroute/page.tsx");
	assert.ok(page.includes('{ id: "auto/cheap", label: "Cheap"'));
	assert.ok(page.includes("disabled={!AUTOMATIC_ROUTING_VALIDATED}"));
	assert.ok(page.includes("if (AUTOMATIC_ROUTING_VALIDATED) setSelectedModel(preset.id)"));
});

test("the Preview inference endpoint applies the same product routing allowlist", () => {
	const route = read("app/api/omniroute/test/route.ts");
	assert.ok(route.includes("isOmniRouteRoutingMode(model)"));
	assert.ok(route.includes("isAllowedOmniRouteSelection(model"));
	assert.ok(route.includes("OMNIROUTE_MODEL_NOT_DISCOVERED"));
});
