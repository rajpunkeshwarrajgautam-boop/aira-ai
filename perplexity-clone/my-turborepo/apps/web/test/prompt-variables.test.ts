import assert from "node:assert/strict";
import test from "node:test";

import {
	assertValidVariableDefinitions,
	extractVariableTokens,
	isValidVariableName,
	MAX_VARIABLES_PER_TEMPLATE,
	MAX_VARIABLE_VALUE_LENGTH,
	parseVariableDefinitions,
	renderTemplateBody,
} from "@services/prompt/prompt-variables";

test("variable names are restricted to a safe identifier grammar", () => {
	for (const valid of ["audience", "output_format", "topicA1", "a"]) {
		assert.ok(isValidVariableName(valid), `${valid} should be valid`);
	}
	for (const invalid of [
		"1topic",
		"out-put",
		"a b",
		"process.env",
		"__proto__.x",
		"",
		"x".repeat(49),
		"require",
	]) {
		if (invalid === "require") {
			// A bare identifier is syntactically fine; it is inert because
			// substitution never evaluates anything.
			assert.ok(isValidVariableName(invalid));
			continue;
		}
		assert.ok(!isValidVariableName(invalid), `${invalid} should be rejected`);
	}
});

test("duplicate and over-limit variable declarations are rejected", () => {
	assert.throws(
		() => assertValidVariableDefinitions([{ name: "a" }, { name: "a" }]),
		/declared more than once/,
	);
	assert.throws(
		() =>
			assertValidVariableDefinitions(
				Array.from({ length: MAX_VARIABLES_PER_TEMPLATE + 1 }, (_, index) => ({
					name: `v${index}`,
				})),
			),
		/at most/,
	);
	assert.throws(() => assertValidVariableDefinitions([{ name: "bad-name" }]), /Invalid variable name/);
});

test("substitution is literal — no expression evaluation of any kind", () => {
	const result = renderTemplateBody(
		"A: {{a}} B: {{b}} C: {{c}}",
		[{ name: "a" }, { name: "b" }, { name: "c" }],
		{
			a: "${process.env.OPENAI_API_KEY}",
			b: "`rm -rf /`",
			c: "{{a}}",
		},
	);
	assert.equal(result.text, "A: ${process.env.OPENAI_API_KEY} B: `rm -rf /` C: {{a}}");
	// A value that itself looks like a token is not re-expanded.
	assert.ok(!result.text.includes("A: A:"));
});

test("control characters are stripped from values", () => {
	const withControls = ["line", String.fromCharCode(0), String.fromCharCode(27), "end"].join("");
	const result = renderTemplateBody("V: {{v}}", [{ name: "v" }], { v: withControls });
	assert.equal(result.text, "V: lineend");
});

test("values are length capped and the truncation is reported", () => {
	const result = renderTemplateBody("V: {{v}}", [{ name: "v" }], {
		v: "y".repeat(MAX_VARIABLE_VALUE_LENGTH + 500),
	});
	assert.equal(result.text.length, "V: ".length + MAX_VARIABLE_VALUE_LENGTH);
	assert.deepEqual(result.truncated, ["v"]);
});

test("token extraction and unused-value reporting", () => {
	assert.deepEqual(extractVariableTokens("{{a}} {{ b }} {{a}} plain"), ["a", "b"]);
	const result = renderTemplateBody("only {{a}}", [{ name: "a" }], { a: "x", unusedOne: "y" });
	assert.deepEqual(result.resolved, ["a"]);
	assert.deepEqual(result.unused, ["unusedOne"]);
});

test("stored variable JSON is normalized defensively", () => {
	const parsed = parseVariableDefinitions([
		{ name: "good", required: true, defaultValue: "d" },
		{ name: "bad-name" },
		"not an object",
		null,
		{ label: "no name" },
	]);
	assert.equal(parsed.length, 1);
	assert.equal(parsed[0]?.name, "good");
	assert.equal(parsed[0]?.required, true);
	assert.deepEqual(parseVariableDefinitions("not an array"), []);
	assert.deepEqual(parseVariableDefinitions(null), []);
});
