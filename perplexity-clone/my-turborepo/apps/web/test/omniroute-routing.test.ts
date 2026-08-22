import assert from "node:assert/strict";
import test from "node:test";

import {
	isAllowedOmniRouteSelection,
	isOmniRouteRoutingMode,
	OMNIROUTE_ROUTING_MODES,
} from "../src/services/omniroute/routing";

test("recognizes every supported OmniRoute routing mode", () => {
	for (const mode of ["auto", "auto/smart", "auto/coding", "auto/fast", "auto/cheap", "auto/offline"]) {
		assert.ok(OMNIROUTE_ROUTING_MODES.includes(mode as (typeof OMNIROUTE_ROUTING_MODES)[number]));
		assert.equal(isOmniRouteRoutingMode(mode), true);
	}
	assert.equal(isOmniRouteRoutingMode("auto/unknown"), false);
});

test("accepts fixed models only when they came from live discovery", () => {
	const discovered = ["provider/model-a", "provider/model/with/slashes", "vendor/long-model-id"];
	assert.equal(isAllowedOmniRouteSelection("auto/smart", discovered), true);
	assert.equal(isAllowedOmniRouteSelection("provider/model/with/slashes", discovered), true);
	assert.equal(isAllowedOmniRouteSelection("provider/not-discovered", discovered), false);
});
