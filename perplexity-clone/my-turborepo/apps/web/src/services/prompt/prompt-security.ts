/**
 * Static prompt analysis.
 *
 * This is a lint pass over prompt text, not a security guarantee. It flags
 * patterns that historically correlate with instruction-override attempts,
 * prompt disclosure, exfiltration and over-broad tool authority so an author
 * can see them before publishing. The runtime protection that actually holds
 * is the layer hierarchy in `prompt-layers.ts`: a template is compiled below
 * AIRA's protected layers whether or not the analyzer flags anything.
 */

import { extractVariableTokens, type PromptVariableDefinition } from "./prompt-variables";

export type PromptFindingSeverity = "info" | "warning" | "high";

export type PromptFindingCategory =
	| "instruction-override"
	| "prompt-disclosure"
	| "secret-exfiltration"
	| "tool-escalation"
	| "conflicting-instructions"
	| "unresolved-variable"
	| "encoded-content"
	| "prompt-size"
	| "weak-output-constraints";

export interface PromptSecurityFinding {
	readonly category: PromptFindingCategory;
	readonly severity: PromptFindingSeverity;
	readonly message: string;
	/** Short excerpt of the matched text, for the author to locate it. */
	readonly evidence?: string;
}

export interface PromptSecurityReport {
	readonly findings: readonly PromptSecurityFinding[];
	readonly maxSeverity: PromptFindingSeverity | null;
	readonly counts: Readonly<Record<PromptFindingSeverity, number>>;
	readonly analyzedCharacters: number;
	/**
	 * Always true: templates are compiled into the `template` layer regardless of
	 * findings, so AIRA's protected layers stay above them.
	 */
	readonly protectedLayersEnforced: true;
}

/** Prompts beyond this size are almost always accidental paste-ins. */
export const PROMPT_SIZE_WARNING = 12_000;
export const PROMPT_SIZE_HIGH = 40_000;

const SEVERITY_ORDER: Record<PromptFindingSeverity, number> = {
	info: 0,
	warning: 1,
	high: 2,
};

interface PatternRule {
	readonly category: PromptFindingCategory;
	readonly severity: PromptFindingSeverity;
	readonly pattern: RegExp;
	readonly message: string;
}

