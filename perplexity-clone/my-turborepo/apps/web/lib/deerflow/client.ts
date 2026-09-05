import type { DeerFlowConfig } from "./config";

export class DeerFlowRequestError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;
	readonly submissionOutcomeUnknown: boolean;
	/**
	 * Sanitized diagnostic text derived from the DeerFlow Gateway response. It is for server
	 * logs only: upstream `detail` strings can carry host paths, configuration
	 * fragments or model-provider error text. `message` stays AIRA-owned so a
	 * route can return it to the browser without leaking any of that, matching how
	 * the AutoGPT adapter already handles upstream failures.
	 */
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
		this.name = "DeerFlowRequestError";
		this.code = options.code;
		this.status = options.status ?? 502;
		this.retryable = options.retryable ?? false;
		this.submissionOutcomeUnknown = options.submissionOutcomeUnknown ?? false;
		this.upstreamDetail = options.upstreamDetail;
	}
}

export interface DeerFlowRun {
	readonly run_id: string;
	readonly thread_id: string;
	readonly status: string;
	readonly stop_reason?: string | null;
	readonly total_input_tokens?: number;
	readonly total_output_tokens?: number;
	readonly total_tokens?: number;
	readonly llm_call_count?: number;
	readonly lead_agent_tokens?: number;
	readonly subagent_tokens?: number;
	readonly middleware_tokens?: number;
}

interface DeerFlowThread {
	readonly thread_id: string;
}

interface DeerFlowThreadState {
	readonly values?: {
		readonly messages?: readonly unknown[];
		readonly artifacts?: readonly unknown[];
		readonly title?: string;
		readonly [key: string]: unknown;
	};
}

function joinedUrl(baseUrl: URL, path: string): URL {
	const base = baseUrl.toString().replace(/\/+$/, "");
	return new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
}

function internalHeaders(config: DeerFlowConfig, ownerUserId: string): Headers {
	const headers = new Headers({
		Accept: "application/json",
		"Content-Type": "application/json",
		"X-DeerFlow-Internal-Token": config.internalAuthToken,
		"X-DeerFlow-Owner-User-Id": ownerUserId,
	});
	return headers;
}

const SENSITIVE_UPSTREAM_DETAIL_PATTERN =
	/(?:authorization|api[-_]?key|secret|token|password|cookie|private[-_]?key|credential)\s*[:=]\s*\S+|\bbearer\s+\S+|\b(?:sk|nvapi|ghp|gho|ghu|ghs|github_pat)[-_A-Za-z0-9.]{6,}\b/i;
const ABSOLUTE_PATH_UPSTREAM_DETAIL_PATTERN =
	/(?:[A-Za-z]:\\[^\s]+|\/(?:opt|home|var|etc|usr|srv|app|workspace|mnt)\/[^\s]+)/i;
const STACK_TRACE_UPSTREAM_DETAIL_PATTERN = /\b(?:traceback|stack trace)\b/i;

function sanitizeUpstreamDetailText(value: string): string {
	const bounded = value.trim().slice(0, 500);
	if (!bounded) return "";
	if (
		SENSITIVE_UPSTREAM_DETAIL_PATTERN.test(bounded) ||
		ABSOLUTE_PATH_UPSTREAM_DETAIL_PATTERN.test(bounded) ||
		STACK_TRACE_UPSTREAM_DETAIL_PATTERN.test(bounded)
	) {
		return "[redacted upstream diagnostic]";
	}
	return bounded;
}

/**
 * Extracts bounded upstream diagnostics for server-side observability.
 * Credentials, stack traces and absolute host paths are redacted before
 * they can enter an Error object or server log.
 */
async function upstreamDetail(response: Response): Promise<string | undefined> {
	const payload = (await response.json().catch(() => null)) as
		| { detail?: unknown; error?: unknown; message?: unknown }
		| null;
	for (const candidate of [payload?.detail, payload?.error, payload?.message]) {
		if (typeof candidate === "string" && candidate.trim()) {
			const sanitized = sanitizeUpstreamDetailText(candidate);
			if (sanitized) return sanitized;
		}
	}
	return undefined;
}
/** AIRA-owned, user-safe explanation of an upstream DeerFlow failure. */
function safeMessageForStatus(status: number): string {
	if (status === 401 || status === 403) return "AIRA's DeerFlow connection is not authorized.";
	if (status === 404) return "The DeerFlow task or thread is no longer available.";
	if (status === 409) return "DeerFlow is already running work on this thread.";
	if (status === 422) return "DeerFlow rejected this task request.";
	if (status === 429) return "DeerFlow is rate limiting new requests. Retry shortly.";
	if (status >= 500) return "The DeerFlow SuperAgent runtime is temporarily unavailable.";
	return "DeerFlow could not process this request.";
}

