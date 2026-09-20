import test from "node:test";
import assert from "node:assert/strict";

import { classifyToolRisk, requiresApproval } from "@/lib/tool-gateway/policy";
import { isAiraAgentConfigured, airaAgentRuntime } from "@/lib/agent-runtime/aira-agent-runtime";
import { ProviderRouter } from "@/src/services/providers/provider-router";
import { OpenAIProvider } from "@/src/services/providers/openai-provider";
import { NVIDIAProvider } from "@/src/services/providers/nvidia-provider";
import { getAgentRuntime } from "@/lib/agent-runtime/registry";

test("Tool Gateway Policy: memory.lookup is classified as LOW risk and does not require approval", () => {
	const risk = classifyToolRisk("memory", "lookup");
	assert.equal(risk, "LOW", "memory.lookup should be classified as LOW risk");
	assert.equal(requiresApproval(risk), false, "LOW risk actions must not require manual approval");
});

test("ProviderRouter: hasConfiguredRoute returns false when no provider registered", () => {
	const router = new ProviderRouter("omniroute", "nvidia");
	assert.equal(router.hasConfiguredRoute(), false, "Empty router should not have a configured route");
});

test("ProviderRouter: hasConfiguredRoute returns true when fallback or primary is registered", () => {
	const router = new ProviderRouter("omniroute", "nvidia");
	router.registerProvider(new NVIDIAProvider("test-key-nvidia"));
	assert.equal(router.hasConfiguredRoute(), true, "Router with registered fallback should have a configured route");

	const openAiRouter = new ProviderRouter("openai", "nvidia");
	openAiRouter.registerProvider(new OpenAIProvider("test-key-openai"));
	assert.equal(openAiRouter.hasConfiguredRoute(), true, "Router with registered primary should have a configured route");
});

test("ProviderRouter: hasConfiguredRoute returns false when configured provider IDs are unknown/unregistered", () => {
	// Custom provider names that are never registered
	const router = new ProviderRouter("non_existent_primary", "non_existent_fallback");
	router.registerProvider(new NVIDIAProvider("test-key-nvidia"));
	assert.equal(router.hasConfiguredRoute(), false, "Router should return false when registered provider does not match configured primary/fallback IDs");
});

test("Agent Runtime: airaAgentRuntime delegates to provider readiness", () => {
	assert.equal(typeof airaAgentRuntime.isConfigured, "function");
	assert.equal(typeof isAiraAgentConfigured, "function");
	
	const runtime = getAgentRuntime("AIRA_AGENT");
	assert.equal(runtime.id, "AIRA_AGENT");
	assert.equal(typeof runtime.isConfigured(), "boolean");
});
