import { buildDisciplinedAgentObjective } from "@/lib/agents/execution-discipline";

import type { AutoGptConfig, AutoGptTarget } from "./config";

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

function endpoint(target: AutoGptTarget, path: string): URL {
	return new URL(`${target.baseUrl.toString().replace(/\/$/, "")}${path}`);
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
	if (status === 404) {
		return new AutoGptRequestError({
			code: "AUTOGPT_NOT_FOUND",
			message: "AutoGPT could not find the requested graph or execution.",
			status: 502,
			retryable: false,
		});
	}
	if (status === 400 || status === 422) {
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
	target: AutoGptTarget,
	url: URL,
	init: RequestInit,
	timeoutMs: number,
	submissionOutcomeUnknown = false,
): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...init,
			cache: "no-store",
			signal: controller.signal,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"X-API-Key": target.apiKey,
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
				submissionOutcomeUnknown,
			});
		}
		throw new AutoGptRequestError({
			code: "AUTOGPT_UNAVAILABLE",
			message: "Aira could not reach AutoGPT.",
			status: 502,
			retryable: true,
			submissionOutcomeUnknown,
		});
	} finally {
		clearTimeout(timeout);
	}
}

function encodeExecutionReference(target: AutoGptTarget, executionId: string): string {
	const encoded = Buffer.from(executionId, "utf8").toString("base64url");
	return `aira1.${target.id}.${encoded}`;
}

function decodeExecutionReference(
	config: AutoGptConfig,
	reference: string,
): { readonly target: AutoGptTarget; readonly executionId: string } {
	const match = /^aira1\.(primary|secondary)\.([A-Za-z0-9_-]+)$/.exec(reference);
	if (!match) {
		if (reference.startsWith("aira1.")) throw new AutoGptConfigReferenceError();
		const primary = config.targets[0];
		if (!primary) throw new AutoGptConfigReferenceError();
		return { target: primary, executionId: reference };
	}

	const target = config.targets.find((candidate) => candidate.id === match[1]);
	if (!target) throw new AutoGptConfigReferenceError();
	try {
		const executionId = Buffer.from(match[2] ?? "", "base64url").toString("utf8").trim();
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(executionId)) {
			throw new Error("invalid execution ID");
		}
		return { target, executionId };
	} catch {
		throw new AutoGptConfigReferenceError();
	}
}

class AutoGptConfigReferenceError extends AutoGptRequestError {
	constructor() {
		super({
			code: "AUTOGPT_TARGET_NOT_CONFIGURED",
			message: "The AutoGPT host that accepted this task is no longer configured.",
			status: 503,
			retryable: false,
		});
	}
}

async function isTargetHealthy(
	config: AutoGptConfig,
	target: AutoGptTarget,
): Promise<boolean> {
	try {
		await requestJson(
			target,
			endpoint(target, "/health"),
			{ method: "GET" },
			config.healthTimeoutMs,
		);
		return true;
	} catch {
		return false;
	}
}

async function selectSubmissionTarget(config: AutoGptConfig): Promise<AutoGptTarget> {
	const primary = config.targets[0];
	if (!primary) throw new AutoGptConfigReferenceError();
	if (config.targets.length === 1) return primary;

	for (const target of config.targets) {
		if (await isTargetHealthy(config, target)) return target;
	}

	throw new AutoGptRequestError({
		code: "AUTOGPT_UNAVAILABLE",
		message: "Neither AutoGPT runner is currently reachable.",
		status: 503,
		retryable: true,
		submissionOutcomeUnknown: false,
	});
}

export async function executeAutoGptGraph(
	config: AutoGptConfig,
	objective: string,
	clientRequestId: string,
): Promise<string> {
	const target = await selectSubmissionTarget(config);
	const disciplinedObjective = buildDisciplinedAgentObjective(objective);
	const body = {
		node_input: {
			[config.inputNodeId]: {
				[config.inputField]: disciplinedObjective,
			},
		},
	};
	const data = await requestJson(
		target,
		endpoint(
			target,
			`/graphs/${encodeURIComponent(config.graphId)}/execute/${config.graphVersion}`,
		),
		{
			method: "POST",
			body: JSON.stringify(body),
			headers: { "X-AIRA-Request-ID": clientRequestId },
		},
		config.requestTimeoutMs,
		true,
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
	return encodeExecutionReference(target, id);
}

export async function getAutoGptExecution(
	config: AutoGptConfig,
	graphId: string,
	remoteExecutionId: string,
): Promise<AutoGptExecutionResult> {
	const reference = decodeExecutionReference(config, remoteExecutionId);
	const data = await requestJson(
		reference.target,
		endpoint(
			reference.target,
			`/graphs/${encodeURIComponent(graphId)}/executions/${encodeURIComponent(reference.executionId)}/results`,
		),
		{ method: "GET" },
		config.requestTimeoutMs,
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
				: reference.executionId,
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