function logUpstreamFailure(operation: string, status: number, detail?: string): void {
	// Structured, secret-free diagnostics. The detail stays server-side.
	console.warn("[deerflow:upstream]", JSON.stringify({ operation, status, detail: detail ?? null }));
}

function invalidResponseError(submissionOutcomeUnknown: boolean): DeerFlowRequestError {
	return new DeerFlowRequestError({
		code: "DEERFLOW_INVALID_RESPONSE",
		message: "DeerFlow returned an invalid response.",
		status: 502,
		retryable: true,
		submissionOutcomeUnknown,
	});
}

function submissionStatusMayHideAcceptance(status: number): boolean {
	return status === 408 || status === 409 || status >= 500;
}

async function requestJson<T>(options: {
	readonly config: DeerFlowConfig;
	readonly ownerUserId: string;
	readonly path: string;
	readonly method?: "GET" | "POST" | "DELETE";
	readonly body?: unknown;
	readonly timeoutMs?: number;
	readonly submission?: boolean;
}): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? options.config.requestTimeoutMs,
	);
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
		throw new DeerFlowRequestError({
			code: timedOut ? "DEERFLOW_TIMEOUT" : "DEERFLOW_UNREACHABLE",
			message: timedOut
				? "DeerFlow did not respond before the request timeout."
				: "DeerFlow could not be reached.",
			status: 503,
			retryable: true,
			submissionOutcomeUnknown: Boolean(options.submission),
		});
	} finally {
		clearTimeout(timer);
	}

	if (!response.ok) {
		const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
		const detail = await upstreamDetail(response);
		logUpstreamFailure(options.path, response.status, detail);
		throw new DeerFlowRequestError({
			code: `DEERFLOW_HTTP_${response.status}`,
			message: safeMessageForStatus(response.status),
			status: response.status,
			retryable,
			// A 408/409/5xx response may be emitted after the Gateway accepted work.
			// Keep submissions fail-closed unless the response proves rejection.
			submissionOutcomeUnknown:
				Boolean(options.submission) && submissionStatusMayHideAcceptance(response.status),
			upstreamDetail: detail,
		});
	}
	try {
		return (await response.json()) as T;
	} catch {
		throw invalidResponseError(Boolean(options.submission));
	}
}

