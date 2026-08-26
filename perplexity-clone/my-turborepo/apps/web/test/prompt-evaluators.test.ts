import assert from "node:assert/strict";
import test from "node:test";

import {
	EVALUATION_CHECK_TYPES,
	parseEvaluationChecks,
	runEvaluationCheck,
	runEvaluationChecks,
} from "@services/prompt/prompt-evaluators";

test("valid_json accepts bare and fenced JSON, rejects prose", () => {
	assert.equal(runEvaluationCheck({ type: "valid_json" }, '{"a":1}').passed, true);
	assert.equal(
		runEvaluationCheck({ type: "valid_json" }, '```json\n{"a": [1,2]}\n```').passed,
		true,
	);
	assert.equal(runEvaluationCheck({ type: "valid_json" }, "Here is your answer.").passed, false);
	assert.equal(runEvaluationCheck({ type: "valid_json" }, "").passed, false);
});

test("contains_citation looks for real inline markers", () => {
	assert.equal(runEvaluationCheck({ type: "contains_citation" }, "Revenue rose [1].").passed, true);
	assert.equal(runEvaluationCheck({ type: "contains_citation" }, "Revenue rose [12].").passed, true);
	assert.equal(runEvaluationCheck({ type: "contains_citation" }, "Revenue rose.").passed, false);
	assert.equal(runEvaluationCheck({ type: "contains_citation" }, "See [source].").passed, false);
});

test("text containment checks honour case sensitivity", () => {
	assert.equal(runEvaluationCheck({ type: "contains_text", value: "Risk" }, "risk noted").passed, true);
	assert.equal(
		runEvaluationCheck({ type: "contains_text", value: "Risk", caseSensitive: true }, "risk noted")
			.passed,
		false,
	);
	assert.equal(
		runEvaluationCheck({ type: "not_contains_text", value: "guaranteed" }, "no promises here").passed,
		true,
	);
	assert.equal(
		runEvaluationCheck({ type: "not_contains_text", value: "guaranteed" }, "Guaranteed returns")
			.passed,
		false,
	);
});

test("regex checks are compiled defensively and never throw", () => {
	assert.equal(runEvaluationCheck({ type: "matches_regex", value: "^Answer:" }, "Answer: yes").passed, true);
	assert.equal(runEvaluationCheck({ type: "matches_regex", value: "[unclosed" }, "x").passed, false);
	assert.equal(runEvaluationCheck({ type: "matches_regex", value: "" }, "x").passed, false);
	assert.equal(
		runEvaluationCheck({ type: "matches_regex", value: "a".repeat(500) }, "x").passed,
		false,
		"over-long patterns are refused rather than compiled",
	);
});

test("length bounds are measured on trimmed output", () => {
	assert.equal(runEvaluationCheck({ type: "min_length", value: "5" }, "  hello  ").passed, true);
	assert.equal(runEvaluationCheck({ type: "min_length", value: "10" }, "hello").passed, false);
	assert.equal(runEvaluationCheck({ type: "max_length", value: "5" }, "hello").passed, true);
	assert.equal(runEvaluationCheck({ type: "max_length", value: "3" }, "hello").passed, false);
	assert.equal(runEvaluationCheck({ type: "max_length", value: "abc" }, "hello").passed, false);
});

test("a case passes only when every check passes, and never with zero checks", () => {
	const output = 'Answer: yes [1]. {"ok":true}';
	assert.equal(
		runEvaluationChecks(
			[{ type: "contains_citation" }, { type: "contains_text", value: "Answer" }],
			output,
		).passed,
		true,
	);
	assert.equal(
		runEvaluationChecks(
			[{ type: "contains_citation" }, { type: "contains_text", value: "missing" }],
			output,
		).passed,
		false,
	);
	assert.equal(
		runEvaluationChecks([], output).passed,
		false,
		"a case with no checks is an authoring mistake, not a pass",
	);
});

test("stored check JSON is normalized and capped", () => {
	const parsed = parseEvaluationChecks([
		{ type: "contains_citation" },
		{ type: "nonsense_check" },
		"bad",
		null,
		{ type: "min_length", value: "10", caseSensitive: true },
	]);
	assert.equal(parsed.length, 2);
	assert.deepEqual(
		parsed.map((check) => check.type),
		["contains_citation", "min_length"],
	);
	assert.equal(parseEvaluationChecks("nope").length, 0);
	assert.equal(
		parseEvaluationChecks(Array.from({ length: 40 }, () => ({ type: "valid_json" }))).length,
		12,
	);
});

test("every declared check type is executable", () => {
	for (const type of EVALUATION_CHECK_TYPES) {
		const result = runEvaluationCheck({ type, value: "1" }, "sample [1] output");
		assert.equal(typeof result.passed, "boolean", `${type} must produce a boolean result`);
		assert.ok(result.detail.length > 0, `${type} must explain its result`);
	}
});
