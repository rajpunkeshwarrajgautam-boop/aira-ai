export interface LocalAiConfig {
	readonly enabled: boolean;
	readonly configured: boolean;
	readonly baseURL: string;
	readonly apiKey: string;
	readonly model: string;
	readonly timeoutMs: number;
	readonly maxCompletionTokens: number;
	readonly localFirst: boolean;
	readonly required: boolean;
}

type EnvLike = Readonly<Record<string, string | undefined>>;

function parseBoolean(value: string | undefined, fallback = false): boolean {
	if (value === undefined || value.trim() === "") return fallback;
	return value.trim().toLowerCase() === "true";
}

function parseBoundedInt(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

export function normalizeLocalAiBaseURL(raw: string, nodeEnv = process.env.NODE_ENV): string {
	const trimmed = raw.trim().replace(/\/$/, "");
	if (!trimmed) return "";
	const url = new URL(trimmed);
	if (url.username || url.password || url.search || url.hash) {
		throw new Error("SELF_HOSTED_LLM_BASE_URL must not contain credentials, a query, or a fragment.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("SELF_HOSTED_LLM_BASE_URL must use http or https.");
	}
	const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
	if (nodeEnv === "production" && url.protocol !== "https:" && !loopback) {
		throw new Error("Production self-hosted inference must use HTTPS unless it is loopback-only.");
	}
	return url.toString().replace(/\/$/, "");
}

export function getLocalAiConfig(env: EnvLike = process.env): LocalAiConfig {
	const enabled = parseBoolean(env.VIREXA_LOCAL_AI_ENABLED, false);
	const baseURL = env.SELF_HOSTED_LLM_BASE_URL?.trim()
		? normalizeLocalAiBaseURL(env.SELF_HOSTED_LLM_BASE_URL, env.NODE_ENV)
		: "";
	const model = env.SELF_HOSTED_LLM_MODEL?.trim() ?? "";
	const configured = enabled && Boolean(baseURL && model);

	return {
		enabled,
		configured,
		baseURL,
		apiKey: env.SELF_HOSTED_LLM_API_KEY?.trim() || "no-key",
		model,
		timeoutMs: parseBoundedInt(env.VIREXA_LOCAL_AI_TIMEOUT_MS, 45_000, 2_000, 180_000),
		maxCompletionTokens: parseBoundedInt(env.VIREXA_LOCAL_AI_MAX_TOKENS, 1600, 128, 8192),
		localFirst: parseBoolean(env.AIRA_LOCAL_FIRST_ENABLED, false),
		required: parseBoolean(env.AIRA_LOCAL_AI_REQUIRED, false),
	};
}

export function getLocalAiConfigOrDisabled(env: EnvLike = process.env): LocalAiConfig {
	try {
		return getLocalAiConfig(env);
	} catch {
		return {
			enabled: parseBoolean(env.VIREXA_LOCAL_AI_ENABLED, false),
			configured: false,
			baseURL: "",
			apiKey: env.SELF_HOSTED_LLM_API_KEY?.trim() || "no-key",
			model: env.SELF_HOSTED_LLM_MODEL?.trim() ?? "",
			timeoutMs: parseBoundedInt(env.VIREXA_LOCAL_AI_TIMEOUT_MS, 45_000, 2_000, 180_000),
			maxCompletionTokens: parseBoundedInt(env.VIREXA_LOCAL_AI_MAX_TOKENS, 1600, 128, 8192),
			localFirst: parseBoolean(env.AIRA_LOCAL_FIRST_ENABLED, false),
			required: parseBoolean(env.AIRA_LOCAL_AI_REQUIRED, false),
		};
	}
}

export function localAiConfigured(env: EnvLike = process.env): boolean {
	return getLocalAiConfigOrDisabled(env).configured;
}
