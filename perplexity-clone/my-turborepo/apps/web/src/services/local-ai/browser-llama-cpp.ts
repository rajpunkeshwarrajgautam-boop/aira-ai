import { routeLocalAiTask } from "./task-router";

export const BROWSER_LLAMA_CPP_BASE_URL = "http://127.0.0.1:8080/v1";

export interface BrowserLlamaCppStatus {
	readonly reachable: boolean;
	readonly model: string | null;
	readonly models: readonly string[];
	readonly latencyMs: number | null;
	readonly error?: string;
}

export interface BrowserLlamaCppHistoryMessage {
	readonly role: "user" | "assistant";
	readonly content: string;
}

export interface BrowserLlamaCppChatResult {
	readonly text: string;
	readonly model: string;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type LoopbackRequestInit = RequestInit & { readonly targetAddressSpace?: "loopback" };

const LOCAL_SYSTEM_PROMPT = `You are AIRA AI running privately on the user's computer through llama.cpp.
Answer the user's request directly and accurately using the conversation context provided to you.
You can reason, write, summarize, extract, classify, rewrite and produce code without needing an external tool.
You do not have live web access in this local browser route. If the request requires fresh/current web information, do not invent it.
Do not claim that you changed files, used applications, browsed the web or executed commands unless runtime evidence is explicitly present in the conversation.`;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function makeLoopbackRequest(url: string, init: RequestInit = {}): Request {
	return new Request(url, {
		...init,
		mode: "cors",
		cache: "no-store",
		targetAddressSpace: "loopback",
	} as LoopbackRequestInit);
}

async function fetchWithTimeout(
	fetcher: FetchLike,
	url: string,
	init: RequestInit = {},
	timeoutMs = 4_000,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetcher(makeLoopbackRequest(url, { ...init, signal: controller.signal }));
	} finally {
		clearTimeout(timer);
	}
}

export function extractBrowserLlamaCppModels(value: unknown): readonly string[] {
	if (!value || typeof value !== "object") return [];
	const data = (value as { data?: unknown }).data;
	if (!Array.isArray(data)) return [];
	return data
		.map((item) => {
			if (!item || typeof item !== "object") return "";
			return typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id.trim() : "";
		})
		.filter(Boolean);
}

export function shouldUseBrowserLlamaCppSearch(
	query: string,
	mode: "standard" | "deep" | string = "standard",
): boolean {
	if (mode !== "standard") return false;
	return routeLocalAiTask({ prompt: query, localFirst: true }).tier === "local";
}

export async function probeBrowserLlamaCpp(
	fetcher: FetchLike = fetch,
): Promise<BrowserLlamaCppStatus> {
	const startedAt = Date.now();
	try {
		const response = await fetchWithTimeout(fetcher, `${BROWSER_LLAMA_CPP_BASE_URL}/models`, {}, 3_500);
		if (!response.ok) {
			return {
				reachable: false,
				model: null,
				models: [],
				latencyMs: Date.now() - startedAt,
				error: `llama.cpp returned HTTP ${response.status} from /v1/models.`,
			};
		}
		const models = extractBrowserLlamaCppModels(await response.json().catch(() => null));
		return {
			reachable: models.length > 0,
			model: models[0] ?? null,
			models,
			latencyMs: Date.now() - startedAt,
			...(models.length > 0 ? {} : { error: "llama.cpp is reachable but did not report a loaded model." }),
		};
	} catch (error) {
		return {
			reachable: false,
			model: null,
			models: [],
			latencyMs: Date.now() - startedAt,
			error: `Could not reach local llama.cpp at 127.0.0.1:8080: ${errorMessage(error).slice(0, 220)}`,
		};
	}
}

export async function browserLlamaCppChat(args: {
	readonly prompt: string;
	readonly history?: readonly BrowserLlamaCppHistoryMessage[];
	readonly model?: string | null;
	readonly maxCompletionTokens?: number;
	readonly temperature?: number;
	readonly fetcher?: FetchLike;
}): Promise<BrowserLlamaCppChatResult> {
	const fetcher = args.fetcher ?? fetch;
	let model = args.model?.trim() || "";
	if (!model) {
		const status = await probeBrowserLlamaCpp(fetcher);
		if (!status.reachable || !status.model) throw new Error(status.error || "No local llama.cpp model is loaded.");
		model = status.model;
	}

	const history = (args.history ?? [])
		.slice(-12)
		.filter((message) => message.content.trim().length > 0)
		.map((message) => ({ role: message.role, content: message.content.slice(0, 20_000) }));
	const response = await fetchWithTimeout(
		fetcher,
		`${BROWSER_LLAMA_CPP_BASE_URL}/chat/completions`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				model,
				stream: false,
				temperature: args.temperature ?? 0.2,
				max_tokens: Math.min(Math.max(args.maxCompletionTokens ?? 2048, 128), 8192),
				messages: [
					{ role: "system", content: LOCAL_SYSTEM_PROMPT },
					...history,
					{ role: "user", content: args.prompt.slice(0, 30_000) },
				],
			}),
		},
		180_000,
	);
	const payload = (await response.json().catch(() => null)) as {
		model?: string;
		choices?: readonly { message?: { content?: string | null } }[];
		error?: unknown;
	} | null;
	if (!response.ok) {
		throw new Error(`Local llama.cpp request failed (${response.status}): ${JSON.stringify(payload?.error ?? "unknown error").slice(0, 500)}`);
	}
	const text = payload?.choices?.[0]?.message?.content?.trim() ?? "";
	if (!text) throw new Error("Local llama.cpp returned no assistant text.");
	return { text, model: payload?.model?.trim() || model };
}
