import assert from "node:assert/strict";
import test from "node:test";

import {
	globalIntelligentRouter,
	inferRoutingSignals,
} from "../lib/routing/intelligent-router";
import { globalModelRegistry } from "../lib/contracts/model-registry";

test("Model Capability Registry & Multimodal Routing (Gates 118, 119)", () => {
	const allModels = globalModelRegistry.listAll();
	assert.ok(allModels.length >= 3);

	const visionRoute = globalIntelligentRouter.selectRoute({
		taskType: "multimodal",
		complexity: "medium",
		modality: "vision",
	});

	assert.equal(visionRoute.selectedModel.modalities.includes("vision"), true);
	assert.equal(visionRoute.selectedModel.modelId, "meta/llama-3.2-11b-vision-instruct");
});

test("semantic routing signals distinguish coding, research, browser, and general requests", () => {
	assert.equal(
		inferRoutingSignals({
			query: "Debug this TypeScript API handler and fix the failing integration test.",
		}).taskType,
		"coding",
	);
	assert.equal(
		inferRoutingSignals({
			query: "Research the current AI inference market and compare the major competitors with sources.",
		}).taskType,
		"research",
	);
	assert.equal(
		inferRoutingSignals({
			query: "Open the website, sign in, navigate to billing, and submit the form.",
		}).taskType,
		"browser",
	);
	assert.equal(
		inferRoutingSignals({
			query: "Explain what retrieval augmented generation means.",
		}).taskType,
		"general",
	);
});

test("task type and complexity materially change free-tier model selection", () => {
	const simpleGeneral = globalIntelligentRouter.selectRuntimeRoute({
		query: "Explain what RAG means.",
		providerTier: "free",
		mode: "standard",
	});
	const complexCoding = globalIntelligentRouter.selectRuntimeRoute({
		query:
			"Debug this production TypeScript service, identify the root cause across the API and database layers, " +
			"then propose a production-grade migration plan with tests and rollback steps.",
		providerTier: "free",
		mode: "standard",
	});

	assert.equal(simpleGeneral.requestedProvider, "nvidia");
	assert.equal(complexCoding.requestedProvider, "nvidia");
	assert.equal(simpleGeneral.signals.taskType, "general");
	assert.equal(complexCoding.signals.taskType, "coding");
	assert.equal(simpleGeneral.requestedModel, "meta/llama-3.2-11b-vision-instruct");
	assert.equal(complexCoding.requestedModel, "meta/llama-3.3-70b-instruct");
	assert.notEqual(simpleGeneral.requestedModel, complexCoding.requestedModel);
});

test("pro routing maps materially different task classes to distinct validated OmniRoute profiles", () => {
	const general = globalIntelligentRouter.selectRuntimeRoute({
		query: "Explain what RAG means.",
		providerTier: "pro",
		mode: "standard",
	});
	const coding = globalIntelligentRouter.selectRuntimeRoute({
		query: "Debug this TypeScript function and write the corrected implementation.",
		providerTier: "pro",
		mode: "standard",
	});
	const research = globalIntelligentRouter.selectRuntimeRoute({
		query: "Research the current AI inference market and compare the major vendors with evidence.",
		providerTier: "pro",
		mode: "standard",
	});
	const deep = globalIntelligentRouter.selectRuntimeRoute({
		query: "Evaluate the market, architecture, economics, risks, and implementation trade-offs.",
		providerTier: "pro",
		mode: "deep",
	});

	assert.equal(general.requestedModel, "auto/fast");
	assert.equal(coding.requestedModel, "auto/coding");
	assert.equal(research.requestedModel, "auto/smart");
	assert.equal(deep.requestedModel, "auto/smart");
	assert.notEqual(general.requestedModel, coding.requestedModel);
	assert.notEqual(coding.requestedModel, research.requestedModel);
});

test("explicit model selection remains authoritative", () => {
	const route = globalIntelligentRouter.selectRuntimeRoute({
		query: "Research this topic deeply.",
		providerTier: "pro",
		mode: "deep",
		explicitModel: "nvidia/openai/gpt-oss-20b",
	});

	assert.equal(route.requestedModel, "nvidia/openai/gpt-oss-20b");
	assert.equal(route.explicitModelOverride, true);
});

test("Routing Economics & Budget-Aware Penalties (Gate 15)", () => {
	const budgetRoute = globalIntelligentRouter.selectRoute({
		taskType: "general",
		complexity: "medium",
		estimatedTokens: 2_000,
		maxBudgetUsd: 0.0005,
	});

	assert.equal(budgetRoute.selectedModel.modelId, "nvidia/openai/gpt-oss-20b");
	assert.ok(budgetRoute.estimatedCostUsd <= 0.0005);
});

test("routing honors capability and context constraints instead of task labels alone", () => {
	const constrained = globalIntelligentRouter.selectRoute({
		taskType: "coding",
		complexity: "high",
		requiresToolCalling: true,
		requiresStructuredOutput: true,
		minContextWindow: 64_000,
		allowedProviders: ["nvidia"],
	});

	assert.equal(constrained.selectedModel.toolCalling, true);
	assert.equal(constrained.selectedModel.structuredOutput, true);
	assert.ok(constrained.selectedModel.contextWindow >= 64_000);
	assert.equal(constrained.selectedModel.modelId, "meta/llama-3.3-70b-instruct");
});