const RULES: readonly PatternRule[] = [
	{
		category: "instruction-override",
		severity: "high",
		pattern:
			/\b(ignore|disregard|forget|override|bypass|discard)\b[^.\n]{0,40}\b(all\s+)?(previous|prior|earlier|above|preceding|system|initial|original)\b[^.\n]{0,20}\b(instruction|prompt|rule|direction|message|guideline)/i,
		message:
			"Reads as an attempt to cancel earlier instructions. AIRA's core, runtime and mode layers cannot be overridden by a template, so this text will not take effect and may confuse the model.",
	},
	{
		category: "instruction-override",
		severity: "warning",
		pattern:
			/\byou\s+are\s+no\s+longer\b|\bstop\s+being\b[^.\n]{0,30}\b(assistant|aira)\b|\bfrom\s+now\s+on\s+you\s+(are|will\s+be)\b/i,
		message:
			"Attempts to replace the assistant's identity. AIRA's identity layer stays in force above the template.",
	},
	{
		category: "prompt-disclosure",
		severity: "high",
		pattern:
			/\b(reveal|print|repeat|output|show|display|dump|recite|verbatim)\b[^.\n]{0,40}\b(system\s+prompts?|hidden\s+(instruction|rule|prompt)s?|initial\s+prompts?|your\s+instructions?|prompt\s+above|everything\s+above)\b/i,
		message:
			"Requests disclosure of protected instructions. AIRA never emits its core prompt; keep this out of a published template.",
	},
	{
		category: "prompt-disclosure",
		severity: "warning",
		pattern: /\bwhat\s+(is|are)\s+your\s+(system\s+prompt|original\s+instructions|hidden\s+rules)\b/i,
		message: "Asks the model to describe its protected instructions.",
	},
	{
		category: "secret-exfiltration",
		severity: "high",
		pattern:
			/\b(api[_\s-]?key|access[_\s-]?token|secret[_\s-]?key|client[_\s-]?secret|private\s+key|database\s+(url|credential|password)|env(ironment)?\s+variable)\b/i,
		message:
			"References credentials or environment secrets. Server-side secrets are never available to prompt text and must not be requested in a template.",
	},
	{
		category: "secret-exfiltration",
		severity: "high",
		pattern: /\b(send|post|upload|transmit|exfiltrate|forward)\b[^.\n]{0,40}\bto\s+https?:\/\//i,
		message: "Instructs the model to transmit content to an external URL.",
	},
	{
		category: "tool-escalation",
		severity: "high",
		// No \b before the alternation: a boundary never matches between a space
		// and a leading "/" or ".", which would silently skip /etc/ and .env.
		pattern:
			/\b(read|open|cat|access|list)\b[^.\n]{0,30}(\/etc\/|\/proc\/|server\s+config\w*|environment\s+files?|\.env\b|credential\s+stores?)/i,
		message: "Instructs the model to read server configuration or credential storage.",
	},
	{
		category: "tool-escalation",
		severity: "warning",
		pattern:
			/\b(use|call|invoke|run)\s+(any|all|every|whatever)\s+(tool|tools|function|functions|command)/i,
		message:
			"Grants unbounded tool authority. Tool permission checks stay server-side, but broad wording produces unreliable behavior.",
	},
	{
		category: "tool-escalation",
		severity: "warning",
		pattern: /\b(without|no need for|skip)\s+(asking|approval|confirmation|permission)\b/i,
		message:
			"Attempts to skip human approval. AIRA's tool-approval gate is enforced independently of prompt text.",
	},
	{
		category: "conflicting-instructions",
		severity: "warning",
		pattern:
			/\b(never|do\s+not|don't)\s+(cite|include\s+citations|reference\s+sources|provide\s+sources)\b/i,
		message:
			"Disables citations. In research mode AIRA's citation policy wins, so this instruction will be ignored there.",
	},
	{
		category: "conflicting-instructions",
		severity: "warning",
		pattern: /\b(always\s+(agree|comply)|never\s+(refuse|decline|disagree)|no\s+restrictions?)\b/i,
		message:
			"Attempts to remove refusal or disagreement behavior. AIRA's safety and honesty invariants are not template-configurable.",
	},
	{
		category: "conflicting-instructions",
		severity: "info",
		pattern: /\b(make\s+up|invent|fabricate|guess)\b[^.\n]{0,30}\b(source|citation|statistic|number|url)\b/i,
		message: "Encourages fabricated evidence, which AIRA's grounding rules forbid.",
	},
	{
		category: "encoded-content",
		severity: "warning",
		pattern: /\b(base64|rot13|hex[-\s]?encoded|percent[-\s]?encoded)\b/i,
		message:
			"Mentions an encoding scheme. Encoded payloads are a common way to smuggle instructions past review.",
	},
];

/** A long unbroken base64-ish run is suspicious in prose. */
const BASE64_BLOB = /[A-Za-z0-9+/]{120,}={0,2}/;
/** Bidi and zero-width characters used to hide text from a reviewer. */
const HIDDEN_CHARACTERS = new RegExp(
	"[" + "\\u200B-\\u200F" + "\\u202A-\\u202E" + "\\u2066-\\u2069" + "\\uFEFF" + "]",
);

const OUTPUT_CONSTRAINT_HINT =
	/\b(format|structure|respond\s+with|output|return|answer\s+in|sections?|bullet|table|json|markdown|length|words?|paragraphs?|tone|audience|steps?)\b/i;

function excerpt(source: string, match: RegExpMatchArray): string {
	const index = match.index ?? 0;
	const start = Math.max(0, index - 24);
	const raw = source.slice(start, Math.min(source.length, index + match[0].length + 24));
	return raw.replace(/\s+/g, " ").trim().slice(0, 160);
}

export interface AnalyzePromptOptions {
	readonly variables?: readonly PromptVariableDefinition[];
	/** Set for external corpus material so size limits are reported, not enforced. */
	readonly isExternalReference?: boolean;
}

export function analyzePromptBody(
	body: string,
	options: AnalyzePromptOptions = {},
): PromptSecurityReport {
	const findings: PromptSecurityFinding[] = [];
	const text = typeof body === "string" ? body : "";

	for (const rule of RULES) {
		const match = text.match(rule.pattern);
		if (!match) continue;
		findings.push({
			category: rule.category,
			severity: rule.severity,
			message: rule.message,
			evidence: excerpt(text, match),
		});
	}

	const base64Match = text.match(BASE64_BLOB);
	if (base64Match) {
		findings.push({
			category: "encoded-content",
			severity: "warning",
			message:
				"Contains a long encoded-looking run. Review it before publishing — reviewers cannot read what it says.",
			evidence: `${base64Match[0].slice(0, 40)}… (${base64Match[0].length} characters)`,
		});
	}

	if (HIDDEN_CHARACTERS.test(text)) {
		findings.push({
			category: "encoded-content",
			severity: "high",
			message:
				"Contains zero-width or bidirectional control characters, which can hide instructions from a human reviewer.",
		});
	}

	if (text.length >= PROMPT_SIZE_HIGH) {
		findings.push({
			category: "prompt-size",
			severity: "high",
			message: `Prompt is ${text.length.toLocaleString("en-US")} characters. This crowds out evidence and conversation context in every request.`,
		});
	} else if (text.length >= PROMPT_SIZE_WARNING) {
		findings.push({
			category: "prompt-size",
			severity: "warning",
			message: `Prompt is ${text.length.toLocaleString("en-US")} characters. Long prompts reduce the context budget available for retrieved evidence.`,
		});
	}

	const declared = new Set((options.variables ?? []).map((definition) => definition.name));
	const undeclared = extractVariableTokens(text).filter((token) => !declared.has(token));
	if (undeclared.length > 0) {
		findings.push({
			category: "unresolved-variable",
			severity: "warning",
			message: `Uses undeclared variable${undeclared.length > 1 ? "s" : ""}: ${undeclared.join(", ")}. Undeclared tokens are left in the prompt literally.`,
		});
	}

	if (!options.isExternalReference && text.trim().length > 0 && !OUTPUT_CONSTRAINT_HINT.test(text)) {
		findings.push({
			category: "weak-output-constraints",
			severity: "info",
			message:
				"No output format, length, audience or tone guidance found. Templates without constraints produce inconsistent results across models.",
		});
	}

	const counts = { info: 0, warning: 0, high: 0 };
	for (const finding of findings) counts[finding.severity] += 1;

	let maxSeverity: PromptFindingSeverity | null = null;
	for (const finding of findings) {
		if (maxSeverity === null || SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[maxSeverity]) {
			maxSeverity = finding.severity;
		}
	}

	return {
		findings,
		maxSeverity,
		counts,
		analyzedCharacters: text.length,
		protectedLayersEnforced: true,
	};
}

/** Compact JSON form persisted on a PromptVersion row. */
export function serializeSecurityReport(report: PromptSecurityReport): {
	readonly findings: readonly PromptSecurityFinding[];
	readonly counts: Readonly<Record<PromptFindingSeverity, number>>;
	readonly analyzedCharacters: number;
} {
	return {
		findings: report.findings,
		counts: report.counts,
		analyzedCharacters: report.analyzedCharacters,
	};
}
