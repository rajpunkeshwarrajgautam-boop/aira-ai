"use client";

import { Cpu } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import {
	browserLlamaCppChat,
	probeBrowserLlamaCpp,
	shouldUseBrowserLlamaCppSearch,
	type BrowserLlamaCppHistoryMessage,
	type BrowserLlamaCppStatus,
} from "@services/local-ai/browser-llama-cpp";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type SearchBody = {
	readonly query?: string;
	readonly mode?: string;
	readonly conversationId?: string;
	readonly parentMessageId?: string;
};

type ConversationHistoryPayload = {
	readonly messages?: readonly {
		readonly role?: string;
		readonly content?: string;
	}[];
};

type PersistedTurn = {
	readonly conversationId: string;
	readonly userMessageId: string;
	readonly assistantMessageId: string;
};

function inputUrl(input: RequestInfo | URL): URL | null {
	try {
		if (typeof input === "string") return new URL(input, window.location.href);
		if (input instanceof URL) return new URL(input.toString(), window.location.href);
		return new URL(input.url, window.location.href);
	} catch {
		return null;
	}
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
	if (init?.method) return init.method.toUpperCase();
	if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
	return "GET";
}

function jsonBody<T>(init?: RequestInit): T | null {
	if (typeof init?.body !== "string") return null;
	try {
		return JSON.parse(init.body) as T;
	} catch {
		return null;
	}
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-AIRA-Provider": "browser-llama-cpp",
		},
	});
}

function sseResponse(args: {
	readonly text: string;
	readonly model: string;
	readonly persisted?: PersistedTurn;
}): Response {
	const lines = [
		`event: metadata\ndata: ${JSON.stringify({ type: "metadata", citations: [], provider: "browser-local", model: args.model })}\n\n`,
		`event: text\ndata: ${JSON.stringify({ type: "text", delta: args.text })}\n\n`,
		`event: done\ndata: ${JSON.stringify({
			type: "done",
			conversationId: args.persisted?.conversationId,
			messageId: args.persisted?.assistantMessageId,
			provider: "browser-local",
			model: args.model,
		})}\n\n`,
	].join("");
	return new Response(lines, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-store",
			Connection: "keep-alive",
			"X-AIRA-Provider": "browser-llama-cpp",
		},
	});
}

async function loadConversationHistory(
	fetcher: FetchLike,
	conversationId?: string,
): Promise<readonly BrowserLlamaCppHistoryMessage[]> {
	if (!conversationId) return [];
	try {
		const response = await fetcher(
			`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=16`,
			{ method: "GET", credentials: "include", cache: "no-store" },
		);
		if (!response.ok) return [];
		const payload = (await response.json()) as ConversationHistoryPayload;
		return (payload.messages ?? [])
			.filter((message) =>
				(message.role === "USER" || message.role === "ASSISTANT") &&
				typeof message.content === "string" &&
				message.content.trim().length > 0,
			)
			.slice(-12)
			.map((message) => ({
				role: message.role === "USER" ? "user" as const : "assistant" as const,
				content: String(message.content),
			}));
	} catch {
		return [];
	}
}

async function persistLocalTurn(
	fetcher: FetchLike,
	body: SearchBody,
	answer: string,
	model: string,
): Promise<PersistedTurn | undefined> {
	if (!body.conversationId || !body.query) return undefined;
	const response = await fetcher("/api/local-ai/browser-turn", {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			query: body.query,
			answer,
			conversationId: body.conversationId,
			parentMessageId: body.parentMessageId,
			model,
		}),
	});
	if (!response.ok) {
		throw new Error(`Could not persist browser-local AIRA turn (${response.status}).`);
	}
	return (await response.json()) as PersistedTurn;
}

function leadPrompt(body: Record<string, unknown>): string {
	return [
		"Act as AIRA's private lead-qualification worker. Analyze this prospect and return a concise qualification, score out of 100, key signals, risks, recommended next action, and a personalized outreach angle.",
		`Name: ${String(body.name ?? "")}`,
		`Company: ${String(body.company ?? "")}`,
		`Role: ${String(body.role ?? "")}`,
		`Source: ${String(body.source ?? "")}`,
		`Notes: ${String(body.notes ?? "")}`,
	].join("\n");
}

function emailPrompt(body: Record<string, unknown>): string {
	return [
		"Act as AIRA's private email-triage worker. Classify priority, summarize the request, identify required actions/deadlines, flag risks, and draft a concise reply when a reply is appropriate.",
		`From: ${String(body.from ?? "")}`,
		`Subject: ${String(body.subject ?? "")}`,
		`Body:\n${String(body.body ?? "")}`,
	].join("\n");
}

