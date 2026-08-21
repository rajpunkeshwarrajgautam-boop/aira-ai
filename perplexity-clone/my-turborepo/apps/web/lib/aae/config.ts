const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_TIMEOUT_MS = 2_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_500;
const MIN_HEALTH_TIMEOUT_MS = 500;
const MAX_HEALTH_TIMEOUT_MS = 5_000;

export interface AaeConfig {
	readonly baseUrl: URL;
	readonly internalAuthToken: string;
	readonly allowedUserId: string;
	readonly requestTimeoutMs: number;
	readonly healthTimeoutMs: number;
}

export class AaeConfigError extends Error {
	readonly code = "AAE_NOT_CONFIGURED";
}

function env(name: string): string {
	return process.env[name]?.trim() ?? "";
}

function envTrue(name: string): boolean {
	return env(name).toLowerCase() === "true";
}

function boundedTimeout(name: string, fallback: number, min: number, max: number): number {
	const raw = env(name);
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) {
		throw new AaeConfigError(`${name} must be a positive integer.`);
	}
	return Math.min(max, Math.max(min, value));
}

export function isAaeEnabled(): boolean {
	return envTrue("AAE_AGENT_ENABLED");
}

export function getAaeConfig(): AaeConfig {
	if (!isAaeEnabled()) {
		throw new AaeConfigError("AIRA Autonomous Agent Engine is not enabled.");
	}
	const baseUrlRaw = env("AAE_API_BASE_URL");
	const internalAuthToken = env("AAE_INTERNAL_AUTH_TOKEN");
	const allowedUserId = env("AAE_ALLOWED_USER_ID");
	if (!baseUrlRaw || !internalAuthToken || !allowedUserId) {
		throw new AaeConfigError(
			"AAE requires AAE_API_BASE_URL, AAE_INTERNAL_AUTH_TOKEN and AAE_ALLOWED_USER_ID.",
		);
	}
	if (allowedUserId.length > 256) {
		throw new AaeConfigError("AAE_ALLOWED_USER_ID is invalid.");
	}

	let baseUrl: URL;
	try {
		baseUrl = new URL(baseUrlRaw);
	} catch {
		throw new AaeConfigError("AAE_API_BASE_URL must be a valid URL.");
	}
	if (!["https:", "http:"].includes(baseUrl.protocol)) {
		throw new AaeConfigError("AAE_API_BASE_URL must use HTTP or HTTPS.");
	}
	if (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:") {
		throw new AaeConfigError("AAE_API_BASE_URL must use HTTPS in production.");
	}
	if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
		throw new AaeConfigError("AAE_API_BASE_URL cannot contain credentials, a query, or a fragment.");
	}
	baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");

	return {
		baseUrl,
		internalAuthToken,
		allowedUserId,
		requestTimeoutMs: boundedTimeout(
			"AAE_REQUEST_TIMEOUT_MS",
			DEFAULT_REQUEST_TIMEOUT_MS,
			MIN_REQUEST_TIMEOUT_MS,
			MAX_REQUEST_TIMEOUT_MS,
		),
		healthTimeoutMs: boundedTimeout(
			"AAE_HEALTH_TIMEOUT_MS",
			DEFAULT_HEALTH_TIMEOUT_MS,
			MIN_HEALTH_TIMEOUT_MS,
			MAX_HEALTH_TIMEOUT_MS,
		),
	};
}

export function isAaeConfigured(): boolean {
	try {
		getAaeConfig();
		return true;
	} catch {
		return false;
	}
}

export function isAaeUserAllowed(userId: string): boolean {
	try {
		return getAaeConfig().allowedUserId === userId;
	} catch {
		return false;
	}
}
