"use client";

// SSE boundary fix: robust parsing of LF/CRLF
interface ProgressPayload {
	readonly stage: string;
	readonly message: string;
	readonly elapsedMs: number;
}

import { Sparkles, RotateCw, Menu, X, History, ArrowDown } from "lucide-react";
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
import { AiraDeliverablesCanvas } from "./AiraDeliverablesCanvas";
import {
	type ConversationMessageDto,
	ConversationMessageList,
} from "./conversations/ConversationMessageList";
import {
	type ConversationSummary,
	ConversationSidebar,
} from "./conversations/ConversationSidebar";
import { ResearchHistoryPanel, type ResearchHistoryRow } from "./conversations/ResearchHistoryPanel";
import { ShareResultBar } from "./share/ShareResultBar";

export type SearchPhase = "idle" | "connecting" | "streaming" | "complete" | "error";

export type ResearchMode = "standard" | "deep";

export interface SearchLayoutProps {
	readonly className?: string;
}

const EXAMPLE_QUERIES = [
	"Competitive AI Infrastructure Due Diligence & SLA Analysis",
	"Sovereign Multi-Tenant Security & IDOR Threat Model",
	"Sub-100ms Inference Topologies & Dynamic Model Routing",
] as const;

/** Public support address. The feedback actions stay hidden until configured. */
const FEEDBACK_EMAIL =
	(typeof process.env.NEXT_PUBLIC_FEEDBACK_EMAIL === "string"
		? process.env.NEXT_PUBLIC_FEEDBACK_EMAIL.trim()
		: "");

const FEEDBACK_MAILTO_HREF = FEEDBACK_EMAIL
	? `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Research app feedback")}`
	: null;

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

