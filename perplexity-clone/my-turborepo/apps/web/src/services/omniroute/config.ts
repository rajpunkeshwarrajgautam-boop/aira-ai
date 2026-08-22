export interface OmniRouteConfig {
	readonly enabled: boolean;
	readonly configured: boolean;
	readonly baseURL: string;
	readonly apiKey: string;
	readonly model: string;
	readonly timeoutMs: number;
	readonly configurationError?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parseTimeout(value: string | undefined): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed)) return 45_000;
	return Math.min(120_000, Math.max(1_000, parsed));
}

function environmentIsProduction(environment: string | undefined): boolean {
	return environment === "production";
}

function isLoopbackHost(hostname: string): boolean {
	return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Normalizes the configured OmniRoute endpoint to the OpenAI-compatible /v1
 * root while rejecting URL shapes that could hide credentials or redirect
 * server-side traffic somewhere unexpected.
 */
export function normalizeOmniRouteBaseURL(
	value: string,
	environment: string | undefined = process.env.NODE_ENV,
): string {
	const raw = value.trim();
	if (!raw) return "";

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("OMNIROUTE_BASE_URL must be a valid absolute URL.");
	}

	if (url.username || url.password) {
		throw new Error("OMNIROUTE_BASE_URL must not contain embedded credentials.");
	}
	if (url.search) {
		throw new Error("OMNIROUTE_BASE_URL must not contain a query string.");
	}
	if (url.hash) {
		throw new Error("OMNIROUTE_BASE_URL must not contain a URL fragment.");
	}

	const production = environmentIsProduction(environment);
	if (url.protocol === "http:") {
		if (production || !isLoopbackHost(url.hostname)) {
			throw new Error(
				production
					? "OMNIROUTE_BASE_URL must use HTTPS in production."
					: "Plain HTTP OmniRoute endpoints are only allowed on localhost or loopback addresses in development.",
			);
		}
	} else if (url.protocol !== "https:") {
		throw new Error("OMNIROUTE_BASE_URL must use http or https.");
	}

	const path = url.pathname.replace(/\/+$/, "");
	if (path && path !== "/v1") {
		throw new Error("OMNIROUTE_BASE_URL must point to the gateway origin or its /v1 API root.");
	}
	url.pathname = "/v1";

	return url.toString().replace(/\/$/, "");
}

export function getOmniRouteConfigOrDisabled(): OmniRouteConfig {
	const enabled = process.env.OMNIROUTE_ENABLED === "true";
	const apiKey = process.env.OMNIROUTE_API_KEY?.trim() ?? "";
	const model = process.env.OMNIROUTE_MODEL?.trim() || "auto";
	const timeoutMs = parseTimeout(process.env.OMNIROUTE_TIMEOUT_MS);

	let baseURL = "";
	let configurationError: string | undefined;
	try {
		baseURL = normalizeOmniRouteBaseURL(process.env.OMNIROUTE_BASE_URL ?? "");
	} catch (error) {
		configurationError = error instanceof Error ? error.message : "Invalid OmniRoute configuration.";
	}

	return {
		enabled,
		configured: enabled && !configurationError && Boolean(baseURL && apiKey),
		baseURL,
		apiKey,
		model,
		timeoutMs,
		...(configurationError ? { configurationError } : {}),
	};
}
