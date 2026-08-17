const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_TIMEOUT_MS = 2_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const MIN_HEALTH_TIMEOUT_MS = 500;
const MAX_HEALTH_TIMEOUT_MS = 5_000;

export interface AutoGptTarget {
	readonly id: "primary" | "secondary";
	readonly baseUrl: URL;
	readonly apiKey: string;
}

export interface AutoGptConfig {
	readonly targets: readonly AutoGptTarget[];
	readonly graphId: string;
	readonly graphVersion: number;
	readonly inputNodeId: string;
	readonly inputField: string;
	readonly requestTimeoutMs: number;
	readonly healthTimeoutMs: number;
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

function parseTarget(
	id: AutoGptTarget["id"],
	baseUrlRaw: string,
	apiKey: string,
): AutoGptTarget {
	let baseUrl: URL;
	try {
		baseUrl = new URL(baseUrlRaw);
	} catch {
		throw new AutoGptConfigError(`AUTOGPT_${id.toUpperCase()}_API_BASE_URL must be a valid URL.`);
	}

	if (baseUrl.protocol !== "https:" && process.env.NODE_ENV === "production") {
		throw new AutoGptConfigError(
			`AUTOGPT_${id.toUpperCase()}_API_BASE_URL must use HTTPS in production.`,
		);
	}
	if (!["https:", "http:"].includes(baseUrl.protocol)) {
		throw new AutoGptConfigError(
			`AUTOGPT_${id.toUpperCase()}_API_BASE_URL must use HTTP or HTTPS.`,
		);
	}
	if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
		throw new AutoGptConfigError(
			`AUTOGPT_${id.toUpperCase()}_API_BASE_URL cannot contain credentials, a query, or a fragment.`,
		);
	}

	baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");
	return { id, baseUrl, apiKey };
}

export function getAutoGptConfig(): AutoGptConfig {
	if (!isAutoGptEnabled()) {
		throw new AutoGptConfigError("AutoGPT agent tasks are not enabled.");
	}

	const primaryBaseUrlRaw =
		env("AUTOGPT_PRIMARY_API_BASE_URL") || env("AUTOGPT_API_BASE_URL");
	const primaryApiKey = env("AUTOGPT_PRIMARY_API_KEY") || env("AUTOGPT_API_KEY");
	const secondaryBaseUrlRaw = env("AUTOGPT_SECONDARY_API_BASE_URL");
	const secondaryApiKey = env("AUTOGPT_SECONDARY_API_KEY");
	const graphId = env("AUTOGPT_GRAPH_ID");
	const graphVersionRaw = env("AUTOGPT_GRAPH_VERSION");
	const inputNodeId = env("AUTOGPT_INPUT_NODE_ID");
	const inputField = env("AUTOGPT_INPUT_FIELD") || "value";

	if (!primaryBaseUrlRaw || !primaryApiKey || !graphId || !graphVersionRaw || !inputNodeId) {
		throw new AutoGptConfigError(
			"AutoGPT requires a primary API base URL and key, graph ID, graph version, and input node ID.",
		);
	}
	if (Boolean(secondaryBaseUrlRaw) !== Boolean(secondaryApiKey)) {
		throw new AutoGptConfigError(
			"AutoGPT secondary failover requires both AUTOGPT_SECONDARY_API_BASE_URL and AUTOGPT_SECONDARY_API_KEY.",
		);
	}
	if (!/^[A-Za-z0-9_-]{1,100}$/.test(inputField)) {
		throw new AutoGptConfigError(
			"AUTOGPT_INPUT_FIELD must contain only letters, numbers, underscores, or hyphens.",
		);
	}

	const targets: AutoGptTarget[] = [
		parseTarget("primary", primaryBaseUrlRaw, primaryApiKey),
	];
	if (secondaryBaseUrlRaw && secondaryApiKey) {
		targets.push(parseTarget("secondary", secondaryBaseUrlRaw, secondaryApiKey));
	}
	if (
		targets.length === 2 &&
		targets[0]?.baseUrl.toString() === targets[1]?.baseUrl.toString()
	) {
		throw new AutoGptConfigError("AutoGPT primary and secondary API URLs must be different.");
	}

	const timeoutRaw = env("AUTOGPT_REQUEST_TIMEOUT_MS");
	const parsedTimeout = timeoutRaw
		? parsePositiveInteger(timeoutRaw, "AUTOGPT_REQUEST_TIMEOUT_MS")
		: DEFAULT_REQUEST_TIMEOUT_MS;
	const requestTimeoutMs = Math.min(
		MAX_REQUEST_TIMEOUT_MS,
		Math.max(MIN_REQUEST_TIMEOUT_MS, parsedTimeout),
	);
	const healthTimeoutRaw = env("AUTOGPT_HEALTH_TIMEOUT_MS");
	const parsedHealthTimeout = healthTimeoutRaw
		? parsePositiveInteger(healthTimeoutRaw, "AUTOGPT_HEALTH_TIMEOUT_MS")
		: DEFAULT_HEALTH_TIMEOUT_MS;
	const healthTimeoutMs = Math.min(
		MAX_HEALTH_TIMEOUT_MS,
		Math.max(MIN_HEALTH_TIMEOUT_MS, parsedHealthTimeout),
	);

	return {
		targets,
		graphId,
		graphVersion: parsePositiveInteger(graphVersionRaw, "AUTOGPT_GRAPH_VERSION"),
		inputNodeId,
		inputField,
		requestTimeoutMs,
		healthTimeoutMs,
	};
}
