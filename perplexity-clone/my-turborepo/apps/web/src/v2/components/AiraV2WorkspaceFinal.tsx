"use client";

import {
  Archive,
  ArrowUp,
  Bot,
  Brain,
  ChevronRight,
  GitBranch,
  Globe2,
  History,
  Library,
  Loader2,
  Menu,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings2,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MobileContextSheet } from "@/src/v2/components/MobileContextSheet";
import { ShareAnswerButton } from "@/src/v2/components/ShareAnswerButton";
import { AgentRuntimeStatusStrip } from "@/src/v2/components/modules/AgentRuntimeStatusStrip";
import { AgentWorkspacePanel } from "@/src/v2/components/modules/AgentWorkspacePanel";
import { LibraryWorkspacePanel } from "@/src/v2/components/modules/LibraryWorkspacePanel";
import { MemoryWorkspacePanel } from "@/src/v2/components/modules/MemoryWorkspacePanel";
import { ResearchHistoryPanel } from "@/src/v2/components/modules/ResearchHistoryPanel";
import { SettingsWorkspacePanel } from "@/src/v2/components/modules/SettingsWorkspacePanel";
import { getBillingStatus, type BillingStatus } from "@/src/v2/compat/account-api";
import {
  AiraCompatibilityError,
  getAgentDashboard,
  getConversationMessages,
  listConversations,
  listResearchHistory,
  streamSearch,
  type AgentDashboard,
  type Citation,
  type ConversationMessage,
  type ConversationSummary,
  type ResearchHistoryRow,
  type ResearchMode,
} from "@/src/v2/compat/aira-api";
import {
  DEFAULT_V2_PREFERENCES,
  V2_RESEARCH_PRESETS,
  loadV2WorkspacePreferences,
  researchPreset,
  saveV2WorkspacePreferences,
  type ResearchPresetId,
  type V2WorkspacePreferences,
} from "@/src/v2/research-config";

type WorkspaceView = "home" | "research" | "agents" | "library" | "memory" | "settings";

type SearchPhase = "idle" | "searching" | "streaming" | "error";

const STARTERS = [
  {
    label: "Research a market",
    prompt: "Research the Indian enterprise AI market and identify the strongest opportunities for a new AI services company.",
  },
  {
    label: "Compare competitors",
    prompt: "Compare OpenAI, Anthropic, Google, and Perplexity for enterprise research workflows.",
  },
  {
    label: "Build a strategy",
    prompt: "Create a practical 90-day go-to-market strategy for an AI automation company in India.",
  },
] as const;

function AiraMark() {
  return (
    <span className="v2-logo-mark" aria-hidden>
      <svg viewBox="0 0 100 100" fill="none">
        <path
          d="M18 82 50 18 82 82M30 60h40"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function formatRelative(iso: string): string {
  const value = new Date(iso).getTime();
  if (!Number.isFinite(value)) return "";
  const hours = Math.floor((Date.now() - value) / 3_600_000);
  if (hours < 1) return "now";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}

function isCitationArray(value: unknown): value is readonly Citation[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return typeof record.index === "number" && typeof record.title === "string" && typeof record.url === "string";
  });
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim() || "A";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "A";
}

function errorCopy(error: unknown): { readonly title: string; readonly message: string } {
  if (error instanceof AiraCompatibilityError) {
    if (error.code === "ANONYMOUS_QUOTA_EXCEEDED") {
      return { title: "Guest search limit reached", message: error.message };
    }
    if (error.code === "PLAN_REQUIRED" || error.status === 402) {
      return { title: "Plan upgrade required", message: error.message };
    }
    if (error.code === "CAPACITY_BUSY") {
      return { title: "AIRA is at safe capacity", message: error.message };
    }
    if (error.code?.startsWith("UPSTREAM_")) {
      return { title: "Research provider unavailable", message: error.message };
    }
    return { title: "Request could not be completed", message: error.message };
  }
  return {
    title: "Request could not be completed",
    message: error instanceof Error ? error.message : "AIRA could not complete the request.",
  };
}

