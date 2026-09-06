import assert from "node:assert/strict";
import test from "node:test";

import { globalIntelligentRouter } from "../lib/routing/intelligent-router";
import { globalModelRegistry } from "../lib/contracts/model-registry";

test("Model Capability Registry & Multimodal Routing (Gates 118, 119)", () => {
	const allModels = globalModelRegistry.listAll();
	assert.ok(allModels.length >= 3);

	// Route multimodal task requiring vision
	const visionRoute = globalIntelligentRouter.selectRoute({
		taskType: "multimodal",
		modality: "vision",
	});

	assert.equal(visionRoute.selectedModel.modalities.includes("vision"), true);
	assert.equal(visionRoute.selectedModel.modelId, "meta/llama-3.2-11b-vision-instruct");
});

test("Routing Economics & Budget-Aware Penalties (Gate 15)", () => {
	const cheapRoute = globalIntelligentRouter.selectRoute({
		taskType: "general",
		maxBudgetUsd: 0.0001, // Tight budget
	});

	assert.ok(cheapRoute.estimatedCostUsd <= 0.005);
	assert.ok(cheapRoute.selectedModel);
});

test("Benchmark-Based Routing & Latency Optimization (Gates 16, 120)", () => {
	const latencySensitiveRoute = globalIntelligentRouter.selectRoute({
		taskType: "coding",
		latencySensitive: true,
	});

	assert.ok(latencySensitiveRoute.selectedModel.p95LatencyMs <= 1200);
	assert.ok(latencySensitiveRoute.fallbackModels.length >= 1);
	assert.ok(latencySensitiveRoute.reasoning.includes("Score:"));
});
