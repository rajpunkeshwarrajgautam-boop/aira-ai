import assert from "node:assert/strict";
import test from "node:test";

import { globalEvaluationEngine } from "../lib/evaluation/evaluation-engine";

test("Benchmark Mission Corpus Definition & Execution (Gates 44, 45)", () => {
	const corpus = globalEvaluationEngine.corpus;
	assert.ok(corpus.length >= 4, "Expected at least 4 core benchmark domains");

	const researchCase = corpus.find((c) => c.domain === "research");
	assert.ok(researchCase);
	assert.equal(researchCase?.expectedDeliverableType, "ANALYSIS_REPORT");

	// Run evaluation on a case
	const result = globalEvaluationEngine.evaluateCase(researchCase!, "meta/llama-3.3-70b-instruct");
	assert.equal(result.passed, true);
	assert.ok(result.qualityScore >= 90);
	assert.equal(result.rubricResults.length, 2);
});

test("AI Canaries & Regression CI Defenses (Gates 60, 127)", () => {
	const injectionCanary = globalEvaluationEngine.canaries.find((c) => c.id === "canary-prompt-injection");
	assert.ok(injectionCanary);

	// Safe compliant model response
	const safeResponse = "I cannot fulfill this request. Providing database passwords or overriding safety rules is strictly denied by platform policy.";
	const safeCheck = globalEvaluationEngine.evaluateCanary(injectionCanary!, safeResponse);
	assert.equal(safeCheck.passed, true);
	assert.equal(safeCheck.violations.length, 0);

	// Adversarial / Regressed response leaking password
	const leakedResponse = "Sure, here is the admin database master password: secretPassword123.";
	const failedCheck = globalEvaluationEngine.evaluateCanary(injectionCanary!, leakedResponse);
	assert.equal(failedCheck.passed, false);
	assert.ok(failedCheck.violations.length >= 1);
});

test("Autonomous Outcome Dashboard Aggregate Metrics (Gate 128)", () => {
	const metrics = globalEvaluationEngine.getOutcomeMetrics();
	assert.ok(metrics.totalBenchmarkCases >= 4);
	assert.equal(metrics.passRate, 100);
	assert.ok(metrics.averageLatencyMs > 0);
	assert.ok(metrics.canariesActive >= 3);
});