function MarkdownMessage({ content, citations }: { readonly content: string; readonly citations: readonly Citation[] }) {
  return (
    <div className="v2-answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {citations.length > 0 ? (
        <div className="v2-inline-sources" aria-label="Answer sources">
          {citations.slice(0, 8).map((citation) => (
            <a key={`${citation.index}-${citation.url}`} href={citation.url} target="_blank" rel="noreferrer" title={citation.title}>
              {citation.index}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContextContent({
  citations,
  history,
  selectedConversationId,
  onSelectConversation,
  presetId,
  mode,
  messageCount,
  branchParentId,
}: {
  readonly citations: readonly Citation[];
  readonly history: readonly ResearchHistoryRow[];
  readonly selectedConversationId: string | null;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly presetId: ResearchPresetId;
  readonly mode: ResearchMode;
  readonly messageCount: number;
  readonly branchParentId: string | null;
}) {
  const preset = researchPreset(presetId);
  return (
    <div className="v2-context-content">
      <section className="v2-context-section" aria-labelledby="v2-context-sources-title">
        <div className="v2-context-section-head">
          <div><Globe2 aria-hidden /><strong id="v2-context-sources-title">Sources</strong></div>
          <span>{citations.length}</span>
        </div>
        {citations.length === 0 ? (
          <p className="v2-context-empty">Sources appear here while AIRA researches.</p>
        ) : (
          <div className="v2-source-list">
            {citations.slice(0, 12).map((citation) => (
              <a key={`${citation.index}:${citation.url}`} href={citation.url} target="_blank" rel="noreferrer">
                <span>{citation.index}</span>
                <div><strong>{citation.title}</strong><small>{sourceDomain(citation.url)}</small></div>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="v2-context-section" aria-labelledby="v2-context-thread-title">
        <div className="v2-context-section-head">
          <div><MessageSquare aria-hidden /><strong id="v2-context-thread-title">Thread context</strong></div>
        </div>
        <dl className="v2-context-facts">
          <div><dt>Preset</dt><dd>{preset.label}</dd></div>
          <div><dt>Depth</dt><dd>{mode === "deep" ? "Deep Research" : "Standard"}</dd></div>
          <div><dt>Messages</dt><dd>{messageCount}</dd></div>
          <div><dt>Branch</dt><dd>{branchParentId ? "Earlier answer" : "Latest answer"}</dd></div>
        </dl>
        <p className="v2-context-preset-copy">{preset.description}</p>
      </section>

      <ResearchHistoryPanel rows={history} selectedConversationId={selectedConversationId} onSelectConversation={onSelectConversation} />
    </div>
  );
}

export function AiraV2WorkspaceFinal() {
  const { data: session, status: sessionStatus } = useSession();
  const authenticated = sessionStatus === "authenticated";
  const [view, setView] = useState<WorkspaceView>("home");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ResearchMode>(DEFAULT_V2_PREFERENCES.defaultMode);
  const [presetId, setPresetId] = useState<ResearchPresetId>(DEFAULT_V2_PREFERENCES.defaultPreset);
  const [preferences, setPreferences] = useState<V2WorkspacePreferences>(DEFAULT_V2_PREFERENCES);
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([]);
  const [researchHistory, setResearchHistory] = useState<readonly ResearchHistoryRow[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([]);
  const [branchParentId, setBranchParentId] = useState<string | null>(null);
  const [streamingUser, setStreamingUser] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<readonly Citation[]>([]);
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [error, setError] = useState<{ readonly title: string; readonly message: string } | null>(null);
  const [agents, setAgents] = useState<AgentDashboard | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [agentRefreshing, setAgentRefreshing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(DEFAULT_V2_PREFERENCES.contextPanelOpen);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const busy = phase === "searching" || phase === "streaming";
  const latestAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === "ASSISTANT") ?? null,
    [messages],
  );
  const effectiveParentMessageId = branchParentId ?? latestAssistant?.id ?? null;

  const activeCitations = useMemo(() => {
    if (streamingCitations.length > 0) return streamingCitations;
    if (!latestAssistant || !isCitationArray(latestAssistant.citations)) return [];
    return latestAssistant.citations;
  }, [latestAssistant, streamingCitations]);

  useEffect(() => {
    const next = loadV2WorkspacePreferences();
    setPreferences(next);
    setMode(next.defaultMode);
    setPresetId(next.defaultPreset);
    setContextOpen(next.contextPanelOpen);
  }, []);

  const applyPreferences = useCallback((next: V2WorkspacePreferences) => {
    setPreferences(next);
    setContextOpen(next.contextPanelOpen);
    saveV2WorkspacePreferences(next);
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!authenticated) {
      setConversations([]);
      return;
    }
    try {
      setConversations(await listConversations());
    } catch {
      // History is non-critical to live research.
    }
  }, [authenticated]);

  const refreshResearchHistory = useCallback(async () => {
    if (!authenticated) {
      setResearchHistory([]);
      return;
    }
    try {
      setResearchHistory(await listResearchHistory(50));
    } catch {
      setResearchHistory([]);
    }
  }, [authenticated]);

  const refreshAgents = useCallback(async () => {
    if (!authenticated) {
      setAgents(null);
      return;
    }
    setAgentRefreshing(true);
    try {
      setAgents(await getAgentDashboard(50));
    } catch {
      setAgents(null);
    } finally {
      setAgentRefreshing(false);
    }
  }, [authenticated]);

  const refreshBilling = useCallback(async () => {
    if (!authenticated) {
      setBilling(null);
      return;
    }
    try {
      setBilling(await getBillingStatus());
    } catch {
      setBilling(null);
    }
  }, [authenticated]);

  useEffect(() => {
    void Promise.all([
      refreshConversations(),
      refreshResearchHistory(),
      refreshAgents(),
      refreshBilling(),
    ]);
  }, [refreshAgents, refreshBilling, refreshConversations, refreshResearchHistory]);

  useEffect(() => {
    if (view !== "research" && view !== "home") return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: preferences.reduceMotion ? "auto" : "smooth" });
  }, [messages, phase, preferences.reduceMotion, streamingAnswer, streamingUser, view]);

  const selectConversation = useCallback(async (id: string) => {
    if (busy) return;
    setConversationId(id);
    setView("research");
    setSidebarOpen(false);
    setMobileContextOpen(false);
    setBranchParentId(null);
    setError(null);
    try {
      setMessages(await getConversationMessages(id));
      setStreamingCitations([]);
    } catch (loadError) {
      setError(errorCopy(loadError));
    }
  }, [busy]);

  const newTask = useCallback(() => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setBranchParentId(null);
    setStreamingUser(null);
    setStreamingAnswer("");
    setStreamingCitations([]);
    setError(null);
    setPhase("idle");
    setQuery("");
    setMode(preferences.defaultMode);
    setPresetId(preferences.defaultPreset);
    setView("home");
    setSidebarOpen(false);
    setMobileContextOpen(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [preferences.defaultMode, preferences.defaultPreset]);

  const submit = useCallback(async (forcedQuery?: string) => {
    const objective = (forcedQuery ?? query).trim();
    if (!objective || busy || sessionStatus === "loading") return;

    if (!authenticated && mode === "deep") {
      setError({
        title: "Sign in for Deep Research",
        message: "Deep Research and saved follow-up threads require an AIRA account.",
      });
      setView("research");
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setQuery("");
    setError(null);
    setStreamingUser(objective);
    setStreamingAnswer("");
    setStreamingCitations([]);
    setPhase("searching");
    setView("research");

    let answerText = "";
    let finalCitations: readonly Citation[] = [];
    let completedConversationId: string | null = null;
    let streamFailure: string | null = null;

    try {
      await streamSearch(
        {
          query: objective,
          mode,
          presetId,
          ...(authenticated && conversationId ? { conversationId } : {}),
          ...(authenticated && effectiveParentMessageId ? { parentMessageId: effectiveParentMessageId, continueResearch: true } : {}),
        },
        {
          onMetadata: (payload) => {
            finalCitations = payload.citations ?? [];
            setStreamingCitations(finalCitations);
            setPhase("streaming");
          },
          onText: (payload) => {
            if (!payload.delta) return;
            answerText += payload.delta;
            setPhase("streaming");
            setStreamingAnswer((current) => current + payload.delta);
          },
          onDone: (payload) => {
            if (payload.conversationId) {
              completedConversationId = payload.conversationId;
              setConversationId(payload.conversationId);
            }
          },
          onStreamError: (payload) => {
            streamFailure = payload.message ?? "AIRA could not complete the research stream.";
          },
        },
        controller.signal,
      );

      if (streamFailure && answerText.trim().length === 0) throw new Error(streamFailure);

      const resolvedConversationId = completedConversationId ?? conversationId;
      if (authenticated && resolvedConversationId) {
        const refreshed = await getConversationMessages(resolvedConversationId).catch(() => null);
        if (refreshed) setMessages(refreshed);
      } else if (!authenticated && answerText.trim()) {
        const createdAt = new Date().toISOString();
        setMessages([
          {
            id: `guest-user-${Date.now()}`,
            role: "USER",
            content: objective,
            parentMessageId: null,
            citations: null,
            createdAt,
          },
          {
            id: `guest-assistant-${Date.now()}`,
            role: "ASSISTANT",
            content: answerText,
            parentMessageId: null,
            citations: finalCitations,
            createdAt,
          },
        ]);
      }

      setBranchParentId(null);
      setStreamingUser(null);
      setStreamingAnswer("");
      setStreamingCitations([]);
      setPhase(streamFailure ? "error" : "idle");
      if (streamFailure) setError({ title: "Research stream interrupted", message: streamFailure });
      await Promise.all([refreshConversations(), refreshResearchHistory(), refreshBilling()]);
    } catch (submitError) {
      if (controller.signal.aborted) {
        setPhase("idle");
        setStreamingUser(null);
        setStreamingAnswer("");
        setStreamingCitations([]);
        return;
      }
      setError(errorCopy(submitError));
      setPhase("error");
      setStreamingUser(null);
      setStreamingAnswer("");
      setStreamingCitations([]);
      await refreshBilling();
    } finally {
      abortRef.current = null;
    }
  }, [authenticated, busy, conversationId, effectiveParentMessageId, mode, presetId, query, refreshBilling, refreshConversations, refreshResearchHistory, sessionStatus]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const branchFrom = useCallback((messageId: string) => {
    if (!authenticated || busy) return;
    setBranchParentId(messageId);
    setView("research");
    setError(null);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [authenticated, busy]);

  const switchView = useCallback((next: WorkspaceView) => {
    setView(next);
    setSidebarOpen(false);
    setMobileContextOpen(false);
    if (next === "agents" || next === "library") void refreshAgents();
    if (next === "research") void refreshResearchHistory();
  }, [refreshAgents, refreshResearchHistory]);

  const accountLabel = session?.user?.name?.trim() || session?.user?.email?.trim() || "Account";
  const contextContent = (
    <ContextContent
      citations={activeCitations}
      history={researchHistory}
      selectedConversationId={conversationId}
      onSelectConversation={(id) => void selectConversation(id)}
      presetId={presetId}
      mode={mode}
      messageCount={messages.length + (streamingUser ? 1 : 0)}
      branchParentId={branchParentId}
    />
  );

  return (
    <div className="aira-v2 v2-final" data-reduce-motion={preferences.reduceMotion ? "true" : "false"} data-context-open={contextOpen ? "true" : "false"}>
      <a className="v2-skip-link" href="#v2-main-content">Skip to main content</a>
      <header className="v2-topbar">
        <button className="v2-icon-button v2-mobile-only" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open workspace navigation">
          <Menu aria-hidden />
        </button>
        <Link href="/v2" className="v2-brand" aria-label="AIRA V2 home" onClick={() => newTask()}>
          <AiraMark />
          <span>AIRA</span>
          <span className="v2-preview-badge">V2 ACCEPTANCE</span>
        </Link>
        <div className="v2-topbar-center" aria-hidden>
          <Search />
          <span>Research · agents · memory · versioned artifacts</span>
        </div>
        <div className="v2-topbar-actions">
          {(view === "home" || view === "research") ? (
            <button className="v2-context-toggle v2-desktop-context-toggle" type="button" onClick={() => {
              const next = !contextOpen;
              setContextOpen(next);
              applyPreferences({ ...preferences, contextPanelOpen: next });
            }} aria-label={contextOpen ? "Hide context panel" : "Show context panel"}>
              {contextOpen ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}
            </button>
          ) : null}
          {authenticated && billing ? (
            <button type="button" className="v2-usage-pill" onClick={() => switchView("settings")} title="Open plan and usage settings">
              <span>{billing.billingPlan}</span><strong>{billing.searchesRemaining}</strong><small>searches</small>
            </button>
          ) : null}
          {authenticated ? (
            <button type="button" className="v2-account-chip" title={accountLabel} onClick={() => switchView("settings")}>
              <span>{initials(session?.user?.name, session?.user?.email)}</span>
              <div><strong>{accountLabel}</strong><small>Settings</small></div>
            </button>
          ) : sessionStatus === "unauthenticated" ? (
            <Link href={`/signin?callbackUrl=${encodeURIComponent("/v2")}`} className="v2-signin-link">Sign in</Link>
          ) : (
            <span className="v2-account-loading"><Loader2 className="spin" aria-hidden /></span>
          )}
          <Link href="/" className="v2-legacy-link">Current AIRA</Link>
        </div>
      </header>

      <div className="v2-frame">
        <aside className={`v2-sidebar ${sidebarOpen ? "open" : ""}`} aria-label="Workspace navigation">
          <div className="v2-sidebar-mobile-head">
            <span>Workspace</span>
            <button type="button" className="v2-icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X aria-hidden /></button>
          </div>

          <button className="v2-new-task" type="button" onClick={newTask}>
            <Sparkles aria-hidden /> New task <span>+</span>
          </button>

          <nav className="v2-primary-nav" aria-label="AIRA V2 sections">
            {([
              ["home", "Home", MessageSquare],
              ["research", "Research", Globe2],
              ["agents", "Agents", Bot],
              ["library", "Library", Library],
              ["memory", "Memory", Brain],
              ["settings", "Settings", Settings2],
            ] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" data-active={view === id ? "true" : "false"} onClick={() => switchView(id)} aria-current={view === id ? "page" : undefined}>
                <Icon aria-hidden /><span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="v2-recents">
            <div className="v2-section-label"><span>Recent</span><Archive aria-hidden /></div>
            {!authenticated ? (
              <p className="v2-muted-copy">Sign in to sync conversations, memory, agents, and sharing.</p>
            ) : conversations.length === 0 ? (
              <p className="v2-muted-copy">Your saved work will appear here.</p>
            ) : (
              conversations.slice(0, 14).map((conversation) => (
                <button key={conversation.id} type="button" data-active={conversationId === conversation.id ? "true" : "false"} onClick={() => void selectConversation(conversation.id)} disabled={busy}>
                  <span>{conversation.title}</span><time>{formatRelative(conversation.lastMessageAt)}</time>
                </button>
              ))
            )}
          </div>

          <div className="v2-sidebar-footer"><span className="v2-status-light" aria-hidden /> Existing backend compatibility layer</div>
        </aside>

        {sidebarOpen ? <button type="button" className="v2-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" /> : null}

        <main className="v2-main" id="v2-main-content" tabIndex={-1}>
          <div className="v2-main-scroll" ref={scrollRef}>
            {view === "home" && messages.length === 0 && !streamingUser ? (
              <section className="v2-home" aria-labelledby="v2-home-title">
                <div className="v2-home-mark"><AiraMark /></div>
                <p className="v2-eyebrow">AI WORKSPACE</p>
                <h1 id="v2-home-title">What do you want AIRA to accomplish?</h1>
                <p className="v2-home-subtitle">Research, reason, build, and act from one workspace. V2 uses the existing AIRA backend for auth, safety, quota, memory, search, and agent execution.</p>
                <div className="v2-starter-grid">
                  {STARTERS.map((starter) => (
                    <button key={starter.label} type="button" onClick={() => void submit(starter.prompt)}>
                      <span>{starter.label}</span><ChevronRight aria-hidden />
                    </button>
                  ))}
                </div>
                {authenticated && researchHistory.length > 0 ? (
                  <div className="v2-home-history">
                    <span><History aria-hidden /> Continue recent research</span>
                    <div>{researchHistory.slice(0, 3).map((row) => row.conversationId ? <button key={row.id} type="button" onClick={() => void selectConversation(row.conversationId!)}>{row.query}</button> : null)}</div>
                  </div>
                ) : null}
              </section>
            ) : view === "agents" ? (
              <div className="v2-module-stack">
                <AgentRuntimeStatusStrip dashboard={agents} />
                <AgentWorkspacePanel authenticated={authenticated} dashboard={agents} onDashboardChange={setAgents} />
              </div>
            ) : view === "library" ? (
              <LibraryWorkspacePanel authenticated={authenticated} dashboard={agents} refreshing={agentRefreshing} onRefresh={() => void refreshAgents()} />
            ) : view === "memory" ? (
              <MemoryWorkspacePanel authenticated={authenticated} />
            ) : view === "settings" ? (
              <SettingsWorkspacePanel authenticated={authenticated} user={session?.user ?? null} billing={billing} preferences={preferences} onPreferencesChange={applyPreferences} />
            ) : (
              <section className="v2-thread" aria-label="Research conversation">
                {messages.length === 0 && !streamingUser ? (
                  <div className="v2-thread-empty"><Globe2 aria-hidden /><h1>Research workspace</h1><p>Choose a preset and ask a question. Signed-in follow-ups can continue the latest answer or branch from an earlier answer.</p></div>
                ) : null}

                {messages.map((message) => message.role === "USER" ? (
                  <div key={message.id} className="v2-user-message"><div>{message.content}</div></div>
                ) : (
                  <article key={message.id} className="v2-assistant-message" data-branch-source={branchParentId === message.id ? "true" : "false"}>
                    <div className="v2-assistant-avatar" aria-hidden>A</div>
                    <div className="v2-assistant-body">
                      <div className="v2-message-meta"><span>AIRA</span>{branchParentId === message.id ? <span className="v2-branch-source-label"><GitBranch aria-hidden /> branch source</span> : null}</div>
                      <MarkdownMessage content={message.content} citations={isCitationArray(message.citations) ? message.citations : []} />
                      <div className="v2-message-actions">
                        {authenticated && conversationId ? <ShareAnswerButton conversationId={conversationId} messageId={message.id} /> : null}
                        {authenticated ? (
                          <button type="button" data-active={branchParentId === message.id ? "true" : "false"} onClick={() => branchFrom(message.id)} disabled={busy}>
                            <GitBranch aria-hidden /> {branchParentId === message.id ? "Branch selected" : "Branch from here"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}

                {streamingUser ? <div className="v2-user-message"><div>{streamingUser}</div></div> : null}
                {(streamingAnswer || busy) ? (
                  <article className="v2-assistant-message" aria-live="polite" aria-busy={busy}>
                    <div className="v2-assistant-avatar" aria-hidden>A</div>
                    <div className="v2-assistant-body">
                      <div className="v2-message-meta"><span>AIRA</span>{busy ? <span className="v2-live-state"><Loader2 aria-hidden />{streamingAnswer ? "Writing" : "Researching"}</span> : null}</div>
                      {streamingAnswer ? <MarkdownMessage content={streamingAnswer} citations={streamingCitations} /> : <div className="v2-answer-skeleton"><span /><span /><span /></div>}
                    </div>
                  </article>
                ) : null}

                {error ? <div className="v2-error" role="alert"><strong>{error.title}</strong><span>{error.message}</span></div> : null}
              </section>
            )}
          </div>

          {(view === "home" || view === "research") ? (
            <div className="v2-composer-wrap">
              {branchParentId ? (
                <div className="v2-branch-banner"><GitBranch aria-hidden /><span>Next follow-up will branch from the selected earlier answer.</span><button type="button" onClick={() => setBranchParentId(null)}>Use latest instead</button></div>
              ) : null}
              <div className="v2-research-controls">
                <label>
                  <span className="v2-sr-only">Research preset</span>
                  <select value={presetId} onChange={(event) => setPresetId(event.target.value as ResearchPresetId)} disabled={busy}>
                    {V2_RESEARCH_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                  </select>
                </label>
                <div role="group" aria-label="Research depth">
                  <button type="button" data-active={mode === "standard"} onClick={() => setMode("standard")} disabled={busy}>Standard</button>
                  <button type="button" data-active={mode === "deep"} onClick={() => setMode("deep")} disabled={busy}>Deep</button>
                </div>
                <button className="v2-mobile-context-button" type="button" onClick={() => setMobileContextOpen(true)} aria-haspopup="dialog">
                  <PanelRightOpen aria-hidden /> Context {activeCitations.length > 0 ? `(${activeCitations.length})` : ""}
                </button>
              </div>
              <div className="v2-composer">
                <textarea
                  ref={composerRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder={branchParentId ? "Ask a follow-up from the selected answer…" : effectiveParentMessageId ? "Ask a follow-up…" : "Ask AIRA to research, compare, explain, or decide…"}
                  rows={1}
                  maxLength={16000}
                  disabled={busy}
                  aria-label="Message AIRA"
                />
                <div className="v2-composer-foot">
                  <span><Zap aria-hidden /> {researchPreset(presetId).label} · {mode === "deep" ? "Deep Research" : "Standard"}</span>
                  {busy ? (
                    <button type="button" className="v2-stop-button" onClick={stop} aria-label="Stop research"><Square aria-hidden /></button>
                  ) : (
                    <button type="button" className="v2-send-button" onClick={() => void submit()} disabled={!query.trim()} aria-label="Send to AIRA"><ArrowUp aria-hidden /></button>
                  )}
                </div>
              </div>
              <p className="v2-composer-note">Enter to send · Shift+Enter for a new line · AIRA may make mistakes; verify consequential decisions.</p>
            </div>
          ) : null}
        </main>

        {(view === "home" || view === "research") && contextOpen ? (
          <aside className="v2-context" aria-label="Research context">{contextContent}</aside>
        ) : null}
      </div>

      <MobileContextSheet open={mobileContextOpen} title="Research context" onClose={() => setMobileContextOpen(false)}>{contextContent}</MobileContextSheet>
    </div>
  );
}
