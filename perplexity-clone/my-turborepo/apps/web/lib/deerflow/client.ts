import type { DeerFlowConfig } from "./config";

export class DeerFlowRequestError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;
	readonly submissionOutcomeUnknown: boolean;

	constructor(options: {
		readonly code: string;
		readonly message: string;
		readonly status?: number;
		readonly retryable?: boolean;
		readonly submissionOutcomeUnknown?: boolean;
	}) {
		super(options.message);
		this.name = "DeerFlowRequestError";
		this.code = options.code;
		this.status = options.status ?? 502;
		this.retryable = options.retryable ?? false;
		this.submissionOutcomeUnknown = options.submissionOutcomeUnknown ?? false;
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

async function responseMessage(response: Response): Promise<string> {
	const payload = (await response.json().catch(() => null)) as
		| { detail?: unknown; error?: unknown; message?: unknown }
		| null;
	for (const candidate of [payload?.detail, payload?.error, payload?.message]) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 500);
	}
	return `DeerFlow request failed (${response.status}).`;
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
	} catch (error) {
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
		throw new DeerFlowRequestError({
			code: `DEERFLOW_HTTP_${response.status}`,
			message: await responseMessage(response),
			status: response.status,
			retryable,
			// A concrete HTTP response proves the Gateway processed the request boundary.
			submissionOutcomeUnknown: false,
		});
	}
	return (await response.json()) as T;
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
	return thread.thread_id;
}

export async function createDeerFlowRun(
	config: DeerFlowConfig,
	ownerUserId: string,
	threadId: string,
	objective: string,
	localRunId: string,
): Promise<DeerFlowRun> {
	const configurable: Record<string, unknown> = {
		thinking_enabled: config.thinkingEnabled,
		is_plan_mode: config.planMode,
	};
	if (config.modelName) configurable.model_name = config.modelName;

	return requestJson<DeerFlowRun>({
		config,
		ownerUserId,
		path: `/api/threads/${encodeURIComponent(threadId)}/runs`,
		method: "POST",
		submission: true,
		body: {
			input: { messages: [{ role: "user", content: objective }] },
			metadata: { source: "aira-ai", aira_run_id: localRunId },
			config: { recursion_limit: 100, configurable },
			multitask_strategy: "reject",
			if_not_exists: "create",
		},
	});
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
			throw new DeerFlowRequestError({
				code: `DEERFLOW_HTTP_${response.status}`,
				message: await responseMessage(response),
				status: response.status,
				retryable: response.status >= 500,
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
		artifacts: state.values?.artifacts ?? [],
		title: state.values?.title ?? null,
	};
}