function searchErrorTitle(
	code: string | null,
	action: "quota" | "plan" | null,
	isAuthed: boolean,
): string {
	if (code === "ANONYMOUS_QUOTA_EXCEEDED") return "Guest search limit reached";
	if (
		code === "SIGNIN_DEEP" ||
		(code === "PLAN_REQUIRED" && !isAuthed) ||
		code === "SIGNIN_FOLLOWUP"
	) {
		return "Account required";
	}
	if (action === "quota") return "Monthly search limit reached";
	if (action === "plan") return "Upgrade required";
	if (code === "UPSTREAM_RATE_LIMIT") return "Answer provider is busy";
	if (code === "UPSTREAM_TIMEOUT") return "Search timed out";
	if (code?.startsWith("UPSTREAM_")) return "Search temporarily unavailable";
	if (code === "NETWORK_ERROR") return "Connection interrupted";
	return "Something went wrong";
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
	const [progressStage, setProgressStage] = useState<string | null>(null);

	const abortRef = useRef<AbortController | null>(null);
	const searchBoxRef = useRef<SearchBoxHandle>(null);
	const answerStreamStartedLoggedRef = useRef(false);
	/** Avoid duplicate auto-submit for the same `?q=` after OAuth return. */
	const hasAutoRunUrlQueryRef = useRef<string | null>(null);
	/**
	 * Holds a ?q= value that has been written into `query` state but not yet
	 * submitted. The companion effect below fires after React commits the state
	 * update and calls runSearch() with the now-settled value, avoiding the
	 * stale-closure race that occurred when submit() was called before React
	 * re-rendered SearchBox with the new value prop.
	 */
	const pendingAutoRunQueryRef = useRef<string | null>(null);
	/** Last submitted question (state is cleared at search start; used for sign-in callback URLs). */
	const lastSubmittedQueryRef = useRef("");
	/** Monotonic generation counter to reject stale async operations (New Chat, Stop, switching) */
	const searchGenerationRef = useRef(0);
	/** Monotonic generation counter for conversation selection to prevent race conditions */
	const conversationSelectionGenerationRef = useRef(0);

	const searchParams = useSearchParams();
	useEffect(() => {
		const q = searchParams.get("q") ?? searchParams.get("prompt");
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
	const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(false);
	const [desktopSourcesOpen, setDesktopSourcesOpen] = useState(true);
	const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
	const [elapsedMs, setElapsedMs] = useState(0);
	const [showScrollBottom, setShowScrollBottom] = useState(false);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const isNearBottomRef = useRef(true);
	const [canvasOpen, setCanvasOpen] = useState(false);

	useEffect(() => {
		if (!busy) {
			setElapsedMs(0);
			return;
		}
		const startTime = Date.now();
		const interval = setInterval(() => {
			setElapsedMs(Date.now() - startTime);
		}, 100);
		return () => clearInterval(interval);
	}, [busy]);

	const handleScroll = useCallback(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		const nearBottom = distanceFromBottom < 100;
		isNearBottomRef.current = nearBottom;
		setShowScrollBottom(distanceFromBottom > 150);
	}, []);

	const activeCitations = useMemo<readonly CitationItem[]>(() => {
		if (streamingCitations.length > 0) return streamingCitations;
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m && m.role === "ASSISTANT" && Array.isArray(m.citations) && m.citations.length > 0) {
				return m.citations as readonly CitationItem[];
			}
		}
		return [];
	}, [streamingCitations, messages]);

	const scrollToBottom = useCallback(() => {
		const el = scrollContainerRef.current;
		if (el) {
			const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion ? "auto" : "smooth" });
			isNearBottomRef.current = true;
			setShowScrollBottom(false);
		}
	}, []);

	useEffect(() => {
		const onToggle = () => setCanvasOpen((prev) => !prev);
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "h") {
				event.preventDefault();
				setDesktopSidebarOpen((prev) => !prev);
			}
		};
		window.addEventListener("aira:toggle-canvas", onToggle);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("aira:toggle-canvas", onToggle);
			window.removeEventListener("keydown", onKey);
		};
	}, []);

	const showAssistantSkeleton = useMemo(
		() =>
			busy &&
			Boolean(streamingUserQuery) &&
			!(streamingAssistantMarkdown && streamingAssistantMarkdown.length > 0),
		[busy, streamingUserQuery, streamingAssistantMarkdown],
	);

	useEffect(() => {
		if (!busy || !isNearBottomRef.current) return;
		const el = scrollContainerRef.current;
		if (el) {
			el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
		}
	}, [busy, streamingAssistantMarkdown, showAssistantSkeleton]);

	const showConversationEmpty = useMemo(
		() =>
			messages.length === 0 &&
			!streamingUserQuery &&
			!(streamingAssistantMarkdown && streamingAssistantMarkdown.length > 0),
		[messages.length, streamingUserQuery, streamingAssistantMarkdown],
	);

	const showConversationPanel = useMemo(
		() => phase !== "error" || !showConversationEmpty,
		[phase, showConversationEmpty],
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
		setSelectedConversationId((prev) => {
			const convParam = searchParams.get("conversation")?.trim() || searchParams.get("thread")?.trim();
			const target = prev || convParam;
			return target && rows.conversations.some((conversation) => conversation.id === target)
				? target
				: target || null;
		});
	}, [apiFetchJson, searchParams]);

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

	const onSelectConversation = useCallback(
		async (id: string) => {
			// Invalidate any active search or previous selection
			searchGenerationRef.current += 1;
			const currentSelectionGen = ++conversationSelectionGenerationRef.current;
			abortRef.current?.abort();

			if (sessionStatus !== "authenticated") return;
			setSelectedConversationId(id);
			setShareContext(null);
			setStreamingUserQuery(null);
			setStreamingAssistantMarkdown(null);
			setStreamingCitations([]);
			setErrorMessage(null);
			setPhase("idle");

			try {
				const meta = await apiFetchJson<{
					readonly conversation: { readonly id: string; readonly title: string };
				}>(`/api/conversations/${encodeURIComponent(id)}`, { method: "GET" });
				if (currentSelectionGen !== conversationSelectionGenerationRef.current) return;
				setSelectedConversationTitle(meta.conversation.title);
			} catch {
				if (currentSelectionGen !== conversationSelectionGenerationRef.current) return;
				setSelectedConversationTitle(null);
			}

			try {
				const rows = await apiFetchJson<{ readonly messages: readonly ConversationMessageDto[] }>(
					`/api/conversations/${encodeURIComponent(id)}/messages?limit=500`,
					{ method: "GET" },
				);
				if (currentSelectionGen !== conversationSelectionGenerationRef.current) return;
				setMessages(rows.messages);
				const lastAssistant = [...rows.messages].reverse().find((m) => m.role === "ASSISTANT");
				setParentMessageId(lastAssistant?.id);
			} catch {
				// Ignore if navigated away
			}
		},
		[apiFetchJson, sessionStatus],
	);

	const createConversation = useCallback(
		async (initialQuery?: string, signal?: AbortSignal, expectedGen?: number): Promise<string | null> => {
			const payload: Record<string, unknown> = {};
			if (initialQuery && initialQuery.trim().length > 0) {
				payload.initialQuery = initialQuery.trim();
			}

			const res = await fetch("/api/conversations", {
				method: "POST",
				body: JSON.stringify(payload),
				signal,
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
				},
			});

			if (!res.ok) {
				const parsed = (await res.json().catch(() => null)) as ApiErrorBody | null;
				throw new Error(parsed?.error?.message ?? `Request failed (${res.status})`);
			}

			const created = (await res.json()) as { readonly conversation: ConversationSummary };

			// Concurrency guard: if user navigated away or started a newer search, do NOT set conversation state
			if (expectedGen !== undefined && expectedGen !== searchGenerationRef.current) {
				return null;
			}

			setSelectedConversationId(created.conversation.id);
			setSelectedConversationTitle(created.conversation.title);
			setMessages([]);
			setParentMessageId(undefined);
			return created.conversation.id;
		},
		[],
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

	// Deep-link pre-fill: write the ?q= value into composer state.
	// We intentionally do NOT auto-submit here; submission is handled by the
	// companion effect below, which fires after React commits this state update.
	useEffect(() => {
		if (sessionStatus === "loading" || busy) return;
		const qParam = searchParams.get("q")?.trim();
		if (!qParam) return;
		if (hasAutoRunUrlQueryRef.current === qParam) return;
		hasAutoRunUrlQueryRef.current = qParam;
		// Preserve user edits: only pre-fill when composer is empty.
		// We read `query` from the effect's closure (the committed value at the
		// time this effect runs) to decide whether to pre-fill. This is safe
		// because effects always run after React commits state.
		setQuery((prev) => {
			// Pure updater — no side effects. Returns the new state value only.
			if (prev.trim().length > 0) return prev;
			return qParam;
		});
		// Arm the auto-run for this URL query
		pendingAutoRunQueryRef.current = qParam;
		if (query.trim() === qParam) {
			pendingAutoRunQueryRef.current = null;
			void runSearch();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionStatus, searchParams, busy, query]);


	// Deep-link auto-run: fires after React has committed the ?q= value into
	// the SearchBox value prop, preventing the stale-state race where submit()
	// would read an empty string before the prop update landed.
	useEffect(() => {
		if (!pendingAutoRunQueryRef.current) return;
		if (query.trim() !== pendingAutoRunQueryRef.current) return;
		if (busy) return;
		const settledQuery = pendingAutoRunQueryRef.current;
		pendingAutoRunQueryRef.current = null;
		// runSearch reads `query` state; because this effect only runs after
		// React commits the new value, `query` is now equal to settledQuery.
		void runSearch();
		// We intentionally do not include runSearch in deps — it is stable
		// (useCallback) but its identity changes each render; listing it would
		// cause the effect to re-fire on every render after the first submit.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, busy]);

	useEffect(() => {
		if (sessionStatus !== "authenticated" || busy) return;
		const convParam = searchParams.get("conversation")?.trim() || searchParams.get("thread")?.trim();
		if (!convParam) return;
		if (convParam === selectedConversationId && messages.length > 0) return;

		void onSelectConversation(convParam);
	}, [busy, messages.length, onSelectConversation, searchParams, selectedConversationId, sessionStatus]);

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
		// Invalidate any in-flight search or conversation selection
		searchGenerationRef.current += 1;
		conversationSelectionGenerationRef.current += 1;
		abortRef.current?.abort();

		setSelectedConversationId(null);
		setSelectedConversationTitle(null);
		setMessages([]);
		setParentMessageId(undefined);
		setResearchHistory([]);
		setShareContext(null);
		setStreamingUserQuery(null);
		setStreamingAssistantMarkdown(null);
		setStreamingCitations([]);
		setQuery("");
		setErrorMessage(null);
		setErrorCode(null);
		setLimitErrorAction(null);
		setResearchMode("standard");
		setPhase("idle");
		setMobileSourcesOpen(false);
		if (typeof window !== "undefined" && window.location.search) {
			router.replace("/");
		}
		requestAnimationFrame(() => searchBoxRef.current?.focus());
	}, [router]);

	const handleStop = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	useEffect(() => {
		const handleNewChat = () => {
			void onCreateConversation();
		};
		window.addEventListener("aira:new-chat", handleNewChat);
		return () => window.removeEventListener("aira:new-chat", handleNewChat);
	}, [onCreateConversation]);

	const runSearch = useCallback(async (searchContext?: { model?: string; attachments?: readonly unknown[] }) => {
		let q = query.trim();
		let currentMode = researchMode;
		if (!q || busy) return;

		const chosenModel = searchContext?.model ?? "auto";

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
				conversationId: selectedConversationId ?? undefined,
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
				if ("mode" in result.payload && result.payload.mode === "deep") {
					setResearchMode("deep");
					currentMode = "deep";
					q = result.payload.query.trim();
					if (!q) return;
				} else if (
					"action" in result.payload &&
					result.payload.action === "create_share"
				) {
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

		// Arm AbortController and monotonic generation token BEFORE any async calls (including conversation creation)
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		const currentGeneration = ++searchGenerationRef.current;

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

		let conversationId: string | null = selectedConversationId;

		if (!isGuest) {
			if (!conversationId) {
				try {
					conversationId = await createConversation(q, controller.signal, currentGeneration);
				} catch (e) {
					if (currentGeneration !== searchGenerationRef.current) return;
					if (controller.signal.aborted) return;
					throw e;
				}
				// If user clicked New Chat, Stop, or switched conversations while createConversation was awaiting:
				if (currentGeneration !== searchGenerationRef.current) return;
			}
		} else {
			conversationId = null;
		}

		lastSubmittedQueryRef.current = q;

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

		let streamedAnswer = "";

		try {
			if (currentGeneration !== searchGenerationRef.current) return;
			const response = await fetch("/api/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(
					isGuest
						? {
								query: q,
								mode: "standard",
								presetId: selectedPresetId,
								model: chosenModel,
							}
						: {
								query: q,
								conversationId,
								parentMessageId,
								continueResearch: Boolean(parentMessageId),
								mode: currentMode,
								presetId: selectedPresetId,
								model: chosenModel,
							},
				),
				signal: controller.signal,
				credentials: "include",
			});
			if (currentGeneration !== searchGenerationRef.current) return;

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
				} else if (
					code === "UPSTREAM_QUOTA_EXHAUSTED" ||
					code === "UPSTREAM_CONFIG" ||
					code === "UPSTREAM_RATE_LIMIT" ||
					code === "UPSTREAM_TIMEOUT" ||
					code === "UPSTREAM_ERROR"
				) {
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
				setQuery(q);
				setStreamingUserQuery(null);
				setStreamingAssistantMarkdown(null);
				setStreamingCitations([]);
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
			streamedAnswer = "";
			let finalCitations: CitationItem[] = [];

			const processBlock = (raw: string) => {
				if (currentGeneration !== searchGenerationRef.current) return;
				try {
					const block = parseSseBlock(raw);
					if (!block) return;

					if (block.event === "progress") {
						const prog = safeJson<ProgressPayload>(block.data);
						if (prog?.message) {
							setStatusText(prog.message);
							setProgressStage(prog.stage);
						}
					} else if (block.event === "metadata") {
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
						setErrorCode(err?.code ?? null);
						setErrorMessage(err?.message ?? "Stream interrupted.");
						setQuery(q);
						if (streamedAnswer.trim().length === 0) {
							setStreamingUserQuery(null);
							setStreamingAssistantMarkdown(null);
							setStreamingCitations([]);
						}
					}
				} catch (e) {
					console.error("SSE_PARSE_ERROR:", e);
					setPhase("error");
					setErrorMessage("A technical error occurred while parsing the response.");
				}
			};

			while (true) {
				if (currentGeneration !== searchGenerationRef.current) {
					reader.cancel().catch(() => {});
					return;
				}
				const { done, value } = await reader.read();
				if (currentGeneration !== searchGenerationRef.current) {
					reader.cancel().catch(() => {});
					return;
				}
				if (done) {
					if (buffer.trim().length > 0) {
						processBlock(buffer);
					}
					break;
				}
				buffer += decoder.decode(value, { stream: true });

				while (true) {
					if (currentGeneration !== searchGenerationRef.current) {
						reader.cancel().catch(() => {});
						return;
					}
					const match = buffer.match(/\r?\n\r?\n/);
					if (!match) break;

					const sep = match.index!;
					const sepLen = match[0].length;
					const raw = buffer.slice(0, sep);
					buffer = buffer.slice(sep + sepLen);
					processBlock(raw);
				}
			}

			if (currentGeneration !== searchGenerationRef.current) return;

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
				if (currentGeneration !== searchGenerationRef.current) return;
				await fetchMessagesForConversation(finalId);
				if (currentGeneration !== searchGenerationRef.current) return;
				void refreshBilling();
			}

			if (currentGeneration === searchGenerationRef.current) {
				setStreamingUserQuery(null);
				setStreamingAssistantMarkdown(null);
				setStreamingCitations([]);
			}
		} catch (e: unknown) {
			if (currentGeneration !== searchGenerationRef.current) {
				return;
			}
			if (e instanceof DOMException && e.name === "AbortError") {
				// A client-side abort (user pressed Stop).
				setPhase("idle");
				setErrorMessage(null);
				setErrorCode(null);
				if (streamedAnswer.trim().length === 0) {
					setStreamingUserQuery(null);
					setStreamingAssistantMarkdown(null);
					setStreamingCitations([]);
				}
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
			setErrorCode(
				/network|fetch|Failed to fetch/i.test(raw) ? "NETWORK_ERROR" : "UNKNOWN_ERROR",
			);
			setErrorMessage(msg);
			setQuery(q);
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
		phase,
	]);


	const isProviderAvailabilityError = errorCode?.startsWith("UPSTREAM_") ?? false;
	const currentErrorTitle = searchErrorTitle(errorCode, limitErrorAction, isAuthed);

	const composerBlock = (
		<div className="flex flex-col gap-2.5">
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
				<p className="text-center text-xs text-amber-400/90">
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
				onSubmit={(ctx) => void runSearch(ctx)}
				disabled={false}
				isBusy={busy}
				onCancel={handleStop}
				placeholder={
					!isAuthed
						? "Ask anything or delegate an autonomous mission..."
						: messages.length > 0
							? "Send a follow-up…"
							: "Ask anything or delegate an autonomous mission..."
				}
			/>

			{phase === "error" && errorMessage ? (
				<div
					className={cn(
						"rounded-2xl border p-4 text-sm shadow-panel backdrop-blur-md",
						errorCode === "ANONYMOUS_QUOTA_EXCEEDED"
							? "border-indigo-400/30 bg-indigo-950/40 text-indigo-200"
							: isProviderAvailabilityError
								? "border-amber-400/30 bg-amber-950/40 text-amber-200"
								: "border-red-400/30 bg-red-950/40 text-red-200",
					)}
					role="alert"
				>
					<p
						className={cn(
							"font-semibold",
							errorCode === "ANONYMOUS_QUOTA_EXCEEDED"
								? "text-indigo-200"
								: isProviderAvailabilityError
									? "text-amber-200"
									: "text-red-200",
						)}
					>
						{currentErrorTitle}
					</p>
					{errorCode === "ANONYMOUS_QUOTA_EXCEEDED" ? (
						<div className="mt-2 space-y-3">
							<p className="text-indigo-200/90">
								You’ve used your free searches for today. Sign in to continue this research.
							</p>
							<ul className="space-y-1.5 text-indigo-200/80">
								<li className="flex items-center gap-2">
									<div className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
									<span>Save this thread</span>
								</li>
								<li className="flex items-center gap-2">
									<div className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
									<span>Ask follow-up questions</span>
								</li>
								<li className="flex items-center gap-2">
									<div className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
									<span>Unlock Deep Research</span>
								</li>
							</ul>
						</div>
					) : (
						<p
							className={cn(
								"mt-1",
								isProviderAvailabilityError ? "text-amber-200/95" : "text-red-200/95",
							)}
						>
							{errorMessage}
						</p>
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
							className={cn(
								"inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
								isProviderAvailabilityError
									? "border-amber-500/30 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 focus-visible:outline-amber-400"
									: "border-red-500/30 bg-red-500/20 text-red-200 hover:bg-red-500/30 focus-visible:outline-red-400",
							)}
							>
								<RotateCw className="mr-2 size-4" />
								Retry Search
							</button>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);

	return (
		<div className={cn("relative min-h-dvh w-full overflow-hidden", className)}>
			<div className="relative z-10 mx-auto flex min-h-dvh max-w-[1440px] flex-col md:flex-row">
				{isAuthed && desktopSidebarOpen ? (
					<div className="hidden w-[300px] shrink-0 md:block md:py-3 md:pl-3 animate-in fade-in slide-in-from-left-2 duration-200">
						<ConversationSidebar
							conversations={conversations}
							selectedConversationId={selectedConversationId}
							onSelectConversation={onSelectConversation}
							onCreateConversation={onCreateConversation}
							disabled={busy}
						/>
					</div>
				) : null}

				<main className="flex min-h-dvh flex-1 flex-col md:py-2 md:px-4">
					{showConversationEmpty ? (
						<header className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-2 transition-all duration-300">
							{billing && sessionStatus === "authenticated" && (billing.searchesRemaining <= 10 || billing.searchesRemaining === 0) ? (
								<div
									className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-500/20 bg-amber-50/60 px-4 py-2 text-xs shadow-xs text-amber-900"
									aria-label="Plan and usage warning"
								>
									<span className="font-semibold">
										{planDisplayName(billing.billingPlan)} plan
									</span>
									<span className="text-amber-800/80">
										<span className="tabular-nums font-semibold">{billing.searchesRemaining}</span>
										{" / "}
										<span className="tabular-nums">{billing.monthlySearchLimit}</span>
										<span> searches remaining</span>
									</span>
									{billing.billingPlan === "FREE" ? (
										<Link
											href="/upgrade"
											className="ml-auto inline-flex items-center rounded-lg bg-[#09090B] px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-[#18181B]"
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
												className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--aira-border-subtle)] bg-white px-2.5 text-[var(--aira-text-2)] shadow-sm md:hidden hover:border-[#09090B]/30 hover:text-[var(--aira-text-0)] transition"
												aria-label="Open conversation list"
											>
												<History className="size-3.5 text-[#09090B]" />
												<span className="text-[11px] font-medium">Chats</span>
											</button>
											<button
												type="button"
												onClick={() => setDesktopSidebarOpen((open) => !open)}
												className="hidden md:flex h-8 items-center gap-1.5 rounded-lg border border-[var(--aira-border-subtle)] bg-white px-2.5 text-[var(--aira-text-2)] shadow-sm hover:border-[#09090B]/30 hover:text-[var(--aira-text-0)] transition"
												aria-label={desktopSidebarOpen ? "Hide conversation history" : "Open conversation history"}
												title={desktopSidebarOpen ? "Hide history (⌘H)" : "Show history (⌘H)"}
											>
												<History className="size-3.5 text-[#09090B]" />
												<span className="text-[11px] font-medium">{desktopSidebarOpen ? "Hide History" : "History"}</span>
											</button>
										</>
									) : null}
								</div>
								<div className="flex shrink-0 items-center gap-2">
									{FEEDBACK_MAILTO_HREF ? (
										<a
											href={FEEDBACK_MAILTO_HREF}
											onClick={() =>
												logProductEvent({ event: "feedback_clicked", surface: "header" })
											}
											className="text-xs font-medium text-[var(--aira-text-3)] underline-offset-2 hover:text-[var(--aira-text-0)] hover:underline"
										>
											Feedback
										</a>
									) : null}
								</div>
							</div>
						</header>
					) : null}

					<div className="mx-auto flex w-full max-w-5xl xl:max-w-6xl flex-1 flex-col gap-6 px-4 pb-8 md:px-6 transition-all duration-300">
						{isAuthed && showConversationEmpty ? (
							<ResearchHistoryPanel items={researchHistory} onSelectItem={onSelectConversation} />
						) : null}

						{showConversationPanel ? <div
							className={cn(
								"flex min-h-0 flex-1 flex-col",
								!showConversationEmpty && "overflow-hidden",
								showConversationEmpty
									? "border-0 bg-transparent shadow-none order-4 md:order-none"
									: "rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-sm order-1 md:order-none"
							)}
							aria-busy={busy}
						>
							<div ref={scrollContainerRef} onScroll={handleScroll} className={cn("min-h-0 flex-1 relative", !showConversationEmpty && "overflow-y-auto")}>
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
									composerSlot={showConversationEmpty ? composerBlock : undefined}
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
									elapsedMs={elapsedMs}
									onCancel={handleStop}
									desktopSourcesOpen={desktopSourcesOpen}
									onToggleDesktopSources={() => setDesktopSourcesOpen((o) => !o)}
									onOpenMobileSources={() => setMobileSourcesOpen(true)}
								/>
								{showScrollBottom ? (
									<button
										type="button"
										onClick={scrollToBottom}
										className="fixed bottom-24 right-6 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/95 text-zinc-700 shadow-lg backdrop-blur-md transition-all hover:bg-zinc-100 hover:text-zinc-950 hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black md:bottom-28 md:right-10"
										aria-label="Scroll to latest message"
										title="Scroll to bottom"
									>
										<ArrowDown className="size-4" />
									</button>
								) : null}
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
						</div> : null}

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
												: isProviderAvailabilityError
													? "Search provider temporarily unavailable."
												: errorCode === "SIGNIN_DEEP" ||
												  (errorCode === "PLAN_REQUIRED" && !isAuthed) ||
												  errorCode === "SIGNIN_FOLLOWUP"
													? "Account required."
													: "An error occurred."
											: ""}
						</p>

						{!showConversationEmpty ? (
							<div className="order-2 md:order-none sticky bottom-0 z-20 w-full max-w-full bg-surface/95 px-2 pb-4 pt-2 border-t border-border-subtle/60 backdrop-blur-md md:relative md:bottom-auto md:z-auto md:mx-0 md:bg-transparent md:p-0 md:border-none md:backdrop-blur-none">
								{composerBlock}
							</div>
						) : null}
					</div>

					<footer className="mt-auto flex flex-col items-center gap-2 border-t border-border-subtle/70 py-6 text-center text-xs text-content-tertiary">
						<p>Responses are generated from retrieved sources. Verify critical facts independently.</p>
						<p>Built for fast, reliable research with sources.</p>
						{FEEDBACK_MAILTO_HREF ? (
							<a
								href={FEEDBACK_MAILTO_HREF}
								onClick={() =>
									logProductEvent({ event: "feedback_clicked", surface: "footer" })
								}
								className="mt-2 inline-flex h-8 items-center justify-center rounded-xl bg-surface-elevated/90 px-4 font-medium text-content-primary shadow-panel ring-1 ring-border-subtle/80 backdrop-blur-sm transition hover:bg-surface-elevated hover:text-accent focus-visible:outline-accent md:backdrop-blur-md"
							>
								Send feedback
							</a>
						) : null}
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

			{mobileSourcesOpen ? (
				<div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label="Research sources">
					<div
						className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
						onClick={() => setMobileSourcesOpen(false)}
					/>
					<div className="relative ml-auto flex h-full w-full max-w-sm flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200">
						<div className="flex h-14 items-center justify-between border-b border-black/[0.08] px-4">
							<div className="flex items-center gap-2">
								<span className="font-semibold text-zinc-900 text-sm">Sources & References</span>
								<span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
									{activeCitations.length}
								</span>
							</div>
							<button
								type="button"
								onClick={() => setMobileSourcesOpen(false)}
								className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 active:scale-95 transition"
								aria-label="Close sources sheet"
							>
								<X className="size-5" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-4 space-y-2.5">
							{activeCitations.length === 0 ? (
								<div className="py-8 text-center text-xs text-zinc-400">
									No sources retrieved yet for this conversation.
								</div>
							) : (
								activeCitations.map((citation, idx) => (
									<a
										key={citation.url ?? idx}
										href={citation.url}
										target="_blank"
										rel="noopener noreferrer"
										className="group flex flex-col gap-1 rounded-xl border border-black/[0.08] bg-zinc-50/50 p-3 hover:bg-zinc-100/70 hover:border-black/15 transition"
									>
										<div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
											<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-zinc-700 shadow-2xs border border-black/5">
												{citation.index ?? idx + 1}
											</span>
											<span className="truncate group-hover:underline">
												{citation.title || "External Source"}
											</span>
										</div>
										{citation.excerpt ? (
											<p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-500 pl-7">
												{citation.excerpt}
											</p>
										) : null}
										<div className="flex items-center gap-1 text-[10px] text-zinc-400 pl-7">
											<span className="truncate">{citation.url ? new URL(citation.url).hostname : ""}</span>
										</div>
									</a>
								))
							)}
						</div>
					</div>
				</div>
			) : null}

			<AiraDeliverablesCanvas
				isOpen={canvasOpen}
				onClose={() => setCanvasOpen(false)}
				title={query || (messages[0]?.content ?? "AIRA Intelligence Dossier")}
				content={streamingAssistantMarkdown || (messages.filter((m) => m.role === "ASSISTANT").pop()?.content ?? "")}
				citations={streamingCitations.length > 0 ? streamingCitations : (messages.filter((m) => m.role === "ASSISTANT").pop()?.citations as readonly CitationItem[] ?? [])}
				isBusy={busy}
			/>
		</div>
	);
}