export function BrowserLlamaCppBridge() {
	const [status, setStatus] = useState<BrowserLlamaCppStatus | null>(null);
	const statusRef = useRef<BrowserLlamaCppStatus | null>(null);

	useLayoutEffect(() => {
		const nativeFetch = window.fetch.bind(window) as FetchLike;
		let disposed = false;

		const publishStatus = (next: BrowserLlamaCppStatus) => {
			if (disposed) return;
			statusRef.current = next;
			setStatus(next);
			window.dispatchEvent(new CustomEvent("aira:local-llama-status", { detail: next }));
		};

		const probe = async (): Promise<BrowserLlamaCppStatus> => {
			const next = await probeBrowserLlamaCpp(nativeFetch);
			publishStatus(next);
			return next;
		};

		const ensureLocal = async (): Promise<BrowserLlamaCppStatus> => {
			const cached = statusRef.current;
			if (cached?.reachable && cached.model) return cached;
			return probe();
		};

		const interceptedFetch: FetchLike = async (input, init) => {
			const url = inputUrl(input);
			if (!url || url.origin !== window.location.origin) return nativeFetch(input, init);
			const method = requestMethod(input, init);

			if (url.pathname === "/api/local-ai/status" && method === "GET") {
				const local = await probe();
				if (!local.reachable) return nativeFetch(input, init);
				return jsonResponse({
					enabled: true,
					configured: true,
					localFirst: true,
					required: false,
					model: local.model,
					health: {
						reachable: true,
						status: "ok",
						latencyMs: local.latencyMs,
					},
					models: local.models,
					capabilities: {
						browserLoopback: true,
						chat: true,
						localModelAutoDiscovery: true,
						cloudFallback: true,
					},
				});
			}

			if (url.pathname === "/api/local-ai/chat" && method === "POST") {
				const body = jsonBody<{ prompt?: string }>(init);
				if (!body?.prompt?.trim()) return nativeFetch(input, init);
				try {
					const local = await ensureLocal();
					if (!local.reachable || !local.model) return nativeFetch(input, init);
					const result = await browserLlamaCppChat({
						prompt: body.prompt,
						model: local.model,
						fetcher: nativeFetch,
					});
					return jsonResponse({
						text: result.text,
						provider: "browser-local",
						model: result.model,
						toolRounds: 0,
						routing: { tier: "local", taskKind: "chat", reason: "Browser-connected llama.cpp at 127.0.0.1:8080." },
						contextItems: 0,
					});
				} catch {
					return nativeFetch(input, init);
				}
			}

			if ((url.pathname === "/api/local-ai/business/lead" || url.pathname === "/api/local-ai/business/email") && method === "POST") {
				const body = jsonBody<Record<string, unknown>>(init);
				if (!body) return nativeFetch(input, init);
				try {
					const local = await ensureLocal();
					if (!local.reachable || !local.model) return nativeFetch(input, init);
					const prompt = url.pathname.endsWith("/lead") ? leadPrompt(body) : emailPrompt(body);
					const result = await browserLlamaCppChat({ prompt, model: local.model, fetcher: nativeFetch });
					return jsonResponse({ text: result.text, provider: "browser-local", model: result.model, toolRounds: 0 });
				} catch {
					return nativeFetch(input, init);
				}
			}

			if (url.pathname === "/api/search" && method === "POST") {
				const body = jsonBody<SearchBody>(init);
				const query = body?.query?.trim() ?? "";
				if (!query || !shouldUseBrowserLlamaCppSearch(query, body?.mode ?? "standard")) {
					return nativeFetch(input, init);
				}
				try {
					const local = await ensureLocal();
					if (!local.reachable || !local.model) return nativeFetch(input, init);
					const history = await loadConversationHistory(nativeFetch, body?.conversationId);
					const result = await browserLlamaCppChat({
						prompt: query,
						history,
						model: local.model,
						fetcher: nativeFetch,
						maxCompletionTokens: 3072,
					});
					const persisted = await persistLocalTurn(nativeFetch, body ?? {}, result.text, result.model);
					return sseResponse({ text: result.text, model: result.model, persisted });
				} catch (error) {
					console.info("[AIRA browser llama.cpp] Local route failed; using cloud fallback.", error);
					void probe();
					return nativeFetch(input, init);
				}
			}

			return nativeFetch(input, init);
		};

		window.fetch = interceptedFetch as typeof window.fetch;
		void probe();
		const timer = window.setInterval(() => void probe(), 15_000);

		return () => {
			disposed = true;
			window.clearInterval(timer);
			if (window.fetch === interceptedFetch) window.fetch = nativeFetch as typeof window.fetch;
		};
	}, []);

	if (!status?.reachable || !status.model) return null;
	return (
		<a
			href="/local-ai"
			className="fixed bottom-4 right-4 z-[120] flex max-w-[min(360px,calc(100vw-2rem))] items-center gap-2 rounded-xl border border-emerald-400/20 bg-[#0c1514]/95 px-3 py-2 text-[11px] text-emerald-100 shadow-2xl backdrop-blur-xl transition hover:border-emerald-300/35 hover:bg-[#101b19]"
			title={`AIRA is using local llama.cpp at 127.0.0.1:8080 · ${status.model}`}
		>
			<span className="relative grid size-6 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300">
				<Cpu className="size-3.5" aria-hidden />
				<span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-[#0c1514] bg-emerald-400" />
			</span>
			<span className="min-w-0">
				<span className="block font-semibold">Local llama.cpp online</span>
				<span className="block truncate text-[9px] text-emerald-200/60">{status.model}</span>
			</span>
		</a>
	);
}
