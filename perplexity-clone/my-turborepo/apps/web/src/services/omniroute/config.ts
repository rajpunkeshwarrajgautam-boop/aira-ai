export interface OmniRouteConfig {
	readonly enabled: boolean;
	readonly configured: boolean;
	readonly baseURL: string;
	readonly apiKey: string;
	readonly model: string;
	readonly timeoutMs: number;
}

function parseTimeout(value: string | undefined): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed)) return 45_000;
	return Math.min(120_000, Math.max(1_000, parsed));
}

export function normalizeOmniRouteBaseURL(value: string): string {
	const normalized = value.trim().replace(/\/+$/, "");
	if (!normalized) return "";
	return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

export function getOmniRouteConfigOrDisabled(): OmniRouteConfig {
	const enabled = process.env.OMNIROUTE_ENABLED === "true";
	const baseURL = normalizeOmniRouteBaseURL(process.env.OMNIROUTE_BASE_URL ?? "");
	const apiKey = process.env.OMNIROUTE_API_KEY?.trim() ?? "";
	const model = process.env.OMNIROUTE_MODEL?.trim() || "auto";
	const timeoutMs = parseTimeout(process.env.OMNIROUTE_TIMEOUT_MS);

	return {
		enabled,
		configured: enabled && Boolean(baseURL && apiKey),
		baseURL,
		apiKey,
		model,
		timeoutMs,
	};
}
