import type { AutoGptConfig } from "./config";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_STORED_RESULT_BYTES = 128_000;

export interface AutoGptExecutionResult {
	readonly executionId: string;
	readonly status: string;
	readonly output: unknown | null;
}

export class AutoGptRequestError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;
	/** True when the request may have reached AutoGPT before the connection failed. */
	readonly submissionOutcomeUnknown: boolean;

	constructor(options: {
		readonly code: string;
		readonly message: string;
		readonly status: number;
		readonly retryable: boolean;
		readonly submissionOutcomeUnknown?: boolean;
	}) {
		super(options.message);
		this.code = options.code;
		this.status = options.status;
		this.retryable = options.retryable;
		this.submissionOutcomeUnknown = options.submissionOutcomeUnknown ?? false;
	}
}

function endpoint(config: AutoGptConfig, path: string): URL {
	return new URL(`${config.baseUrl.toString().replace(/\/$/, "")}${path}`);
}

async function readLimitedText(response: Response): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let received = 0;
	let value = "";

	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) break;
		received += chunk.value.byteLength;
		if (received > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new AutoGptRequestError({
				code: "AUTOGPT_RESPONSE_TOO_LARGE",
				message: "The AutoGPT response exceeded Aira's safe response limit.",
				status: 502,
				retryable: false,
				submissionOutcomeUnknown: true,
			});
		}
		value += decoder.decode(chunk.value, { stream: true });
	}

	return value + decoder.decode();
}

function errorForProviderStatus(status: number): AutoGptRequestError {
	if (status === 401 || status === 403) {
		return new AutoGptRequestError({
			code: "AUTOGPT_AUTH_FAILED",
			message: "Aira's AutoGPT connection is not authorized.",
			status: 503,
			retryable: false,
		});
	}
	if (status === 404 || status === 400 || status === 422) {
		return new AutoGptRequestError({
			code: "AUTOGPT_GRAPH_REJECTED",
			message: "AutoGPT rejected the configured graph or its input.",
			status: 502,
			retryable: false,
		});
	}
	if (status === 402) {
		return new AutoGptRequestError({
			code: "AUTOGPT_CREDITS_REQUIRED",
			message: "The connected AutoGPT account needs execution credits.",
			status: 503,
			retryable: false,
		});
	}
	if (status === 429) {
		return new AutoGptRequestError({
			code: "AUTOGPT_RATE_LIMITED",
			message: "AutoGPT is rate limiting new requests. Retry shortly.",
			status: 503,
			retryable: true,
		});
	}
	return new AutoGptRequestError({
		code: "AUTOGPT_UNAVAILABLE",
		message: "AutoGPT is temporarily unavailable.",
		status: 502,
		retryable: true,
	});
}

async function requestJson(
	config: AutoGptConfig,
	url: URL,
	init: RequestInit,
): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

	try {
		const response = await fetch(url, {
			...init,
			cache: "no-store",
			signal: controller.signal,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"X-API-Key": config.apiKey,
				...(init.headers ?? {}),
			},
		});
		const raw = await readLimitedText(response);
		if (!response.ok) throw errorForProviderStatus(response.status);
		try {
			return JSON.parse(raw) as unknown;
		} catch {
			throw new AutoGptRequestError({
				code: "AUTOGPT_INVALID_RESPONSE",
				message: "AutoGPT returned an invalid response.",
				status: 502,
				retryable: true,
				submissionOutcomeUnknown: true,
			});
		}
	} catch (error) {
		if (error instanceof AutoGptRequestError) throw error;
		if (error instanceof Error && error.name === "AbortError") {
			throw new AutoGptRequestError({
				code: "AUTOGPT_TIMEOUT",
				message: "AutoGPT did not respond before the request timed out.",
				status: 504,
				retryable: true,
				submissionOutcomeUnknown: true,
			});
		}
		throw new AutoGptRequestError({
			code: "AUTOGPT_UNAVAILABLE",
			message: "Aira could not reach AutoGPT.",
			status: 502,
			retryable: true,
			submissionOutcomeUnknown: true,
		});
	} finally {
		clearTimeout(timeout);
	}
}

export async function executeAutoGptGraph(
	config: AutoGptConfig,
	objective: string,
): Promise<string> {
	const body = {
		node_input: {
			[config.inputNodeId]: {
				[config.inputField]: objective,
			},
		},
	};
	const data = await requestJson(
		config,
		endpoint(
			config,
			`/graphs/${encodeURIComponent(config.graphId)}/execute/${config.graphVersion}`,
		),
		{ method: "POST", body: JSON.stringify(body) },
	);
	const id =
		typeof data === "object" && data !== null && typeof (data as { id?: unknown }).id === "string"
			? (data as { id: string }).id.trim()
			: "";
	if (!id) {
		throw new AutoGptRequestError({
			code: "AUTOGPT_INVALID_RESPONSE",
			message: "AutoGPT did not return an execution ID.",
			status: 502,
			retryable: true,
			submissionOutcomeUnknown: true,
		});
	}
	return id;
}

export async function getAutoGptExecution(
	config: AutoGptConfig,
	graphId: string,
	remoteExecutionId: string,
): Promise<AutoGptExecutionResult> {
	const data = await requestJson(
		config,
		endpoint(
			config,
			`/graphs/${encodeURIComponent(graphId)}/executions/${encodeURIComponent(remoteExecutionId)}/results`,
		),
		{ method: "GET" },
	);
	if (typeof data !== "object" || data === null) {
		throw new AutoGptRequestError({
			code: "AUTOGPT_INVALID_RESPONSE",
			message: "AutoGPT returned an invalid execution result.",
			status: 502,
			retryable: true,
		});
	}
	const payload = data as Record<string, unknown>;
	if (typeof payload.status !== "string") {
		throw new AutoGptRequestError({
			code: "AUTOGPT_INVALID_RESPONSE",
			message: "AutoGPT returned an execution without a status.",
			status: 502,
			retryable: true,
		});
	}
	return {
		executionId:
			typeof payload.execution_id === "string"
				? payload.execution_id
				: remoteExecutionId,
		status: payload.status,
		output: payload.output ?? null,
	};
}

export function safeStoredOutput(value: unknown): unknown | null {
	if (value == null) return null;
	try {
		const serialized = JSON.stringify(value);
		if (new TextEncoder().encode(serialized).byteLength > MAX_STORED_RESULT_BYTES) {
			return {
				truncated: true,
				message: "The agent result exceeded Aira's stored-result limit.",
			};
		}
		return JSON.parse(serialized) as unknown;
	} catch {
		return { message: "The agent returned a result that could not be serialized." };
	}
}
