/**
 * Safe template variable rendering.
 *
 * Substitution is a literal string replacement over a strict `{{name}}` grammar.
 * There is no expression language, no `eval`, no function call syntax and no
 * shell interpolation, so a variable value can only ever become inert text
 * inside the template layer.
 */

export const MAX_VARIABLE_NAME_LENGTH = 48;
export const MAX_VARIABLE_VALUE_LENGTH = 4_000;
export const MAX_VARIABLES_PER_TEMPLATE = 24;

/** `{{ snake_or_camel_name }}` — letters, digits and underscores only. */
const VARIABLE_TOKEN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const VALID_VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
/** C0 and C1 control bytes: stripped so a value can never forge message framing. */
// eslint-disable-next-line no-control-regex -- intentional control-character filter
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

export interface PromptVariableDefinition {
	readonly name: string;
	readonly label?: string;
	readonly description?: string;
	readonly required?: boolean;
	readonly defaultValue?: string;
}

export interface RenderTemplateResult {
	readonly text: string;
	/** Declared variables that were substituted. */
	readonly resolved: readonly string[];
	/** Tokens present in the body with no declared definition and no value. */
	readonly unresolved: readonly string[];
	/** Supplied values whose token never appears in the body. */
	readonly unused: readonly string[];
	readonly truncated: readonly string[];
}

export type PromptVariableErrorCode =
	| "INVALID_VARIABLE_NAME"
	| "DUPLICATE_VARIABLE"
	| "TOO_MANY_VARIABLES"
	| "MISSING_REQUIRED_VARIABLE";

export class PromptVariableError extends Error {
	readonly code: PromptVariableErrorCode;

	constructor(message: string, code: PromptVariableErrorCode) {
		super(message);
		this.name = "PromptVariableError";
		this.code = code;
	}
}

export function isValidVariableName(name: string): boolean {
	return (
		typeof name === "string" &&
		name.length > 0 &&
		name.length <= MAX_VARIABLE_NAME_LENGTH &&
		VALID_VARIABLE_NAME.test(name)
	);
}

/** Every `{{token}}` that appears in a template body, in first-seen order. */
export function extractVariableTokens(body: string): readonly string[] {
	const seen = new Set<string>();
	for (const match of body.matchAll(VARIABLE_TOKEN)) {
		const name = match[1];
		if (name) seen.add(name);
	}
	return [...seen];
}

export function assertValidVariableDefinitions(
	definitions: readonly PromptVariableDefinition[],
): void {
	if (definitions.length > MAX_VARIABLES_PER_TEMPLATE) {
		throw new PromptVariableError(
			`A template may declare at most ${MAX_VARIABLES_PER_TEMPLATE} variables.`,
			"TOO_MANY_VARIABLES",
		);
	}
	const seen = new Set<string>();
	for (const definition of definitions) {
		if (!isValidVariableName(definition.name)) {
			throw new PromptVariableError(
				`Invalid variable name "${String(definition.name)}". Use letters, digits and underscores, starting with a letter.`,
				"INVALID_VARIABLE_NAME",
			);
		}
		if (seen.has(definition.name)) {
			throw new PromptVariableError(
				`Variable "${definition.name}" is declared more than once.`,
				"DUPLICATE_VARIABLE",
			);
		}
		seen.add(definition.name);
	}
}

/**
 * Values are flattened to a single trimmed string and hard-capped. Control
 * characters are stripped so a value cannot forge message framing.
 */
function normalizeValue(raw: unknown): { readonly value: string; readonly truncated: boolean } {
	const asString =
		typeof raw === "string"
			? raw
			: typeof raw === "number" || typeof raw === "boolean"
				? String(raw)
				: "";
	const cleaned = asString.replace(CONTROL_CHARACTERS, "").trim();
	if (cleaned.length <= MAX_VARIABLE_VALUE_LENGTH) {
		return { value: cleaned, truncated: false };
	}
	return { value: cleaned.slice(0, MAX_VARIABLE_VALUE_LENGTH), truncated: true };
}

export function renderTemplateBody(
	body: string,
	definitions: readonly PromptVariableDefinition[],
	values: Readonly<Record<string, unknown>> = {},
): RenderTemplateResult {
	assertValidVariableDefinitions(definitions);

	const definitionByName = new Map(definitions.map((definition) => [definition.name, definition]));
	const resolved = new Set<string>();
	const unresolved = new Set<string>();
	const truncated = new Set<string>();
	const usedSupplied = new Set<string>();

	const text = body.replace(VARIABLE_TOKEN, (token, rawName: string) => {
		if (!isValidVariableName(rawName)) {
			unresolved.add(rawName);
			return token;
		}
		const definition = definitionByName.get(rawName);
		const supplied = Object.prototype.hasOwnProperty.call(values, rawName)
			? values[rawName]
			: undefined;

		if (supplied !== undefined && supplied !== null && String(supplied).trim() !== "") {
			usedSupplied.add(rawName);
			const normalized = normalizeValue(supplied);
			if (normalized.truncated) truncated.add(rawName);
			resolved.add(rawName);
			return normalized.value;
		}

		if (definition?.defaultValue !== undefined && definition.defaultValue.trim() !== "") {
			const normalized = normalizeValue(definition.defaultValue);
			if (normalized.truncated) truncated.add(rawName);
			resolved.add(rawName);
			return normalized.value;
		}

		unresolved.add(rawName);
		return token;
	});

	const unused = Object.keys(values).filter(
		(name) => !usedSupplied.has(name) && String(values[name] ?? "").trim() !== "",
	);

	return {
		text,
		resolved: [...resolved],
		unresolved: [...unresolved],
		unused,
		truncated: [...truncated],
	};
}

/**
 * Throws when a required variable has neither a supplied value nor a default.
 * Callers that prefer to surface unresolved tokens in the UI can skip this.
 */
export function assertRequiredVariablesResolved(
	definitions: readonly PromptVariableDefinition[],
	result: RenderTemplateResult,
): void {
	const missing = definitions
		.filter((definition) => definition.required)
		.filter((definition) => result.unresolved.includes(definition.name))
		.map((definition) => definition.name);
	if (missing.length > 0) {
		throw new PromptVariableError(
			`Provide a value for: ${missing.join(", ")}.`,
			"MISSING_REQUIRED_VARIABLE",
		);
	}
}

/** Normalizes untrusted JSON from the database into variable definitions. */
export function parseVariableDefinitions(raw: unknown): readonly PromptVariableDefinition[] {
	if (!Array.isArray(raw)) return [];
	const definitions: PromptVariableDefinition[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.name !== "string" || !isValidVariableName(record.name)) continue;
		definitions.push({
			name: record.name,
			label: typeof record.label === "string" ? record.label : undefined,
			description: typeof record.description === "string" ? record.description : undefined,
			required: record.required === true,
			defaultValue: typeof record.defaultValue === "string" ? record.defaultValue : undefined,
		});
		if (definitions.length >= MAX_VARIABLES_PER_TEMPLATE) break;
	}
	return definitions;
}
