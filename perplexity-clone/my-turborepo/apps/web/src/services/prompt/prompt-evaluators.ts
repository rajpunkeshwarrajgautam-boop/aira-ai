/**
 * Deterministic prompt evaluators.
 *
 * Every check here is a pure function of the model's output text. Nothing is
 * scored by a model, so a result is reproducible and can be reported as fact.
 * If an LLM-as-judge evaluator is added later it must be labelled as a model
 * evaluation and carry its judge model and rubric version — it does not belong
 * in this file.
 */

export type EvaluationCheckType =
	| "valid_json"
	| "contains_citation"
	| "contains_text"
	| "not_contains_text"
	| "matches_regex"
	| "min_length"
	| "max_length";

export interface EvaluationCheck {
	readonly type: EvaluationCheckType;
	/** Text, pattern or numeric bound, depending on `type`. */
	readonly value?: string;
	readonly caseSensitive?: boolean;
}

export interface EvaluationCheckResult {
	readonly type: EvaluationCheckType;
	readonly value?: string;
	readonly passed: boolean;
	readonly detail: string;
}

/** Inline citation markers AIRA emits: [1], [2] … */
const CITATION_MARKER = /\[(\d{1,3})\]/;
const MAX_REGEX_LENGTH = 200;

function normalize(text: string, caseSensitive: boolean | undefined): string {
	return caseSensitive ? text : text.toLowerCase();
}

/**
 * User-supplied patterns are compiled defensively: length-capped, no flags
 * beyond case-insensitivity, and any compile error becomes a failed check
 * rather than a thrown request.
 */
function safeRegex(pattern: string, caseSensitive: boolean | undefined): RegExp | null {
	if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > MAX_REGEX_LENGTH) {
		return null;
	}
	try {
		return new RegExp(pattern, caseSensitive ? "" : "i");
	} catch {
		return null;
	}
}

function parseBound(value: string | undefined): number | null {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractJsonCandidate(output: string): string {
	const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = (fenced?.[1] ?? output).trim();
	return candidate;
}

export function runEvaluationCheck(check: EvaluationCheck, output: string): EvaluationCheckResult {
	const text = typeof output === "string" ? output : "";

	switch (check.type) {
		case "valid_json": {
			const candidate = extractJsonCandidate(text);
			if (!candidate) {
				return { type: check.type, passed: false, detail: "Output was empty." };
			}
			try {
				JSON.parse(candidate);
				return { type: check.type, passed: true, detail: "Output parsed as JSON." };
			} catch (error) {
				return {
					type: check.type,
					passed: false,
					detail: `Output is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}.`,
				};
			}
		}
		case "contains_citation": {
			const match = text.match(CITATION_MARKER);
			return {
				type: check.type,
				passed: Boolean(match),
				detail: match
					? `Found citation marker ${match[0]}.`
					: "No inline citation marker such as [1] was present.",
			};
		}
		case "contains_text": {
			const needle = check.value ?? "";
			const passed =
				needle.length > 0 && normalize(text, check.caseSensitive).includes(normalize(needle, check.caseSensitive));
			return {
				type: check.type,
				value: needle,
				passed,
				detail: passed ? `Output contains "${needle}".` : `Output does not contain "${needle}".`,
			};
		}
		case "not_contains_text": {
			const needle = check.value ?? "";
			const present =
				needle.length > 0 && normalize(text, check.caseSensitive).includes(normalize(needle, check.caseSensitive));
			return {
				type: check.type,
				value: needle,
				passed: !present,
				detail: present ? `Output contains forbidden text "${needle}".` : `Forbidden text "${needle}" is absent.`,
			};
		}
		case "matches_regex": {
			const regex = safeRegex(check.value ?? "", check.caseSensitive);
			if (!regex) {
				return {
					type: check.type,
					value: check.value,
					passed: false,
					detail: "Pattern is empty, too long, or not a valid regular expression.",
				};
			}
			const passed = regex.test(text);
			return {
				type: check.type,
				value: check.value,
				passed,
				detail: passed ? "Output matched the pattern." : "Output did not match the pattern.",
			};
		}
		case "min_length": {
			const bound = parseBound(check.value);
			if (bound === null) {
				return { type: check.type, value: check.value, passed: false, detail: "Bound is not a number." };
			}
			const passed = text.trim().length >= bound;
			return {
				type: check.type,
				value: check.value,
				passed,
				detail: `Output is ${text.trim().length} characters; minimum ${bound}.`,
			};
		}
		case "max_length": {
			const bound = parseBound(check.value);
			if (bound === null) {
				return { type: check.type, value: check.value, passed: false, detail: "Bound is not a number." };
			}
			const passed = text.trim().length <= bound;
			return {
				type: check.type,
				value: check.value,
				passed,
				detail: `Output is ${text.trim().length} characters; maximum ${bound}.`,
			};
		}
		default: {
			return {
				type: check.type,
				passed: false,
				detail: "Unsupported check type.",
			};
		}
	}
}

export interface EvaluationCaseOutcome {
	readonly passed: boolean;
	readonly checks: readonly EvaluationCheckResult[];
}

export function runEvaluationChecks(
	checks: readonly EvaluationCheck[],
	output: string,
): EvaluationCaseOutcome {
	const results = checks.map((check) => runEvaluationCheck(check, output));
	return {
		// A case with no checks is not a pass; it is an authoring mistake.
		passed: results.length > 0 && results.every((result) => result.passed),
		checks: results,
	};
}

const CHECK_TYPES: readonly EvaluationCheckType[] = [
	"valid_json",
	"contains_citation",
	"contains_text",
	"not_contains_text",
	"matches_regex",
	"min_length",
	"max_length",
];

export function parseEvaluationChecks(raw: unknown): readonly EvaluationCheck[] {
	if (!Array.isArray(raw)) return [];
	const checks: EvaluationCheck[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		const type = record.type;
		if (typeof type !== "string" || !CHECK_TYPES.includes(type as EvaluationCheckType)) continue;
		checks.push({
			type: type as EvaluationCheckType,
			value: typeof record.value === "string" ? record.value : undefined,
			caseSensitive: record.caseSensitive === true,
		});
		if (checks.length >= 12) break;
	}
	return checks;
}

export const EVALUATION_CHECK_TYPES = CHECK_TYPES;
