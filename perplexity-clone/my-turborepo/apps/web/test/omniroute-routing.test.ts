import assert from "node:assert/strict";
import test from "node:test";

import {
	isAllowedOmniRouteSelection,
	isOmniRouteRoutingMode,
	OMNIROUTE_DISABLED_ROUTING_MODES,
	OMNIROUTE_ROUTING_MODES,
} from "../src/services/omniroute/routing";

const VALIDATED_PRODUCT_MODES = [
	"auto",
	"auto/smart",
	"auto/coding",
	"auto/fast",
	"auto/offline",
] as const;

test("exposes only live-validated OmniRoute routing modes to AIRA product routes", () => {
	assert.deepEqual(OMNIROUTE_ROUTING_MODES, VALIDATED_PRODUCT_MODES);
	for (const mode of VALIDATED_PRODUCT_MODES) {
		assert.equal(isOmniRouteRoutingMode(mode), true);
	}

	assert.deepEqual(OMNIROUTE_DISABLED_ROUTING_MODES, ["auto/cheap"]);
	assert.equal(isOmniRouteRoutingMode("auto/cheap"), false);
	assert.equal(isOmniRouteRoutingMode("auto/unknown"), false);
});

test("an unvalidated auto profile stays blocked even when upstream advertises it", () => {
	const discovered = [
		"auto/cheap",
		"provider/model-a",
		"provider/model/with/slashes",
		"vendor/long-model-id",
	];

	assert.equal(isAllowedOmniRouteSelection("auto/smart", discovered), true);
	assert.equal(isAllowedOmniRouteSelection("auto/cheap", discovered), false);
	assert.equal(isAllowedOmniRouteSelection("auto/unknown", discovered), false);
	assert.equal(isAllowedOmniRouteSelection("provider/model/with/slashes", discovered), true);
	assert.equal(isAllowedOmniRouteSelection("provider/not-discovered", discovered), false);
});
