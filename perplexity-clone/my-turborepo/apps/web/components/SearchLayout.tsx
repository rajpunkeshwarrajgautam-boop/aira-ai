"use client";

import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { cn } from "../lib/cn";

import { type CitationItem } from "./CitationCards";
import { SearchBox } from "./SearchBox";
import { UserMenu } from "./UserMenu";
import {
	type ConversationMessageDto,
	ConversationMessageList,
} from "./conversations/ConversationMessageList";
import {
	type ConversationSummary,
	ConversationSidebar,
} from "./conversations/ConversationSidebar";
import { ResearchHistoryPanel, type ResearchHistoryRow } from "./conversations/ResearchHistoryPanel";
import { ShareResearchButton } from "./share/ShareResearchButton";

export type SearchPhase = "idle" | "connecting" | "streaming" | "complete" | "error";

export type ResearchMode = "standard" | "deep";

export interface SearchLayoutProps {
	readonly className?: string;
}

interface ApiErrorBody {
	readonly error?: {
		readonly code?: string;
		readonly message?: string;
		readonly details?: unknown;
	};
}

interface MetadataPayload {
	readonly type?: string;
	readonly citations?: readonly CitationItem[];
}

interface TextPayload {
	readonly type?: string;
	readonly delta?: string;
}

interface StreamErrorPayload {
	readonly type?: string;
	readonly code?: string;
	readonly message?: string;
}

interface DonePayload {
	readonly type?: string;
	readonly conversationId?: string;
	readonly messageId?: string;
}

function parseSseBlock(block: string): { event: string; data: string } | null {
	const lines = block.split(/\r?\n/).filter((line) => line.length > 0);
	let eventName = "message";
	const dataLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith("event:")) {
			eventName = line.slice(6).trim();
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).trimStart());
		}
	}
	if (dataLines.length === 0) return null;
	return { event: eventName, data: dataLines.join("\n") };
}

function safeJson<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

