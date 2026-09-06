import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 12_000;

const BrowserRuntimeStateSchema = z.object({
	sessionId: z.string(),
	status: z.string(),
	currentUrl: z.string().optional().nullable(),
	title: z.string().optional().nullable(),
	allowedDomains: z.array(z.string()).optional(),
	expiresAt: z.number().optional(),
});

const BrowserActionResultSchema = z.object({
	ok: z.boolean(),
	action: z.string(),
	currentUrl: z.string(),
	title: z.string(),
	text: z.string().nullable().optional(),
	console: z.array(z.record(z.string(), z.unknown())).optional(),
	pageErrors: z.array(z.string()).optional(),
	networkFailures: z.array(z.record(z.string(), z.string())).optional(),
});

export type BrowserRuntimeState = z.infer<typeof BrowserRuntimeStateSchema>;
export type BrowserActionResult = z.infer<typeof BrowserActionResultSchema>;

export interface BrowserRuntimeConfig {
	readonly baseUrl: string;
	readonly token: string;
	readonly timeoutMs: number;
}

export class BrowserRuntimeError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;

	constructor(options: { code: string; message: string; status?: number; retryable?: boolean }) {
		super(options.message);
		this.name = "BrowserRuntimeError";
		this.code = options.code;
		this.status = options.status ?? 500;
		this.retryable = options.retryable ?? false;
	}
}

export function isBrowserRuntimeEnabled(): boolean {
	return ["1", "true", "yes", "on"].includes(
		(process.env.AIRA_BROWSER_RUNTIME_ENABLED ?? "").trim().toLowerCase(),
	);
}

function normalizeBaseUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new BrowserRuntimeError({
			code: "BROWSER_RUNTIME_CONFIG_INVALID",
			message: "AIRA_BROWSER_RUNTIME_URL must be a valid URL.",
			status: 503,
		});
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new BrowserRuntimeError({
			code: "BROWSER_RUNTIME_CONFIG_INVALID",
			message: "Browser runtime URL cannot contain credentials, query parameters, or fragments.",
			status: 503,
		});
	}
	const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
	if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !loopback) {
		throw new BrowserRuntimeError({
			code: "BROWSER_RUNTIME_INSECURE_URL",
			message: "Browser runtime requires HTTPS outside loopback in production.",
			status: 503,
		});
	}
	if (!["http:", "https:"].includes(url.protocol)) {
		throw new BrowserRuntimeError({
			code: "BROWSER_RUNTIME_CONFIG_INVALID",
			message: "Browser runtime must use HTTP or HTTPS.",
			status: 503,
		});
	}
	return url.toString().replace(/\/$/, "");
}

export function getBrowserRuntimeConfig(): BrowserRuntimeConfig {
	const rawUrl = process.env.AIRA_BROWSER_RUNTIME_URL?.trim();
	const token = process.env.AIRA_BROWSER_RUNTIME_TOKEN?.trim();
	if (!rawUrl || !token) {
		throw new BrowserRuntimeError({
			code: "BROWSER_RUNTIME_NOT_CONFIGURED",
			message: "Browser runtime is not configured.",
			status: 503,
		});
	}
	const parsed = Number(process.env.AIRA_BROWSER_RUNTIME_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
	const timeoutMs = Number.isFinite(parsed)
		? Math.max(1_000, Math.min(60_000, Math.trunc(parsed)))
		: DEFAULT_TIMEOUT_MS;
	return { baseUrl: normalizeBaseUrl(rawUrl), token, timeoutMs };
}

export function isBrowserRuntimeConfigured(): boolean {
	try {
		getBrowserRuntimeConfig();
		return true;
	} catch {
		return false;
	}
}

async function runtimeFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const config = getBrowserRuntimeConfig();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);
	try {
		const response = await fetch(`${config.baseUrl}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${config.token}`,
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...(init.headers ?? {}),
			},
			signal: controller.signal,
			cache: "no-store",
		});
		if (!response.ok) {
			throw new BrowserRuntimeError({
				code: "BROWSER_RUNTIME_REQUEST_FAILED",
				message: `Browser runtime returned HTTP ${response.status}.`,
				status: response.status >= 400 && response.status < 600 ? response.status : 502,
				retryable: response.status === 408 || response.status === 429 || response.status >= 500,
			});
		}
		return response;
	} catch (error) {
		if (error instanceof BrowserRuntimeError) throw error;
		throw new BrowserRuntimeError({
			code: "BROWSER_RUNTIME_UNREACHABLE",
			message: "Browser runtime is temporarily unreachable.",
			status: 503,
			retryable: true,
		});
	} finally {
		clearTimeout(timer);
	}
}

export async function browserRuntimeHealth(): Promise<boolean> {
	if (!isBrowserRuntimeEnabled() || !isBrowserRuntimeConfigured()) return false;
	try {
		const config = getBrowserRuntimeConfig();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), Math.min(3_000, config.timeoutMs));
		try {
			const response = await fetch(`${config.baseUrl}/healthz`, { signal: controller.signal, cache: "no-store" });
			return response.ok;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return false;
	}
}

export async function createRemoteBrowserSession(input: {
	readonly sessionId: string;
	readonly allowedDomains: readonly string[];
	readonly width: number;
	readonly height: number;
	readonly ttlSeconds: number;
	readonly startUrl?: string;
}): Promise<BrowserRuntimeState> {
	const response = await runtimeFetch("/v1/sessions", {
		method: "POST",
		body: JSON.stringify(input),
	});
	const parsed = BrowserRuntimeStateSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new BrowserRuntimeError({ code: "BROWSER_RUNTIME_RESPONSE_INVALID", message: "Browser runtime returned an invalid session response.", status: 502 });
	}
	return parsed.data;
}

export async function getRemoteBrowserSession(sessionId: string): Promise<BrowserRuntimeState> {
	const response = await runtimeFetch(`/v1/sessions/${encodeURIComponent(sessionId)}`);
	const parsed = BrowserRuntimeStateSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new BrowserRuntimeError({ code: "BROWSER_RUNTIME_RESPONSE_INVALID", message: "Browser runtime returned an invalid session state.", status: 502 });
	}
	return parsed.data;
}

export async function runRemoteBrowserAction(
	sessionId: string,
	action: Record<string, unknown>,
): Promise<BrowserActionResult> {
	const response = await runtimeFetch(`/v1/sessions/${encodeURIComponent(sessionId)}/actions`, {
		method: "POST",
		body: JSON.stringify(action),
	});
	const parsed = BrowserActionResultSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new BrowserRuntimeError({ code: "BROWSER_RUNTIME_RESPONSE_INVALID", message: "Browser runtime returned an invalid action result.", status: 502 });
	}
	return parsed.data;
}

export async function getRemoteBrowserScreenshot(sessionId: string): Promise<ArrayBuffer> {
	return (await runtimeFetch(`/v1/sessions/${encodeURIComponent(sessionId)}/screenshot`)).arrayBuffer();
}

export async function closeRemoteBrowserSession(sessionId: string): Promise<void> {
	await runtimeFetch(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}
