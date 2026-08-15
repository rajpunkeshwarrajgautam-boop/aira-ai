const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_TIMEOUT_MS = 2_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;

export interface AutoGptConfig {
	readonly baseUrl: URL;
	readonly apiKey: string;
	readonly graphId: string;
	readonly graphVersion: number;
	readonly inputNodeId: string;
	readonly inputField: string;
	readonly requestTimeoutMs: number;
}

export class AutoGptConfigError extends Error {
	readonly code = "AUTOGPT_NOT_CONFIGURED";
}

function env(name: string): string {
	return process.env[name]?.trim() ?? "";
}

function parsePositiveInteger(raw: string, name: string): number {
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) {
		throw new AutoGptConfigError(`${name} must be a positive integer.`);
	}
	return value;
}

export function isAutoGptEnabled(): boolean {
	return env("AUTOGPT_AGENT_ENABLED").toLowerCase() === "true";
}

export function isAutoGptConfigured(): boolean {
	try {
		getAutoGptConfig();
		return true;
	} catch {
		return false;
	}
}

export function getAutoGptConfig(): AutoGptConfig {
	if (!isAutoGptEnabled()) {
		throw new AutoGptConfigError("AutoGPT agent tasks are not enabled.");
	}

	const baseUrlRaw = env("AUTOGPT_API_BASE_URL");
	const apiKey = env("AUTOGPT_API_KEY");
	const graphId = env("AUTOGPT_GRAPH_ID");
	const graphVersionRaw = env("AUTOGPT_GRAPH_VERSION");
	const inputNodeId = env("AUTOGPT_INPUT_NODE_ID");
	const inputField = env("AUTOGPT_INPUT_FIELD") || "value";

	if (!baseUrlRaw || !apiKey || !graphId || !graphVersionRaw || !inputNodeId) {
		throw new AutoGptConfigError(
			"AutoGPT requires an API base URL, API key, graph ID, graph version, and input node ID.",
		);
	}
	if (!/^[A-Za-z0-9_-]{1,100}$/.test(inputField)) {
		throw new AutoGptConfigError(
			"AUTOGPT_INPUT_FIELD must contain only letters, numbers, underscores, or hyphens.",
		);
	}

	let baseUrl: URL;
	try {
		baseUrl = new URL(baseUrlRaw);
	} catch {
		throw new AutoGptConfigError("AUTOGPT_API_BASE_URL must be a valid URL.");
	}

	if (baseUrl.protocol !== "https:" && process.env.NODE_ENV === "production") {
		throw new AutoGptConfigError("AUTOGPT_API_BASE_URL must use HTTPS in production.");
	}
	if (!["https:", "http:"].includes(baseUrl.protocol)) {
		throw new AutoGptConfigError("AUTOGPT_API_BASE_URL must use HTTP or HTTPS.");
	}
	if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
		throw new AutoGptConfigError(
			"AUTOGPT_API_BASE_URL cannot contain credentials, a query, or a fragment.",
		);
	}

	baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");

	const timeoutRaw = env("AUTOGPT_REQUEST_TIMEOUT_MS");
	const parsedTimeout = timeoutRaw
		? parsePositiveInteger(timeoutRaw, "AUTOGPT_REQUEST_TIMEOUT_MS")
		: DEFAULT_REQUEST_TIMEOUT_MS;
	const requestTimeoutMs = Math.min(
		MAX_REQUEST_TIMEOUT_MS,
		Math.max(MIN_REQUEST_TIMEOUT_MS, parsedTimeout),
	);

	return {
		baseUrl,
		apiKey,
		graphId,
		graphVersion: parsePositiveInteger(graphVersionRaw, "AUTOGPT_GRAPH_VERSION"),
		inputNodeId,
		inputField,
		requestTimeoutMs,
	};
}