export function SearchLayout({ className }: SearchLayoutProps) {
	const [query, setQuery] = useState("");
	const [phase, setPhase] = useState<SearchPhase>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [researchMode, setResearchMode] = useState<ResearchMode>("standard");

	const abortRef = useRef<AbortController | null>(null);

	const searchParams = useSearchParams();
	useEffect(() => {
		const q = searchParams.get("q");
		if (!q) return;
		setQuery((prev) => (prev.trim().length > 0 ? prev : q));
	}, [searchParams]);

	const busy = useMemo(() => phase === "connecting" || phase === "streaming", [phase]);

	const [conversations, setConversations] = useState<readonly ConversationSummary[]>([]);
	const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
	const [selectedConversationTitle, setSelectedConversationTitle] = useState<
		string | null
	>(null);

	const [messages, setMessages] = useState<readonly ConversationMessageDto[]>([]);
	const [parentMessageId, setParentMessageId] = useState<string | undefined>(undefined);

	const [streamingUserQuery, setStreamingUserQuery] = useState<string | null>(null);
	const [streamingAssistantMarkdown, setStreamingAssistantMarkdown] = useState<string | null>(null);
	const [streamingCitations, setStreamingCitations] = useState<readonly CitationItem[]>([]);

	const [researchHistory, setResearchHistory] = useState<readonly ResearchHistoryRow[]>([]);

	const [shareContext, setShareContext] = useState<{
		readonly conversationId: string;
		readonly messageId: string;
	} | null>(null);

	const apiFetchJson = useCallback(
		async <T,>(url: string, options?: RequestInit): Promise<T> => {
			const res = await fetch(url, {
				...options,
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					...(options?.headers ?? {}),
				},
			});

			if (!res.ok) {
				const parsed = (await res.json().catch(() => null)) as ApiErrorBody | null;
				throw new Error(parsed?.error?.message ?? `Request failed (${res.status})`);
			}
			return (await res.json()) as T;
		},
		[],
	);

	const fetchConversations = useCallback(async () => {
		const rows = await apiFetchJson<{ readonly conversations: readonly ConversationSummary[] }>(
			"/api/conversations",
			{ method: "GET" },
		);
		setConversations(rows.conversations);
		setSelectedConversationId((prev) => prev ?? (rows.conversations[0]?.id ?? null));
		setSelectedConversationTitle(rows.conversations[0]?.title ?? null);
	}, [apiFetchJson]);

	const fetchMessagesForConversation = useCallback(
		async (conversationId: string) => {
			const rows = await apiFetchJson<{ readonly messages: readonly ConversationMessageDto[] }>(
				`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=500`,
				{ method: "GET" },
			);
			setMessages(rows.messages);
			const lastAssistant = [...rows.messages].reverse().find((m) => m.role === "ASSISTANT");
			setParentMessageId(lastAssistant?.id);
		},
		[apiFetchJson],
	);

	const createConversation = useCallback(
		async (initialQuery?: string): Promise<string> => {
			const payload: Record<string, unknown> = {};
			if (initialQuery && initialQuery.trim().length > 0) {
				payload.initialQuery = initialQuery.trim();
			}

			const created = await apiFetchJson<{ readonly conversation: ConversationSummary }>(
				"/api/conversations",
				{ method: "POST", body: JSON.stringify(payload) },
			);
			setSelectedConversationId(created.conversation.id);
			setSelectedConversationTitle(created.conversation.title);
			setMessages([]);
			setParentMessageId(undefined);
			return created.conversation.id;
		},
		[apiFetchJson],
	);

	useEffect(() => {
		void (async () => {
			try {
				await fetchConversations();
			} catch (e) {
				console.error(e);
			}
		})();
	}, [fetchConversations]);

	useEffect(() => {
		if (!selectedConversationId) {
			setMessages([]);
			setParentMessageId(undefined);
			setResearchHistory([]);
			setSelectedConversationTitle(null);
			setShareContext(null);
			return;
		}
		if (busy) return;

		void fetchMessagesForConversation(selectedConversationId);
	}, [busy, fetchMessagesForConversation, selectedConversationId]);

	useEffect(() => {
		if (!selectedConversationId) return;
		if (busy) return;

		void (async () => {
			try {
				const rows = await apiFetchJson<{ readonly history: readonly ResearchHistoryRow[] }>(
					"/api/history/research?limit=50",
					{ method: "GET" },
				);
				setResearchHistory(
					rows.history.filter((r) => r.conversationId === selectedConversationId),
				);
			} catch (e) {
				console.error(e);
				setResearchHistory([]);
			}
		})();
	}, [apiFetchJson, busy, selectedConversationId]);

	useEffect(() => {
		// Best-effort analytics visitor tracking; does not block UI.
		void (async () => {
			try {
				await fetch("/api/analytics/visitor", {
					method: "POST",
					credentials: "include",
				});
			} catch {
				// ignore
			}
		})();
	}, []);

	const runSearch = useCallback(async () => {
		const q = query.trim();
		if (!q || busy) return;

		// Ensure there is a selected conversation thread for persistence.
		let conversationId = selectedConversationId;
		if (!conversationId) {
			conversationId = await createConversation(q);
		}

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		setErrorMessage(null);
		setQuery("");
		setStreamingUserQuery(q);
		setStreamingAssistantMarkdown("");
		setStreamingCitations([]);
		setShareContext(null);
		setPhase("connecting");

		try {
			const response = await fetch("/api/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: q,
					conversationId,
					parentMessageId,
					continueResearch: Boolean(parentMessageId),
					mode: researchMode,
				}),
				signal: controller.signal,
				credentials: "include",
			});

			if (!response.ok) {
				const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
				const msg = parsed?.error?.message ?? `Request failed (${response.status})`;
				setPhase("error");
				setErrorMessage(msg);
				return;
			}

			const body = response.body;
			if (!body) {
				setPhase("error");
				setErrorMessage("Empty response body.");
				return;
			}

			const reader = body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			setPhase("streaming");

			let sawDone = false;
			let doneConversationId: string | undefined;
			let doneMessageId: string | undefined;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				let sep: number;
				while ((sep = buffer.indexOf("\n\n")) !== -1) {
					const raw = buffer.slice(0, sep);
					buffer = buffer.slice(sep + 2);
					const block = parseSseBlock(raw);
					if (!block) continue;

					if (block.event === "metadata") {
						const meta = safeJson<MetadataPayload>(block.data);
						if (meta && Array.isArray(meta.citations)) {
							setStreamingCitations([...meta.citations]);
						}
					} else if (block.event === "text") {
						const chunk = safeJson<TextPayload>(block.data);
						if (chunk?.delta) {
							setStreamingAssistantMarkdown((prev) => (prev ?? "") + chunk.delta);
						}
					} else if (block.event === "done") {
						sawDone = true;
						const donePayload = safeJson<DonePayload>(block.data);
						doneConversationId = donePayload?.conversationId;
						doneMessageId = donePayload?.messageId;

						if (doneConversationId) {
							setSelectedConversationId(doneConversationId);
						}
						if (doneMessageId) {
							setParentMessageId(doneMessageId);
						}
						const finalConversationId = doneConversationId ?? conversationId;
						if (finalConversationId && doneMessageId) {
							setShareContext({
								conversationId: finalConversationId,
								messageId: doneMessageId,
							});
						}
						setPhase("complete");
					} else if (block.event === "error") {
						const err = safeJson<StreamErrorPayload>(block.data);
						setPhase("error");
						setErrorMessage(err?.message ?? "Stream interrupted.");
					}
				}
			}

			if (!sawDone) {
				setPhase((p) => (p === "streaming" || p === "connecting" ? "complete" : p));
			}

			// Refetch persisted full history inside the selected thread.
			if (sawDone && (doneConversationId ?? conversationId)) {
				const finalId = doneConversationId ?? conversationId;
				await fetchMessagesForConversation(finalId);
			}

			setStreamingUserQuery(null);
			setStreamingAssistantMarkdown(null);
			setStreamingCitations([]);
		} catch (e: unknown) {
			if (e instanceof DOMException && e.name === "AbortError") {
				setPhase("idle");
				setErrorMessage(null);
				setStreamingUserQuery(null);
				setStreamingAssistantMarkdown(null);
				setStreamingCitations([]);
				return;
			}
			const msg = e instanceof Error ? e.message : "Unexpected error.";
			setPhase("error");
			setErrorMessage(msg);
		}
	}, [
		busy,
		createConversation,
		fetchMessagesForConversation,
		parentMessageId,
		query,
		selectedConversationId,
		researchMode,
	]);

	const onSelectConversation = useCallback(
		async (id: string) => {
			if (busy) return;
			setSelectedConversationId(id);
			try {
				const meta = await apiFetchJson<{
					readonly conversation: { readonly id: string; readonly title: string };
				}>(`/api/conversations/${encodeURIComponent(id)}`, { method: "GET" });
				setSelectedConversationTitle(meta.conversation.title);
			} catch {
				setSelectedConversationTitle(null);
			}
			setStreamingUserQuery(null);
			setStreamingAssistantMarkdown(null);
			setStreamingCitations([]);
			await fetchMessagesForConversation(id);
			setErrorMessage(null);
			setPhase("idle");
		},
		[apiFetchJson, busy, fetchMessagesForConversation],
	);

	const onCreateConversation = useCallback(async () => {
		if (busy) return;
		setStreamingUserQuery(null);
		setStreamingAssistantMarkdown(null);
		setStreamingCitations([]);
		setErrorMessage(null);
		setPhase("idle");
		await createConversation();
	}, [busy, createConversation]);

	return (
		<div className={cn("relative min-h-dvh w-full overflow-hidden bg-surface", className)}>
			<div
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--accent)/0.18),transparent)]"
				aria-hidden
			/>
			<div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />

			<div className="relative z-10 flex min-h-dvh flex-col md:flex-row">
				<div className="hidden w-[320px] shrink-0 md:block">
					<ConversationSidebar
						conversations={conversations}
						selectedConversationId={selectedConversationId}
						onSelectConversation={onSelectConversation}
						onCreateConversation={onCreateConversation}
						disabled={busy}
					/>
				</div>

				<main className="flex min-h-dvh flex-1 flex-col">
					<header className="flex items-center justify-between gap-4 px-4 py-6 md:px-6">
						<div className="flex items-center gap-3">
							<div className="flex size-11 items-center justify-center rounded-2xl bg-accent/15 ring-1 ring-accent/25 shadow-float">
								<Sparkles className="size-6 text-accent" aria-hidden />
							</div>
							<div>
								<h1 className="text-lg font-semibold tracking-tight text-content-primary sm:text-xl">
									{selectedConversationTitle ?? "Research"}
								</h1>
								<p className="mt-0.5 text-xs text-content-secondary">
									Persistent threads with live web citations.
								</p>
							</div>
						</div>
						<UserMenu className="hidden sm:block" />
					</header>

					<div className="flex flex-1 flex-col gap-4 px-4 pb-6 md:px-6">
						<div className="md:hidden">
							<div className="flex items-center gap-3">
								<select
									className="flex-1 rounded-xl border border-border-subtle bg-surface-elevated/80 p-3 text-sm text-content-primary"
									value={selectedConversationId ?? ""}
									onChange={(e) => {
										const v = e.target.value;
										if (v) void onSelectConversation(v);
									}}
									disabled={conversations.length === 0 || busy}
								>
									<option value="" disabled>
										Select conversation
									</option>
									{conversations.map((c) => (
										<option key={c.id} value={c.id}>
											{c.title}
										</option>
									))}
								</select>

								<button
									type="button"
									onClick={() => void onCreateConversation()}
									disabled={busy}
									className={cn(
										"h-11 w-11 shrink-0 rounded-xl bg-accent/15 text-accent ring-1 ring-accent/25",
										"hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
										"disabled:opacity-40 disabled:pointer-events-none",
									)}
									aria-label="New conversation"
								>
									<span className="text-lg font-semibold" aria-hidden>
										+
									</span>
								</button>
							</div>
						</div>

						<ResearchHistoryPanel items={researchHistory} />

						<div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border-subtle bg-surface-elevated/30 backdrop-blur-md">
							<ConversationMessageList
								messages={messages}
								streamingUserQuery={streamingUserQuery}
								streamingAssistantMarkdown={streamingAssistantMarkdown}
								streamingCitations={streamingCitations}
							/>
						</div>

						{phase === "complete" && shareContext ? (
							<ShareResearchButton
								conversationId={shareContext.conversationId}
								messageId={shareContext.messageId}
								className="mt-1"
							/>
						) : null}

						<div className="flex flex-col gap-3">
							<div
								className={cn(
									"flex w-full overflow-hidden rounded-2xl border border-border-subtle bg-surface-elevated/80 backdrop-blur-md ring-1 ring-border-subtle",
									"sm:max-w-[520px]",
								)}
								role="group"
								aria-label="Search mode"
							>
								<button
									type="button"
									onClick={() => setResearchMode("standard")}
									disabled={busy}
									className={cn(
										"flex-1 px-3 py-2 text-sm font-medium transition",
										"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
										researchMode === "standard"
											? "bg-accent/20 text-accent"
											: "bg-transparent text-content-secondary hover:text-content-primary",
										"disabled:opacity-40 disabled:pointer-events-none",
									)}
								>
									Standard Search
								</button>
								<button
									type="button"
									onClick={() => setResearchMode("deep")}
									disabled={busy}
									className={cn(
										"flex-1 px-3 py-2 text-sm font-medium transition",
										"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
										researchMode === "deep"
											? "bg-accent/20 text-accent"
											: "bg-transparent text-content-secondary hover:text-content-primary",
										"disabled:opacity-40 disabled:pointer-events-none",
									)}
								>
									Deep Research
								</button>
							</div>

							<SearchBox
								value={query}
								onChange={setQuery}
								onSubmit={() => void runSearch()}
								disabled={busy}
								isBusy={busy}
								placeholder={messages.length > 0 ? "Send a follow-up…" : "Ask your first question…"}
							/>

							{phase === "error" && errorMessage ? (
								<div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
									{errorMessage}
								</div>
							) : null}
						</div>
					</div>

					<footer className="mt-auto border-t border-border-subtle py-4 text-center text-[11px] text-content-tertiary">
						Responses are generated from retrieved sources. Verify critical facts independently.
					</footer>
				</main>
			</div>
		</div>
	);
}
