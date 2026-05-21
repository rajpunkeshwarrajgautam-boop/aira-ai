// SSE boundary fix: robust parsing of LF/CRLF
"use client";

import { Sparkles, RotateCw, Menu, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

import { cn } from "../lib/cn";
import { logProductEvent } from "../lib/log-product-event";
import { globalCommandRegistry } from "../lib/agents/commands/command-registry";
import { RESEARCH_PRESETS, type ResearchPresetId } from "../src/services/research-presets";

import { type CitationItem } from "./CitationCards";
import { SearchBox, type SearchBoxHandle } from "./SearchBox";
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
import { UsageIndicator } from "./UsageIndicator";
import { ShareResultBar } from "./share/ShareResultBar";

export type SearchPhase = "idle" | "connecting" | "streaming" | "complete" | "error";

export type ResearchMode = "standard" | "deep";

export interface SearchLayoutProps {
	readonly className?: string;
}

const EXAMPLE_QUERIES = [
	"Latest AI news summary",
	"Compare ChatGPT vs Gemini",
	"Best laptops under 1 lakh in India",
] as const;

/** Public env only; falls back until `NEXT_PUBLIC_FEEDBACK_EMAIL` is set in Vercel. */
const FEEDBACK_EMAIL =
	(typeof process.env.NEXT_PUBLIC_FEEDBACK_EMAIL === "string"
		? process.env.NEXT_PUBLIC_FEEDBACK_EMAIL.trim()
		: "") || "feedback@example.com";

const FEEDBACK_MAILTO_HREF = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Research app feedback")}`;

interface ApiErrorBody {
	readonly error?: {
		readonly code?: string;
		readonly message?: string;
		readonly details?: unknown;
	};
}

interface BillingStatusPayload {
	readonly billingPlan: string;
	readonly teamSeats: number;
	readonly monthlySearchLimit: number;
	readonly searchesUsed: number;
	readonly searchesRemaining: number;
}

function planDisplayName(plan: string): string {
	switch (plan) {
		case "FREE":
			return "Free";
		case "PRO":
			return "Pro";
		case "TEAM":
			return "Team";
		default:
			return plan;
	}
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
	const trimmed = block.trim();
	if (!trimmed) return null;
	const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
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
	const router = useRouter();
	const { status: sessionStatus } = useSession();
	const isAuthed = sessionStatus === "authenticated";
	const [query, setQuery] = useState("");
	const [phase, setPhase] = useState<SearchPhase>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [errorCode, setErrorCode] = useState<string | null>(null);
	const [limitErrorAction, setLimitErrorAction] = useState<"quota" | "plan" | null>(null);
	const [researchMode, setResearchMode] = useState<ResearchMode>("standard");
	const [selectedPresetId, setSelectedPresetId] = useState<ResearchPresetId>("general");
	const [billing, setBilling] = useState<BillingStatusPayload | null>(null);
	const [statusText, setStatusText] = useState("Searching the web...");

	const abortRef = useRef<AbortController | null>(null);
	const searchBoxRef = useRef<SearchBoxHandle>(null);
	const answerStreamStartedLoggedRef = useRef(false);
	/** Avoid duplicate auto-submit for the same `?q=` after OAuth return. */
	const hasAutoRunUrlQueryRef = useRef<string | null>(null);
	/** Last submitted question (state is cleared at search start; used for sign-in callback URLs). */
	const lastSubmittedQueryRef = useRef("");

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

	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

	const showAssistantSkeleton = useMemo(
		() =>
			busy &&
			Boolean(streamingUserQuery) &&
			!(streamingAssistantMarkdown && streamingAssistantMarkdown.length > 0),
		[busy, streamingUserQuery, streamingAssistantMarkdown],
	);

	const showConversationEmpty = useMemo(
		() => phase === "idle" && messages.length === 0 && !streamingUserQuery,
		[phase, messages.length, streamingUserQuery],
	);

	useEffect(() => {
		if (!showAssistantSkeleton) {
			setStatusText("Searching the web...");
			return;
		}

		const hasCitations = streamingCitations.length > 0;
		const texts = hasCitations
			? ["Reading sources...", "Preparing answer...", "Writing answer..."]
			: ["Searching the web...", "Reading sources...", "Writing answer..."];

		// Initialize text if it doesn't match the current state constraints
		setStatusText((current) => {
			if (hasCitations && current === "Searching the web...") {
				return "Reading sources...";
			}
			return current;
		});

		let idx = 0;
		const id = setInterval(() => {
			setStatusText((current) => {
				// Find current index to step sequentially
				idx = texts.indexOf(current);
				if (idx === -1) idx = 0;
				const nextIdx = (idx + 1) % texts.length;
				return texts[nextIdx] as string;
			});
		}, 2500);

		return () => clearInterval(id);
	}, [showAssistantSkeleton, streamingCitations.length]);

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
		if (sessionStatus !== "authenticated") return;
		void (async () => {
			try {
				await fetchConversations();
			} catch (e) {
				console.error(e);
			}
		})();
	}, [fetchConversations, sessionStatus]);

	useEffect(() => {
		if (sessionStatus === "authenticated") return;
		hasAutoRunUrlQueryRef.current = null;
		setConversations([]);
		setSelectedConversationId(null);
		setSelectedConversationTitle(null);
		setMessages([]);
		setParentMessageId(undefined);
		setResearchHistory([]);
		setShareContext(null);
		setResearchMode("standard");
	}, [sessionStatus]);

	useEffect(() => {
		if (sessionStatus === "loading" || busy) return;
		const qParam = searchParams.get("q")?.trim();
		if (!qParam) return;
		if (hasAutoRunUrlQueryRef.current === qParam) return;
		hasAutoRunUrlQueryRef.current = qParam;
		setQuery(qParam);
		const id = window.setTimeout(() => {
			searchBoxRef.current?.submit();
		}, 0);
		return () => window.clearTimeout(id);
	}, [sessionStatus, searchParams, busy]);

	useEffect(() => {
		if (sessionStatus !== "authenticated") return;
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
	}, [busy, fetchMessagesForConversation, selectedConversationId, sessionStatus]);

	useEffect(() => {
		if (sessionStatus !== "authenticated") return;
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
	}, [apiFetchJson, busy, selectedConversationId, sessionStatus]);

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

	const refreshBilling = useCallback(async () => {
		if (sessionStatus !== "authenticated") return;
		try {
			const res = await fetch("/api/billing/status", { credentials: "include" });
			if (!res.ok) return;
			const j = (await res.json()) as BillingStatusPayload;
			setBilling(j);
		} catch {
			// ignore
		}
	}, [sessionStatus]);

	useEffect(() => {
		if (sessionStatus !== "authenticated") {
			setBilling(null);
			return;
		}
		void refreshBilling();
	}, [sessionStatus, refreshBilling]);

	const onCreateConversation = useCallback(async () => {
		if (busy) return;
		if (sessionStatus !== "authenticated") {
			router.push(`/signin?callbackUrl=${encodeURIComponent("/")}`);
			return;
		}
		setStreamingUserQuery(null);
		setStreamingAssistantMarkdown(null);
		setStreamingCitations([]);
		setErrorMessage(null);
		setPhase("idle");
		await createConversation();
	}, [busy, createConversation, router, sessionStatus]);

	const runSearch = useCallback(async () => {
		let q = query.trim();
		let currentMode = researchMode;
		if (!q || busy) return;

		if (sessionStatus === "loading") return;

		const redirectToSignInWithQuery = (queryText: string) => {
			const callbackUrl = `/?q=${encodeURIComponent(queryText)}`;
			router.push(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
		};

		if (globalCommandRegistry.isCommand(q)) {
			if (sessionStatus !== "authenticated") {
				redirectToSignInWithQuery(q);
				return;
			}
			const result = await globalCommandRegistry.parseAndExecute(q, {
				conversationId: selectedConversationId,
			});

			if (!result) return;

			if (result.type === "error") {
				setErrorMessage(result.message ?? "Unknown command. Try /new, /history, /deep, or /share.");
				return;
			}

			setQuery("");

			if (result.type === "redirect" && result.payload === "/") {
				await onCreateConversation();
				return;
			}

			if (result.type === "system_message") {
				const historySelect = document.querySelector('select');
				if (historySelect) historySelect.focus();
				const newChatBtn = document.querySelector('button[aria-label="New conversation"]') as HTMLElement;
				if (newChatBtn) newChatBtn.focus();
				return;
			}

			if (result.type === "action") {
				if (result.payload?.mode === "deep") {
					setResearchMode("deep");
					currentMode = "deep";
					q = result.payload.query?.trim() || "";
					if (!q) return;
				} else if (result.payload?.action === "create_share") {
					const shareBtns = document.querySelectorAll('button');
					for (const btn of Array.from(shareBtns)) {
						if (btn.textContent?.includes('Share') || btn.getAttribute('aria-label')?.includes('Share')) {
							btn.click();
							break;
						}
					}
					return;
				} else {
					return;
				}
			} else {
				return;
			}
		}

		if (!q) return;

		const isGuest = sessionStatus !== "authenticated";

		if (isGuest && messages.length > 0) {
			// Clear previous messages and thread context for guest to allow a new standalone search
			setMessages([]);
			setParentMessageId(undefined);
			setSelectedConversationId(null);
			setSelectedConversationTitle(null);
			setShareContext(null);
			setStreamingUserQuery(null);
			setStreamingAssistantMarkdown(null);
			setStreamingCitations([]);
		}

		if (isGuest && currentMode === "deep") {
			lastSubmittedQueryRef.current = q;
			setLimitErrorAction(null);
			setErrorCode("SIGNIN_DEEP");
			setErrorMessage(
				"Deep Research uses longer, multi-step analysis. Sign in with Google or GitHub to unlock it.",
			);
			setPhase("error");
			return;
		}

		let conversationId: string | null = selectedConversationId;

		if (!isGuest) {
			if (!conversationId) {
				conversationId = await createConversation(q);
			}
		} else {
			conversationId = null;
		}

		lastSubmittedQueryRef.current = q;

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		setErrorMessage(null);
		setErrorCode(null);
		setLimitErrorAction(null);
		setQuery("");
		setStreamingUserQuery(q);
		setStreamingAssistantMarkdown("");
		setStreamingCitations([]);
		setShareContext(null);
		setPhase("connecting");
		answerStreamStartedLoggedRef.current = false;

		try {
			logProductEvent({
				event: "search_submitted",
				surface: messages.length === 0 ? "home" : "search",
				userType: isGuest ? "guest" : "signed_in",
				queryLength: q.length,
			});
		} catch {
			// ignore analytics
		}

		try {
			const response = await fetch("/api/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(
					isGuest
						? {
								query: q,
								mode: "standard",
								presetId: selectedPresetId,
							}
						: {
								query: q,
								conversationId,
								parentMessageId,
								continueResearch: Boolean(parentMessageId),
								mode: currentMode,
								presetId: selectedPresetId,
							},
				),
				signal: controller.signal,
				credentials: "include",
			});

			if (!response.ok) {
				const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
				const raw = parsed?.error?.message ?? `Request failed (${response.status})`;
				let code = parsed?.error?.code;

				if (response.status === 429 && !code && isGuest) {
					code = "ANONYMOUS_QUOTA_EXCEEDED";
				}

				setErrorCode(typeof code === "string" ? code : null);
				let msg: string;
				let action: "quota" | "plan" | null = null;
				if (response.status === 401 || code === "UNAUTHENTICATED") {
					msg = "That needs an account—sign in to continue a saved thread or use Deep Research.";
				} else if (code === "ANONYMOUS_QUOTA_EXCEEDED") {
					msg =
						"You’ve used your complimentary searches for today. Sign in to continue with saved threads, follow-ups, Deep Research, and sharing.";
				} else if (response.status === 402 || code === "QUOTA_EXCEEDED") {
					action = "quota";
					msg =
						"You've used all included searches for this month. Upgrade for a higher limit, or try again after your quota resets (UTC month).";
				} else if (code === "PLAN_REQUIRED") {
					action = isGuest ? null : "plan";
					msg = isGuest
						? "Deep Research is available after you sign in."
						: "Deep Research is included on Pro and Team plans.";
				} else if (response.status === 403) {
					msg = raw;
				} else if (response.status === 429) {
					msg =
						code === "ANONYMOUS_QUOTA_EXCEEDED"
							? "You’ve used your complimentary searches for today. Sign in to continue with saved threads, follow-ups, Deep Research, and sharing."
							: "Too many requests. Please wait a moment and try again.";
				} else if (response.status >= 500) {
					msg = "The service is temporarily unavailable. Please try again in a few minutes.";
				} else {
					msg = raw;
				}
				setPhase("error");
				setLimitErrorAction(action);
				setErrorMessage(msg);
				void refreshBilling();

				if (code === "ANONYMOUS_QUOTA_EXCEEDED") {
					try {
						logProductEvent({
							event: "guest_quota_reached",
							surface: "search",
							userType: "guest",
							errorCode: "ANONYMOUS_QUOTA_EXCEEDED",
						});
					} catch {
						// ignore analytics
					}
				} else {
					try {
						logProductEvent({
							event: "search_failed",
							surface: "search",
							userType: isGuest ? "guest" : "signed_in",
							queryLength: q.length,
							errorCode: `phase:connecting|status:${response.status}|code:${code || "HTTP_ERROR"}`,
						});
					} catch {
						// ignore analytics
					}
				}

				if (
					response.status === 401 ||
					response.status === 402 ||
					response.status === 429 ||
					code === "ANONYMOUS_QUOTA_EXCEEDED" ||
					code === "PLAN_REQUIRED"
				) {
					setQuery(q);
					setStreamingUserQuery(null);
				}

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
			let streamedAnswer = "";
			let finalCitations: CitationItem[] = [];

			const processBlock = (raw: string) => {
				try {
					const block = parseSseBlock(raw);
					if (!block) return;

					if (block.event === "metadata") {
						const meta = safeJson<MetadataPayload>(block.data);
						if (meta && Array.isArray(meta.citations)) {
							finalCitations = [...meta.citations];
							setStreamingCitations([...meta.citations]);
						}
						if (!answerStreamStartedLoggedRef.current) {
							answerStreamStartedLoggedRef.current = true;
							try {
								logProductEvent({
									event: "answer_stream_started",
									surface: "answer",
									userType: isGuest ? "guest" : "signed_in",
									queryLength: q.length,
									sourceCount:
										meta && Array.isArray(meta.citations) ? meta.citations.length : undefined,
								});
							} catch {
								// ignore analytics
							}
						}
					} else if (block.event === "text") {
						const chunk = safeJson<TextPayload>(block.data);
						if (chunk?.delta) {
							if (!answerStreamStartedLoggedRef.current) {
								answerStreamStartedLoggedRef.current = true;
								try {
									logProductEvent({
										event: "answer_stream_started",
										surface: "answer",
										userType: isGuest ? "guest" : "signed_in",
										queryLength: q.length,
										sourceCount: finalCitations.length > 0 ? finalCitations.length : undefined,
									});
								} catch {
									// ignore analytics
								}
							}
							streamedAnswer += chunk.delta;
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
						try {
							logProductEvent({
								event: "answer_completed",
								surface: "answer",
								userType: isGuest ? "guest" : "signed_in",
								queryLength: q.length,
								sourceCount: finalCitations.length,
								conversationId: finalConversationId ?? undefined,
								messageId: doneMessageId,
							});
						} catch {
							// ignore analytics
						}
					} else if (block.event === "error") {
						const err = safeJson<StreamErrorPayload>(block.data);
						setPhase("error");
						setErrorMessage(err?.message ?? "Stream interrupted.");
					}
				} catch (e) {
					console.error("SSE_PARSE_ERROR:", e);
					setPhase("error");
					setErrorMessage("A technical error occurred while parsing the response.");
				}
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					if (buffer.trim().length > 0) {
						processBlock(buffer);
					}
					break;
				}
				buffer += decoder.decode(value, { stream: true });

				while (true) {
					const match = buffer.match(/\r?\n\r?\n/);
					if (!match) break;

					const sep = match.index!;
					const sepLen = match[0].length;
					const raw = buffer.slice(0, sep);
					buffer = buffer.slice(sep + sepLen);
					processBlock(raw);
				}
			}

			if (!sawDone) {
				setPhase((p) => (p === "streaming" || p === "connecting" ? "complete" : p));
			}

			// Client-side phantom citation cleanup.
			// Strip any [N] where N is not in the valid citation set.
			const validCitationIndices = new Set(finalCitations.map((c) => c.index));
			const stripPhantomCitations = (text: string): string =>
				text.replace(/\[(\d{1,4})\]/g, (match, num: string) => {
					const n = parseInt(num, 10);
					return validCitationIndices.has(n) ? match : "";
				});
			const cleanedStreamedAnswer = stripPhantomCitations(streamedAnswer);

			// Replace live streamed markdown with cleaned version
			if (cleanedStreamedAnswer !== streamedAnswer) {
				setStreamingAssistantMarkdown(cleanedStreamedAnswer);
			}

			if (isGuest && sawDone) {
				const ts = new Date().toISOString();
				const uid = `guest-${Date.now()}-u`;
				const aid = `guest-${Date.now()}-a`;
				setMessages([
					{
						id: uid,
						role: "USER",
						content: q,
						parentMessageId: null,
						citations: null,
						createdAt: ts,
					},
					{
						id: aid,
						role: "ASSISTANT",
						content: cleanedStreamedAnswer,
						parentMessageId: uid,
						citations: finalCitations,
						createdAt: ts,
					},
				]);
			}

			// Refetch persisted full history inside the selected thread.
			if (!isGuest && sawDone && (doneConversationId ?? conversationId)) {
				const finalId = doneConversationId ?? conversationId!;
				await fetchMessagesForConversation(finalId);
				void refreshBilling();
			}

			setStreamingUserQuery(null);
			setStreamingAssistantMarkdown(null);
			setStreamingCitations([]);
		} catch (e: unknown) {
			if (e instanceof DOMException && e.name === "AbortError") {
				// A client-side abort (user navigated away, submitted new query, etc)
				// is an expected cancellation, NOT a system failure. Do not log search_failed.
				setPhase("idle");
				setErrorMessage(null);
				setErrorCode(null);
				setStreamingUserQuery(null);
				setStreamingAssistantMarkdown(null);
				setStreamingCitations([]);
				return;
			}
			const raw = e instanceof Error ? e.message : "Unexpected error.";
			const msg = /network|fetch|Failed to fetch/i.test(raw)
				? "Network error. Check your connection and try again."
				: raw;

			try {
				let codeStr = `phase:${phase}|code:`;
				if (/network|fetch|Failed to fetch/i.test(raw)) {
					codeStr += "NETWORK_ERROR";
				} else {
					codeStr += "UNKNOWN_ERROR";
				}

				logProductEvent({
					event: "search_failed",
					surface: "search",
					userType: sessionStatus === "authenticated" ? "signed_in" : "guest",
					queryLength: query.length,
					errorCode: codeStr,
				});
			} catch {
				// ignore analytics
			}

			setPhase("error");
			setErrorMessage(msg);
		}
	}, [
		busy,
		createConversation,
		fetchMessagesForConversation,
		onCreateConversation,
		messages.length,
		parentMessageId,
		query,
		selectedConversationId,
		selectedPresetId,
		researchMode,
		refreshBilling,
		router,
		sessionStatus,
	]);

	const onSelectConversation = useCallback(
		async (id: string) => {
			if (busy) return;
			if (sessionStatus !== "authenticated") return;
			setSelectedConversationId(id);
			setShareContext(null);
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
		[apiFetchJson, busy, fetchMessagesForConversation, sessionStatus],
	);

	return (
		<div className={cn("relative min-h-dvh w-full overflow-hidden", className)}>
			<div className="relative z-10 mx-auto flex min-h-dvh max-w-7xl flex-col md:flex-row">
				{isAuthed ? (
					<div className="hidden w-[320px] shrink-0 md:block md:py-4 md:pl-4">
						<ConversationSidebar
							conversations={conversations}
							selectedConversationId={selectedConversationId}
							onSelectConversation={onSelectConversation}
							onCreateConversation={onCreateConversation}
							disabled={busy}
						/>
					</div>
				) : null}

				<main className="flex min-h-dvh flex-1 flex-col md:py-4 md:pr-4">
					<div className="px-4 pt-4 md:pt-0">
						<div className="mx-auto flex max-w-4xl justify-center">
							<div className="inline-flex max-w-full items-center justify-center rounded-full border border-accent/15 bg-surface-elevated/70 px-4 py-2 text-center text-xs font-medium text-accent shadow-panel backdrop-blur-sm sm:text-sm md:bg-surface-elevated/55 md:backdrop-blur-md">
								Research with live citations—try standard search here. Sign in for saved threads, Deep Research, and
								share links.
							</div>
						</div>
					</div>
					<header className={cn(
						"mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 transition-all duration-300",
						showConversationEmpty ? "py-10 md:py-16" : "py-6 md:py-8"
					)}>
						{billing && sessionStatus === "authenticated" ? (
							<div
								className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-3xl border border-border-subtle bg-surface-elevated/75 px-4 py-3 text-sm shadow-panel backdrop-blur-sm md:backdrop-blur-md"
								aria-label="Plan and usage"
							>
								<span className="font-semibold text-content-primary">
									{planDisplayName(billing.billingPlan)} plan
								</span>
								<span className="text-content-secondary">
									<span className="tabular-nums font-medium text-content-primary">
										{billing.searchesRemaining}
									</span>
									{" / "}
									<span className="tabular-nums">{billing.monthlySearchLimit}</span>
									<span className="text-content-tertiary"> searches left this month</span>
								</span>
								{billing.billingPlan === "FREE" ? (
									<Link
										href="/upgrade"
										className="ml-auto inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
									>
										Upgrade
									</Link>
								) : null}
							</div>
						) : null}
						<div className="flex items-center justify-between gap-3">
							<div className="flex min-w-0 flex-1 items-center gap-3">
								{isAuthed ? (
									<>
										<button
											type="button"
											onClick={() => setMobileSidebarOpen(true)}
											className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border-subtle bg-surface-elevated/80 text-content-primary shadow-panel backdrop-blur-sm md:hidden hover:bg-surface-elevated active:scale-95 transition-transform"
											aria-label="Open conversation list"
										>
											<Menu className="size-5" />
										</button>
										<div className={cn(
											"hidden shrink-0 items-center justify-center rounded-2xl bg-accent text-white shadow-glass ring-1 ring-white/25 md:flex transition-all duration-300",
											showConversationEmpty ? "size-12 md:size-14" : "size-11"
										)}>
											<Sparkles className={cn(showConversationEmpty ? "size-6 md:size-7" : "size-5")} aria-hidden />
										</div>
									</>
								) : (
									<div className={cn(
										"flex shrink-0 items-center justify-center rounded-2xl bg-accent text-white shadow-glass ring-1 ring-white/25 transition-all duration-300",
										showConversationEmpty ? "size-14 md:size-16" : "size-11"
									)}>
										<Sparkles className={cn(showConversationEmpty ? "size-6 md:size-8" : "size-5")} aria-hidden />
									</div>
								)}
								<div className="min-w-0">
									<h1
										className={cn(
											"font-semibold tracking-tight text-content-primary transition-all duration-300",
											showConversationEmpty
												? "text-3xl md:text-4xl font-extrabold"
												: "truncate text-lg md:text-xl",
										)}
									>
										{showConversationEmpty
											? "AiraAI"
											: (selectedConversationTitle ?? "Research")}
									</h1>
									<p className="mt-1 text-xs leading-relaxed text-content-secondary sm:text-[13px]">
										{showAssistantSkeleton
											? statusText
											: showConversationEmpty
												? isAuthed
													? "Persistent research threads with live web citations. Switch to Deep Research for comprehensive reports."
													: "Get answers grounded with live web citations. No account required."
												: "Persistent threads with live web citations."}
									</p>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<a
									href={FEEDBACK_MAILTO_HREF}
									onClick={() =>
										logProductEvent({ event: "feedback_clicked", surface: "header" })
									}
									className="text-xs font-medium text-content-tertiary underline-offset-2 hover:text-accent hover:underline sm:text-[13px]"
								>
									Feedback
								</a>
								<UserMenu className="flex" />
							</div>
						</div>
					</header>

					<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 pb-8 md:px-8">
						{isAuthed && showConversationEmpty ? (
							<ResearchHistoryPanel items={researchHistory} onSelectItem={onSelectConversation} />
						) : null}

						<div
							className={cn(
								"flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border-subtle/80 bg-surface-elevated/45 shadow-glass backdrop-blur-sm md:bg-surface-elevated/40 md:backdrop-blur-xl",
								showConversationEmpty ? "order-4 md:order-none" : "order-1 md:order-none"
							)}
							aria-busy={busy}
						>
							<div className="min-h-0 flex-1 overflow-y-auto">
								<ConversationMessageList
									messages={messages}
									streamingUserQuery={streamingUserQuery}
									streamingAssistantMarkdown={streamingAssistantMarkdown}
									streamingCitations={streamingCitations}
									showAssistantSkeleton={showAssistantSkeleton}
									showEmptyHint={showConversationEmpty}
									isAuthed={isAuthed}
									recentConversations={conversations}
									onSelectConversation={onSelectConversation}
									exampleQueries={EXAMPLE_QUERIES}
									onPickExample={(q) => {
										try {
											logProductEvent({
												event: "example_query_clicked",
												surface: "home",
												userType: isAuthed ? "signed_in" : "guest",
												queryLength: q.length,
											});
										} catch {
											// ignore analytics
										}
										setQuery(q);
										requestAnimationFrame(() => searchBoxRef.current?.focus());
									}}
									statusText={statusText}
								/>
							</div>
							{(shareContext || (!isAuthed && phase === "complete" && messages.length > 0)) && !busy ? (
								<ShareResultBar
									conversationId={shareContext?.conversationId}
									messageId={shareContext?.messageId}
									onGuestClick={() => {
										router.push(`/signin?callbackUrl=${encodeURIComponent("/")}`);
									}}
								/>
							) : null}
							{!isAuthed && messages.length > 0 && !busy && !shareContext ? (
								<div
									className="flex flex-col gap-2 border-t border-border-subtle/80 bg-surface-elevated/60 px-3 py-3 backdrop-blur-sm sm:px-4 md:backdrop-blur-md"
									role="region"
									aria-label="Continue research"
								>
									<p className="text-sm font-medium text-content-primary">Continue your research</p>
									<p className="text-xs leading-relaxed text-content-secondary">
										Save this thread, continue research, and unlock Deep Research by signing in.
									</p>
									<Link
										href={`/signin?callbackUrl=${encodeURIComponent("/")}`}
										onClick={() => {
											try {
												logProductEvent({
													event: "sign_in_clicked",
													surface: "auth",
													userType: "guest",
												});
											} catch {
												// ignore analytics
											}
										}}
										className="inline-flex w-fit items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
									>
										Sign in to continue
									</Link>
								</div>
							) : null}
						</div>

						<p className="sr-only" aria-live="polite">
							{phase === "connecting"
								? statusText
								: phase === "streaming"
									? "Streaming answer."
									: phase === "complete"
										? "Answer complete."
										: phase === "error"
											? errorCode === "ANONYMOUS_QUOTA_EXCEEDED"
												? "Guest search limit reached."
												: errorCode === "SIGNIN_DEEP" ||
												  (errorCode === "PLAN_REQUIRED" && !isAuthed) ||
												  errorCode === "SIGNIN_FOLLOWUP"
													? "Account required."
													: "An error occurred."
											: ""}
						</p>

						<div
							className={cn(
								"flex flex-col gap-3",
								showConversationEmpty
									? "order-3 md:order-none"
									: "order-2 md:order-none sticky bottom-0 z-20 -mx-4 bg-surface/95 px-4 pb-4 pt-2 border-t border-border-subtle/60 backdrop-blur-md md:relative md:bottom-auto md:z-auto md:mx-0 md:bg-transparent md:p-0 md:border-none md:backdrop-blur-none"
							)}
						>
							<div className="flex flex-col sm:flex-row gap-3">
								<div
									className={cn(
										"flex w-full overflow-hidden rounded-3xl border border-border-subtle/80 bg-surface-elevated/85 shadow-panel backdrop-blur-sm ring-1 ring-white/40 sm:max-w-[200px] md:backdrop-blur-md",
									)}
								>
									<select
										className="w-full bg-transparent px-3 py-2 text-sm font-medium text-content-primary focus:outline-none"
										value={selectedPresetId}
										onChange={(e) => setSelectedPresetId(e.target.value as ResearchPresetId)}
										disabled={busy}
										aria-label="Research focus"
									>
										{Object.values(RESEARCH_PRESETS).map((p) => (
											<option key={p.id} value={p.id}>
												{p.label}
											</option>
										))}
									</select>
								</div>

								{isAuthed ? (
									<div
										className={cn(
											"flex w-full overflow-hidden rounded-3xl border border-border-subtle/80 bg-surface-elevated/85 shadow-panel backdrop-blur-sm ring-1 ring-white/40 sm:max-w-[320px] md:backdrop-blur-md",
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
											onClick={() => {
												try {
													logProductEvent({
														event: "deep_research_clicked",
														surface: "deep_research",
														userType: "signed_in",
													});
												} catch {
													// ignore analytics
												}
												setResearchMode("deep");
											}}
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
								) : (
									<button
										type="button"
										disabled={busy}
										onClick={() => {
											try {
												logProductEvent({
													event: "deep_research_clicked",
													surface: "deep_research",
													userType: "guest",
												});
											} catch {
												// ignore analytics
											}
											router.push(`/signin?callbackUrl=${encodeURIComponent("/")}`);
										}}
										className={cn(
											"flex w-full items-center justify-center rounded-3xl border border-border-subtle/80 bg-surface-elevated/85 px-3 py-2 text-sm font-medium text-content-secondary shadow-panel backdrop-blur-sm ring-1 ring-white/40 md:backdrop-blur-md",
											"hover:border-accent/35 hover:text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
											"sm:max-w-[320px]",
											"disabled:opacity-40 disabled:pointer-events-none",
										)}
										aria-label="Deep Research requires a signed-in account"
									>
										Deep Research · Sign in
									</button>
								)}
							</div>
							{!isAuthed ? (
								<p className="text-center text-xs leading-relaxed text-content-tertiary">
									<span className="text-content-secondary">
										Guest mode: 5 free searches per day.{" "}
									</span>
									<Link
										href={`/signin?callbackUrl=${encodeURIComponent("/")}`}
										onClick={() => {
											try {
												logProductEvent({
													event: "sign_in_clicked",
													surface: "auth",
													userType: "guest",
												});
											} catch {
												// ignore analytics
											}
										}}
										className="font-medium text-accent underline-offset-2 hover:underline"
									>
										Sign in
									</Link>{" "}
									for saved threads, slash commands, follow-ups, Deep Research, and sharing.
								</p>
							) : null}
							{billing?.billingPlan === "FREE" && researchMode === "deep" ? (
								<p className="text-center text-xs text-amber-800/90">
									Deep Research requires a Pro or Team plan.{" "}
									<Link href="/upgrade" className="font-medium text-accent underline-offset-2 hover:underline">
										Upgrade
									</Link>
								</p>
							) : null}

							<SearchBox
								ref={searchBoxRef}
								value={query}
								onChange={setQuery}
								onSubmit={() => void runSearch()}
								disabled={busy}
								isBusy={busy}
								placeholder={
									!isAuthed
										? "Ask anything..."
										: messages.length > 0
											? "Send a follow-up…"
											: "Ask anything..."
								}
							/>
							{isAuthed ? (
								<div className="text-xs text-content-tertiary px-2">
									Try <span className="font-mono text-content-secondary">/new</span>,{" "}
									<span className="font-mono text-content-secondary">/history</span>,{" "}
									<span className="font-mono text-content-secondary">/deep</span>,{" "}
									<span className="font-mono text-content-secondary">/share</span>
								</div>
							) : null}

							{phase === "error" && errorMessage ? (
								<div
									className={cn(
										"rounded-3xl border p-4 text-sm shadow-panel backdrop-blur-sm md:backdrop-blur-md",
										errorCode === "ANONYMOUS_QUOTA_EXCEEDED"
											? "border-indigo-200 bg-indigo-50/90 text-indigo-950"
											: "border-red-200/80 bg-red-50/90 text-red-800",
									)}
									role="alert"
								>
									<p
										className={cn(
											"font-semibold",
											errorCode === "ANONYMOUS_QUOTA_EXCEEDED" ? "text-indigo-950" : "text-red-900",
										)}
									>
										{errorCode === "ANONYMOUS_QUOTA_EXCEEDED"
											? "Guest search limit reached"
											: errorCode === "SIGNIN_DEEP" ||
											  (errorCode === "PLAN_REQUIRED" && !isAuthed) ||
											  errorCode === "SIGNIN_FOLLOWUP"
												? "Account required"
												: limitErrorAction === "quota"
													? "Monthly search limit reached"
													: limitErrorAction === "plan"
														? "Upgrade required"
														: "Something went wrong"}
									</p>
									{errorCode === "ANONYMOUS_QUOTA_EXCEEDED" ? (
										<div className="mt-2 space-y-3">
											<p className="text-indigo-900/90">
												You’ve used your free searches for today. Sign in to continue this research.
											</p>
											<ul className="space-y-1.5 text-indigo-900/80">
												<li className="flex items-center gap-2">
													<div className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
													<span>Save this thread</span>
												</li>
												<li className="flex items-center gap-2">
													<div className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
													<span>Ask follow-up questions</span>
												</li>
												<li className="flex items-center gap-2">
													<div className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
													<span>Unlock Deep Research</span>
												</li>
											</ul>
										</div>
									) : (
										<p className="mt-1 text-red-800/95">{errorMessage}</p>
									)}
									{errorCode === "ANONYMOUS_QUOTA_EXCEEDED" ||
									errorCode === "SIGNIN_DEEP" ||
									(errorCode === "PLAN_REQUIRED" && sessionStatus !== "authenticated") ? (
										<div className="mt-3">
											<Link
												href={`/signin?callbackUrl=${encodeURIComponent(
													lastSubmittedQueryRef.current.trim().length > 0
														? `/?q=${encodeURIComponent(lastSubmittedQueryRef.current.trim())}`
														: "/",
												)}`}
												onClick={() => {
													try {
														logProductEvent({
															event: "sign_in_clicked",
															surface: "auth",
															userType: "guest",
															errorCode: errorCode ?? undefined,
														});
													} catch {
														// ignore analytics
													}
												}}
												className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
											>
												Sign in to continue
											</Link>
										</div>
									) : null}
									{limitErrorAction === "quota" || limitErrorAction === "plan" ? (
										<div className="mt-3 flex flex-wrap gap-2">
											<Link
												href="/upgrade"
												className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
											>
												View plans & upgrade
											</Link>
											{limitErrorAction === "plan" ? (
												<button
													type="button"
													onClick={() => {
														setResearchMode("standard");
														setLimitErrorAction(null);
														setErrorMessage(null);
														setErrorCode(null);
														setPhase("idle");
													}}
													className="inline-flex items-center justify-center rounded-xl border border-border-subtle bg-surface-elevated/80 px-4 py-2 text-sm font-medium text-content-primary hover:bg-surface-elevated"
												>
													Switch to Standard Search
												</button>
											) : null}
										</div>
									) : limitErrorAction === null &&
									  errorCode !== "ANONYMOUS_QUOTA_EXCEEDED" &&
									  errorCode !== "SIGNIN_DEEP" &&
									  !(errorCode === "PLAN_REQUIRED" && sessionStatus !== "authenticated") &&
									  errorCode !== "SIGNIN_FOLLOWUP" ? (
										<div className="mt-3">
											<button
												type="button"
												onClick={() => {
													void runSearch();
												}}
												className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-100/50 px-4 py-2 text-sm font-medium text-red-900 shadow-sm hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
											>
												<RotateCw className="mr-2 size-4" />
												Retry Search
											</button>
										</div>
									) : null}
								</div>
							) : null}
						</div>
					</div>

					<footer className="mt-auto flex flex-col items-center gap-2 border-t border-border-subtle/70 py-6 text-center text-xs text-content-tertiary">
						<p>Responses are generated from retrieved sources. Verify critical facts independently.</p>
						<p>Built for fast, reliable research with sources.</p>
						<a
							href={FEEDBACK_MAILTO_HREF}
							onClick={() =>
								logProductEvent({ event: "feedback_clicked", surface: "footer" })
							}
							className="mt-2 inline-flex h-8 items-center justify-center rounded-xl bg-surface-elevated/90 px-4 font-medium text-content-primary shadow-panel ring-1 ring-border-subtle/80 backdrop-blur-sm transition hover:bg-surface-elevated hover:text-accent focus-visible:outline-accent md:backdrop-blur-md"
						>
							Send feedback
						</a>
					</footer>
				</main>
			</div>

			{isAuthed && mobileSidebarOpen ? (
				<div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
					<div
						className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300"
						onClick={() => setMobileSidebarOpen(false)}
					/>
					<div className="relative flex w-[300px] max-w-[85vw] flex-col bg-surface shadow-glass animate-in slide-in-from-left duration-300 ease-out ring-1 ring-black/5">
						<div className="flex h-14 items-center justify-between border-b border-border-subtle/80 px-4">
							<span className="font-semibold text-content-primary">Menu</span>
							<button
								type="button"
								onClick={() => setMobileSidebarOpen(false)}
								className="rounded-lg p-1.5 text-content-secondary hover:bg-surface-inset active:scale-95 transition-transform"
								aria-label="Close menu"
							>
								<X className="size-5" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-4">
							<ConversationSidebar
								conversations={conversations}
								selectedConversationId={selectedConversationId}
								onSelectConversation={(id) => {
									void onSelectConversation(id);
									setMobileSidebarOpen(false);
								}}
								onCreateConversation={() => {
									void onCreateConversation();
									setMobileSidebarOpen(false);
								}}
								disabled={busy}
							/>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
