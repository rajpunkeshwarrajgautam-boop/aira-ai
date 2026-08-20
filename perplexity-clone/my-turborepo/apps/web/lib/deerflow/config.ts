const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_TIMEOUT_MS = 2_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_500;
const MIN_HEALTH_TIMEOUT_MS = 500;
const MAX_HEALTH_TIMEOUT_MS = 5_000;

export interface DeerFlowConfig {
	readonly baseUrl: URL;
	readonly internalAuthToken: string;
	readonly requestTimeoutMs: number;
	readonly healthTimeoutMs: number;
	readonly modelName?: string;
	readonly thinkingEnabled: boolean;
	readonly planMode: boolean;
}

export class DeerFlowConfigError extends Error {
	readonly code = "DEERFLOW_NOT_CONFIGURED";
}

function env(name: string): string {
	return process.env[name]?.trim() ?? "";
}

function envTrue(name: string): boolean {
	return env(name).toLowerCase() === "true";
}

function parsePositiveInteger(raw: string, name: string): number {
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) {
		throw new DeerFlowConfigError(`${name} must be a positive integer.`);
	}
	return value;
}

function boundedTimeout(name: string, fallback: number, min: number, max: number): number {
	const raw = env(name);
	const parsed = raw ? parsePositiveInteger(raw, name) : fallback;
	return Math.min(max, Math.max(min, parsed));
}

export function isDeerFlowEnabled(): boolean {
	return envTrue("DEERFLOW_AGENT_ENABLED");
}

export function getDeerFlowConfig(): DeerFlowConfig {
	if (!isDeerFlowEnabled()) {
		throw new DeerFlowConfigError("DeerFlow SuperAgent is not enabled.");
	}

	const baseUrlRaw = env("DEERFLOW_API_BASE_URL");
	const internalAuthToken = env("DEERFLOW_INTERNAL_AUTH_TOKEN");
	if (!baseUrlRaw || !internalAuthToken) {
		throw new DeerFlowConfigError(
			"DeerFlow requires DEERFLOW_API_BASE_URL and DEERFLOW_INTERNAL_AUTH_TOKEN.",
		);
	}

	let baseUrl: URL;
	try {
		baseUrl = new URL(baseUrlRaw);
	} catch {
		throw new DeerFlowConfigError("DEERFLOW_API_BASE_URL must be a valid URL.");
	}
	if (!["https:", "http:"].includes(baseUrl.protocol)) {
		throw new DeerFlowConfigError("DEERFLOW_API_BASE_URL must use HTTP or HTTPS.");
	}
	if (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:") {
		throw new DeerFlowConfigError("DEERFLOW_API_BASE_URL must use HTTPS in production.");
	}
	if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
		throw new DeerFlowConfigError(
			"DEERFLOW_API_BASE_URL cannot contain credentials, a query, or a fragment.",
		);
	}
	baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");

	return {
		baseUrl,
		internalAuthToken,
		requestTimeoutMs: boundedTimeout(
			"DEERFLOW_REQUEST_TIMEOUT_MS",
			DEFAULT_REQUEST_TIMEOUT_MS,
			MIN_REQUEST_TIMEOUT_MS,
			MAX_REQUEST_TIMEOUT_MS,
		),
		healthTimeoutMs: boundedTimeout(
			"DEERFLOW_HEALTH_TIMEOUT_MS",
			DEFAULT_HEALTH_TIMEOUT_MS,
			MIN_HEALTH_TIMEOUT_MS,
			MAX_HEALTH_TIMEOUT_MS,
		),
		modelName: env("DEERFLOW_MODEL_NAME") || undefined,
		thinkingEnabled: envTrue("DEERFLOW_THINKING_ENABLED"),
		planMode: env("DEERFLOW_PLAN_MODE") ? envTrue("DEERFLOW_PLAN_MODE") : true,
	};
}

export function isDeerFlowConfigured(): boolean {
	try {
		getDeerFlowConfig();
		return true;
	} catch {
		return false;
	}
}