export async function checkDeerFlowHealth(config: DeerFlowConfig): Promise<boolean> {
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

export async function createDeerFlowThread(
	config: DeerFlowConfig,
	ownerUserId: string,
	threadId: string,
	localRunId: string,
): Promise<string> {
	const thread = await requestJson<DeerFlowThread>({
		config,
		ownerUserId,
		path: "/api/threads",
		method: "POST",
		body: {
			thread_id: threadId,
			metadata: { source: "aira-ai", aira_run_id: localRunId },
		},
	});
	const returnedThreadId =
		typeof thread?.thread_id === "string" ? thread.thread_id.trim() : "";
	if (!returnedThreadId) throw invalidResponseError(false);
	return returnedThreadId;
}

export async function createDeerFlowRun(
	config: DeerFlowConfig,
	ownerUserId: string,
	threadId: string,
	objective: string,
	localRunId: string,
): Promise<DeerFlowRun> {
	const context: Record<string, unknown> = {
		thinking_enabled: config.thinkingEnabled,
		is_plan_mode: config.planMode,
		// AIRA submits detached background objectives and has no live
		// clarification loop. DeerFlow explicitly permits these flags only for
		// internally authenticated callers, which this adapter is.
		non_interactive: true,
		disable_clarification: true,
	};
	if (config.modelName) context.model_name = config.modelName;

	const run = await requestJson<DeerFlowRun>({
		config,
		ownerUserId,
		path: `/api/threads/${encodeURIComponent(threadId)}/runs`,
		method: "POST",
		submission: true,
		body: {
			input: { messages: [{ role: "user", content: objective }] },
			metadata: { source: "aira-ai", aira_run_id: localRunId },
			config: { recursion_limit: 100 },
			context,
			multitask_strategy: "reject",
			if_not_exists: "create",
		},
	});
	if (
		typeof run?.run_id !== "string" ||
		!run.run_id.trim() ||
		typeof run.thread_id !== "string" ||
		!run.thread_id.trim() ||
		typeof run.status !== "string" ||
		!run.status.trim()
	) {
		throw invalidResponseError(true);
	}
	return run;
}

export async function getDeerFlowRun(
	config: DeerFlowConfig,
	ownerUserId: string,
	threadId: string,
	runId: string,
): Promise<DeerFlowRun> {
	return requestJson<DeerFlowRun>({
		config,
		ownerUserId,
		path: `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`,
	});
}

export async function cancelDeerFlowRun(
	config: DeerFlowConfig,
	ownerUserId: string,
	threadId: string,
	runId: string,
): Promise<void> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
	try {
		const response = await fetch(
			joinedUrl(
				config.baseUrl,
				`/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel?action=interrupt`,
			),
			{
				method: "POST",
				headers: internalHeaders(config, ownerUserId),
				cache: "no-store",
				signal: controller.signal,
			},
		);
		if (!response.ok && response.status !== 409) {
			const detail = await upstreamDetail(response);
			logUpstreamFailure("cancel", response.status, detail);
			throw new DeerFlowRequestError({
				code: `DEERFLOW_HTTP_${response.status}`,
				message: safeMessageForStatus(response.status),
				status: response.status,
				retryable: response.status >= 500,
				upstreamDetail: detail,
			});
		}
	} finally {
		clearTimeout(timer);
	}
}

export async function getDeerFlowThreadState(
	config: DeerFlowConfig,
	ownerUserId: string,
	threadId: string,
): Promise<DeerFlowThreadState> {
	return requestJson<DeerFlowThreadState>({
		config,
		ownerUserId,
		path: `/api/threads/${encodeURIComponent(threadId)}/state`,
	});
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) => {
			if (typeof block === "string") return [block];
			if (!block || typeof block !== "object") return [];
			const value = block as Record<string, unknown>;
			if (typeof value.text === "string") return [value.text];
			if (typeof value.content === "string") return [value.content];
			return [];
		})
		.join("\n")
		.trim();
}

export function extractDeerFlowResult(state: DeerFlowThreadState, run: DeerFlowRun): Record<string, unknown> {
	const messages = state.values?.messages;
	let output = "";
	if (Array.isArray(messages)) {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (!message || typeof message !== "object") continue;
			const row = message as Record<string, unknown>;
			const type = String(row.type ?? row.role ?? "").toLowerCase();
			if (type !== "ai" && type !== "assistant") continue;
			output = contentToText(row.content);
			if (output) break;
		}
	}

	const boundedOutput = output.length > 120_000 ? `${output.slice(0, 120_000)}\n\n[Output truncated by AIRA]` : output;
	// The artifact list becomes the download allowlist and is persisted on the
	// AgentRun row, so keep it to a bounded set of plain path strings rather than
	// storing whatever shape the Gateway happened to return. The route still
	// re-validates every path before proxying a download.
	const artifacts = (state.values?.artifacts ?? [])
		.filter((value): value is string => typeof value === "string" && value.length <= 1_024)
		.slice(0, 200);
	return {
		output: boundedOutput || null,
		threadId: run.thread_id,
		runId: run.run_id,
		stopReason: run.stop_reason ?? null,
		tokenUsage: {
			input: run.total_input_tokens ?? 0,
			output: run.total_output_tokens ?? 0,
			total: run.total_tokens ?? 0,
			llmCalls: run.llm_call_count ?? 0,
			leadAgent: run.lead_agent_tokens ?? 0,
			subagents: run.subagent_tokens ?? 0,
			middleware: run.middleware_tokens ?? 0,
		},
		artifacts,
		title: state.values?.title ?? null,
	};
}
