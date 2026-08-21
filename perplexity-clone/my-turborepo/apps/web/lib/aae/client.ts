import type { AaeConfig } from "./config";

export class AaeRequestError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;
	readonly submissionOutcomeUnknown: boolean;
	readonly upstreamDetail?: string;

	constructor(options: {
		readonly code: string;
		readonly message: string;
		readonly status?: number;
		readonly retryable?: boolean;
		readonly submissionOutcomeUnknown?: boolean;
		readonly upstreamDetail?: string;
	}) {
		super(options.message);
		this.name = "AaeRequestError";
		this.code = options.code;
		this.status = options.status ?? 502;
		this.retryable = options.retryable ?? false;
		this.submissionOutcomeUnknown = options.submissionOutcomeUnknown ?? false;
		this.upstreamDetail = options.upstreamDetail;
	}
}

export interface AaeJob {
	readonly id: string;
	readonly status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED";
	readonly output?: string | null;
	readonly error?: string | null;
	readonly modified_files?: readonly string[];
	readonly usage?: Readonly<Record<string, unknown>>;
	readonly created_at: string;
	readonly updated_at: string;
	readonly completed_at?: string | null;
}

function joinedUrl(baseUrl: URL, path: string): URL {
	const base = baseUrl.toString().replace(/\/+$/, "");
	return new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
}

function internalHeaders(config: AaeConfig, ownerUserId: string): Headers {
	return new Headers({
		Accept: "application/json",
		"Content-Type": "application/json",
		Authorization: `Bearer ${config.internalAuthToken}`,
		"X-Aira-Owner-User-Id": ownerUserId,
	});
}

async function upstreamDetail(response: Response): Promise<string | undefined> {
	const body = (await response.json().catch(() => null)) as
		| { detail?: unknown; error?: unknown; message?: unknown }
		| null;
	for (const candidate of [body?.detail, body?.error, body?.message]) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 500);
	}
	return undefined;
}

function safeMessageForStatus(status: number): string {
	if (status === 401 || status === 403) return "AIRA's autonomous engine connection is not authorized.";
	if (status === 404) return "The autonomous task is no longer available on the execution host.";
	if (status === 409) return "The autonomous engine rejected a conflicting task request.";
	if (status === 429) return "The autonomous engine is rate limiting requests. Retry shortly.";
	if (status >= 500) return "The autonomous engine is temporarily unavailable.";
	return "The autonomous engine could not process this request.";
}

async function requestJson<T>(options: {
	readonly config: AaeConfig;
	readonly ownerUserId: string;
	readonly path: string;
	readonly method?: "GET" | "POST";
	readonly body?: unknown;
	readonly timeoutMs?: number;
	readonly submission?: boolean;
}): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? options.config.requestTimeoutMs);
	let response: Response;
	try {
		response = await fetch(joinedUrl(options.config.baseUrl, options.path), {
			method: options.method ?? "GET",
			headers: internalHeaders(options.config, options.ownerUserId),
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			cache: "no-store",
			signal: controller.signal,
		});
	} catch {
		const timedOut = controller.signal.aborted;
		throw new AaeRequestError({
			code: timedOut ? "AAE_TIMEOUT" : "AAE_UNREACHABLE",
			message: timedOut
				? "The autonomous engine did not respond before the request timeout."
				: "The autonomous engine could not be reached.",
			status: 503,
			retryable: true,
			submissionOutcomeUnknown: Boolean(options.submission),
		});
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok) {
		const detail = await upstreamDetail(response);
		console.warn("[aae:upstream]", JSON.stringify({ path: options.path, status: response.status, detail: detail ?? null }));
		throw new AaeRequestError({
			code: `AAE_HTTP_${response.status}`,
			message: safeMessageForStatus(response.status),
			status: response.status,
			retryable: response.status === 408 || response.status === 429 || response.status >= 500,
			submissionOutcomeUnknown: false,
			upstreamDetail: detail,
		});
	}
	return (await response.json()) as T;
}

export async function checkAaeHealth(config: AaeConfig): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.healthTimeoutMs);
	try {
		const response = await fetch(joinedUrl(config.baseUrl, "/health"), {
			method: "GET",
			cache: "no-store",
			signal: controller.signal,
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

export async function createAaeJob(
	config: AaeConfig,
	ownerUserId: string,
	jobId: string,
	objective: string,
): Promise<AaeJob> {
	return requestJson<AaeJob>({
		config,
		ownerUserId,
		path: "/v1/jobs",
		method: "POST",
		submission: true,
		body: { job_id: jobId, task: objective, session_id: jobId },
	});
}

export async function getAaeJob(config: AaeConfig, ownerUserId: string, jobId: string): Promise<AaeJob> {
	return requestJson<AaeJob>({
		config,
		ownerUserId,
		path: `/v1/jobs/${encodeURIComponent(jobId)}`,
	});
}

export async function cancelAaeJob(config: AaeConfig, ownerUserId: string, jobId: string): Promise<AaeJob> {
	return requestJson<AaeJob>({
		config,
		ownerUserId,
		path: `/v1/jobs/${encodeURIComponent(jobId)}/cancel`,
		method: "POST",
	});
}
