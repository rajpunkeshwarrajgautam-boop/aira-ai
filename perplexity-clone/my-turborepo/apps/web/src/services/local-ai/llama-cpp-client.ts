import { getLocalAiConfig, type LocalAiConfig } from "./config";

export type LocalAiRole = "system" | "user" | "assistant" | "tool";

export interface LocalAiToolCall {
	readonly id: string;
	readonly type: "function";
	readonly function: {
		readonly name: string;
		readonly arguments: string;
	};
}

export interface LocalAiMessage {
	readonly role: LocalAiRole;
	readonly content: string | null;
	readonly tool_call_id?: string;
	readonly tool_calls?: readonly LocalAiToolCall[];
}

export interface LocalAiToolDefinition {
	readonly type: "function";
	readonly function: {
		readonly name: string;
		readonly description: string;
		readonly parameters: Record<string, unknown>;
	};
}

interface ChatResponse {
	readonly model?: string;
	readonly choices?: readonly {
		readonly message?: {
			readonly content?: string | null;
			readonly tool_calls?: readonly LocalAiToolCall[];
		};
	}[];
	readonly usage?: {
		readonly prompt_tokens?: number;
		readonly completion_tokens?: number;
		readonly total_tokens?: number;
	};
}

export interface LocalAiCompletionResult {
	readonly text: string;
	readonly model: string;
	readonly usage?: ChatResponse["usage"];
	readonly toolRounds: number;
}

export interface LocalAiHealthResult {
	readonly configured: boolean;
	readonly reachable: boolean;
	readonly status: "disabled" | "not-configured" | "ok" | "loading" | "unreachable";
	readonly model: string | null;
	readonly latencyMs: number | null;
	readonly error?: string;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function apiPath(config: LocalAiConfig, path: string): string {
	return `${config.baseURL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestJson<T>(
	config: LocalAiConfig,
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	try {
		const response = await fetch(apiPath(config, path), {
			...init,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${config.apiKey}`,
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...(init.headers ?? {}),
			},
			signal: controller.signal,
			cache: "no-store",
		});
		const body = (await response.json().catch(() => null)) as T | { error?: unknown } | null;
		if (!response.ok) {
			const detail = body && typeof body === "object" && "error" in body
				? JSON.stringify((body as { error?: unknown }).error).slice(0, 500)
				: `HTTP ${response.status}`;
			throw new Error(`Local llama.cpp request failed: ${detail}`);
		}
		if (body === null) throw new Error("Local llama.cpp returned an empty JSON response.");
		return body as T;
	} finally {
		clearTimeout(timeout);
	}
}

export async function getLocalAiHealth(
	config: LocalAiConfig = getLocalAiConfig(),
): Promise<LocalAiHealthResult> {
	if (!config.enabled) {
		return { configured: false, reachable: false, status: "disabled", model: config.model || null, latencyMs: null };
	}
	if (!config.configured) {
		return { configured: false, reachable: false, status: "not-configured", model: config.model || null, latencyMs: null };
	}

	const startedAt = Date.now();
	try {
		await requestJson<Record<string, unknown>>(config, "/health");
		return {
			configured: true,
			reachable: true,
			status: "ok",
			model: config.model,
			latencyMs: Date.now() - startedAt,
		};
	} catch (error) {
		const message = errorMessage(error);
		return {
			configured: true,
			reachable: false,
			status: /loading/i.test(message) ? "loading" : "unreachable",
			model: config.model,
			latencyMs: Date.now() - startedAt,
			error: message.slice(0, 320),
		};
	}
}

export async function listLocalAiModels(
	config: LocalAiConfig = getLocalAiConfig(),
): Promise<readonly string[]> {
	if (!config.configured) return [];
	const response = await requestJson<{ readonly data?: readonly { readonly id?: string }[] }>(config, "/models");
	return (response.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id));
}

export async function localAiChatOnce(args: {
	readonly messages: readonly LocalAiMessage[];
	readonly tools?: readonly LocalAiToolDefinition[];
	readonly temperature?: number;
	readonly maxCompletionTokens?: number;
	readonly config?: LocalAiConfig;
}): Promise<{ readonly response: ChatResponse; readonly message: NonNullable<NonNullable<ChatResponse["choices"]>[number]["message"]> }> {
	const config = args.config ?? getLocalAiConfig();
	if (!config.configured) throw new Error("Virexa Local AI is disabled or not configured.");

	const payload: Record<string, unknown> = {
		model: config.model,
		messages: args.messages,
		stream: false,
		temperature: args.temperature ?? 0.15,
		max_tokens: args.maxCompletionTokens ?? config.maxCompletionTokens,
	};
	if (args.tools?.length) {
		payload.tools = args.tools;
		payload.tool_choice = "auto";
		payload.parallel_tool_calls = false;
	}

	const response = await requestJson<ChatResponse>(config, "/chat/completions", {
		method: "POST",
		body: JSON.stringify(payload),
	});
	const message = response.choices?.[0]?.message;
	if (!message) throw new Error("Local llama.cpp returned no assistant message.");
	return { response, message };
}

export async function runLocalAiToolLoop(args: {
	readonly messages: readonly LocalAiMessage[];
	readonly tools?: readonly LocalAiToolDefinition[];
	readonly executeTool?: (name: string, rawArguments: string) => Promise<unknown>;
	readonly temperature?: number;
	readonly maxCompletionTokens?: number;
	readonly maxToolRounds?: number;
	readonly config?: LocalAiConfig;
}): Promise<LocalAiCompletionResult> {
	const config = args.config ?? getLocalAiConfig();
	const messages: LocalAiMessage[] = [...args.messages];
	const maxRounds = Math.min(Math.max(args.maxToolRounds ?? 3, 0), 6);
	let lastUsage: ChatResponse["usage"];

	for (let round = 0; round <= maxRounds; round += 1) {
		const { response, message } = await localAiChatOnce({
			messages,
			tools: args.tools,
			temperature: args.temperature,
			maxCompletionTokens: args.maxCompletionTokens,
			config,
		});
		lastUsage = response.usage;
		const toolCalls = message.tool_calls ?? [];
		if (!toolCalls.length) {
			return {
				text: message.content?.trim() ?? "",
				model: response.model ?? config.model,
				usage: lastUsage,
				toolRounds: round,
			};
		}
		if (!args.executeTool) throw new Error("Local model requested a tool, but no tool executor is configured.");
		if (round === maxRounds) throw new Error("Local tool loop exceeded the configured maximum rounds.");

		messages.push({ role: "assistant", content: message.content ?? "", tool_calls: toolCalls });
		for (const call of toolCalls) {
			let result: unknown;
			try {
				result = await args.executeTool(call.function.name, call.function.arguments);
			} catch (error) {
				result = { error: errorMessage(error).slice(0, 500) };
			}
			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: JSON.stringify(result),
			});
		}
	}

	throw new Error("Local tool loop terminated unexpectedly.");
}
