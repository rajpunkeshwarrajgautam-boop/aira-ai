import assert from "node:assert/strict";
import test from "node:test";

import { getLocalAiConfig } from "../src/services/local-ai/config.ts";
import { routeLocalAiTask } from "../src/services/local-ai/task-router.ts";

test("keeps routine lead and extraction work on the local tier", () => {
	const lead = routeLocalAiTask({
		prompt: "Classify this CRM lead, extract the company and return structured JSON with a lead score.",
	});
	assert.equal(lead.tier, "local");
	assert.ok(lead.signals.includes("lead-ops") || lead.signals.includes("classification"));

	const summary = routeLocalAiTask({ prompt: "Summarize this short internal email into five bullets." });
	assert.equal(summary.tier, "local");
});

test("does not promote generic chat just because a previous router pass labeled it chat", () => {
	const first = routeLocalAiTask({ prompt: "Explain the tradeoffs between these two business strategies." });
	assert.equal(first.tier, "cloud");

	const second = routeLocalAiTask({
		prompt: "Explain the tradeoffs between these two business strategies.",
		taskKind: first.taskKind,
	});
	assert.equal(second.tier, "cloud");
});

test("routes fresh web research and high-stakes work away from the 1B worker", () => {
	const research = routeLocalAiTask({
		prompt: "Search the web for the latest tax regulation today, verify sources and give citations.",
	});
	assert.equal(research.tier, "cloud");
	assert.ok(research.signals.includes("web-research"));
	assert.ok(research.signals.includes("fresh-information"));
});

test("local AI configuration is fail-closed and llama.cpp API keys are optional", () => {
	const disabled = getLocalAiConfig({
		VIREXA_LOCAL_AI_ENABLED: "false",
		SELF_HOSTED_LLM_BASE_URL: "http://127.0.0.1:8080/v1",
		SELF_HOSTED_LLM_MODEL: "MiniCPM5-1B",
	});
	assert.equal(disabled.configured, false);

	const configured = getLocalAiConfig({
		VIREXA_LOCAL_AI_ENABLED: "true",
		SELF_HOSTED_LLM_BASE_URL: "http://127.0.0.1:8080/v1",
		SELF_HOSTED_LLM_MODEL: "MiniCPM5-1B",
	});
	assert.equal(configured.configured, true);
	assert.equal(configured.apiKey, "no-key");
	assert.equal(configured.model, "MiniCPM5-1B");
});
