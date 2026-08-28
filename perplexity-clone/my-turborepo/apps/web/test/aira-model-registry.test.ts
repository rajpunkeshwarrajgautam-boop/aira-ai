import assert from "node:assert/strict";
import test from "node:test";

import {
	AIRA_MODEL_REGISTRY,
	getAiraModelDefinition,
	getDiscoveredAiraModels,
} from "../src/services/models/aira-model-registry";

test("AIRA model registry defines one unique OmniRoute id per tier", () => {
	assert.equal(AIRA_MODEL_REGISTRY.length, 5);
	assert.equal(new Set(AIRA_MODEL_REGISTRY.map((model) => model.id)).size, 5);
	assert.deepEqual(
		AIRA_MODEL_REGISTRY.map((model) => model.id),
		["aira/edge", "aira/core", "aira/pro", "aira/ultra", "aira/apex"],
	);
});

test("new AIRA model entries do not make unsupported capability or production claims", () => {
	for (const model of AIRA_MODEL_REGISTRY) {
		assert.equal(model.releaseState, "experiment");
		assert.equal(model.evidenceState, "NOT_TESTED");
		assert.equal(model.exposure, "omniroute-discovered-only");
	}
});

test("AIRA Core records the selected research base without implying deployment", () => {
	const core = getAiraModelDefinition("aira/core");
	assert.ok(core);
	assert.equal(core.candidateBase, "Qwen/Qwen3.5-9B-Base");
	assert.equal(core.releaseState, "experiment");
});

test("only models actually discovered from OmniRoute become exposeable", () => {
	assert.deepEqual(getDiscoveredAiraModels(["some/vendor-model"]), []);
	assert.deepEqual(
		getDiscoveredAiraModels(["some/vendor-model", "aira/core"]).map((model) => model.id),
		["aira/core"],
	);
});
