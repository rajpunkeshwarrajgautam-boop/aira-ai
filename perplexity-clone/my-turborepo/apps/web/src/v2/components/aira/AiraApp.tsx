"use client";

import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  ExternalLink,
  GitBranch,
  Globe2,
  History,
  Library,
  Loader2,
  Paperclip,
  PanelRightOpen,
  Search,
  Settings2,
  Square,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MobileContextSheet } from "@/src/v2/components/MobileContextSheet";
import { ShareAnswerButton } from "@/src/v2/components/ShareAnswerButton";
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

import { AiraAnnouncementBanner } from "./AiraAnnouncementBanner";
import { AiraFooter } from "./AiraFooter";
import { AiraHeader } from "./AiraHeader";

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

const HASH_VIEWS: Readonly<Record<string, WorkspaceView>> = {
  research: "research",
  agents: "agents",
  library: "library",
  memory: "memory",
  settings: "settings",
};

function formatRelative(iso: string): string {
  const value = new Date(iso).getTime();
  if (!Number.isFinite(value)) return "";
  const minutes = Math.floor((Date.now() - value) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
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

function errorCopy(error: unknown): { readonly title: string; readonly message: string } {
  if (error instanceof AiraCompatibilityError) {
    if (error.code === "ANONYMOUS_QUOTA_EXCEEDED") return { title: "Guest search limit reached", message: error.message };
    if (error.code === "PLAN_REQUIRED" || error.status === 402) return { title: "Plan upgrade required", message: error.message };
    if (error.code === "CAPACITY_BUSY") return { title: "AIRA AI is at safe capacity", message: error.message };
    if (error.code?.startsWith("UPSTREAM_")) return { title: "Research provider unavailable", message: error.message };
    return { title: "Request could not be completed", message: error.message };
  }
  return {
    title: "Request could not be completed",
    message: error instanceof Error ? error.message : "AIRA AI could not complete the request.",
  };
}

function MarkdownMessage({ content, citations }: { readonly content: string; readonly citations: readonly Citation[] }) {
  return (
    <div className="aira-answer-copy">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}
      >
        {content}
      </ReactMarkdown>
      {citations.length > 0 ? (
        <div className="aira-inline-citations" aria-label="Answer citations">
          {citations.slice(0, 10).map((citation) => (
            <a key={`${citation.index}-${citation.url}`} href={citation.url} target="_blank" rel="noreferrer" title={citation.title}>
              {citation.index}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResearchContext({
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
    <div className="aira-context-content">
      <section className="aira-context-section">
        <div className="aira-context-heading"><Globe2 aria-hidden="true" /><strong>Sources</strong><span>{citations.length}</span></div>
        {citations.length === 0 ? (
          <p className="aira-context-empty">Sources appear here while AIRA AI researches.</p>
        ) : (
          <div className="aira-source-list">
            {citations.slice(0, 14).map((citation) => (
              <a key={`${citation.index}:${citation.url}`} href={citation.url} target="_blank" rel="noreferrer">
                <span>{citation.index}</span>
                <div><strong>{citation.title}</strong><small>{sourceDomain(citation.url)}</small></div>
                <ExternalLink aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </section>
      <section className="aira-context-section">
        <div className="aira-context-heading"><Search aria-hidden="true" /><strong>Thread context</strong></div>
        <dl className="aira-context-facts">
          <div><dt>Preset</dt><dd>{preset.label}</dd></div>
          <div><dt>Depth</dt><dd>{mode === "deep" ? "Deep Research" : "Standard"}</dd></div>
          <div><dt>Messages</dt><dd>{messageCount}</dd></div>
          <div><dt>Branch</dt><dd>{branchParentId ? "Earlier answer" : "Latest answer"}</dd></div>
        </dl>
        <p>{preset.description}</p>
      </section>
      <ResearchHistoryPanel rows={history} selectedConversationId={selectedConversationId} onSelectConversation={onSelectConversation} />
    </div>
  );
}

export function AiraApp() {
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
  const [contextOpen, setContextOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const busy = phase === "searching" || phase === "streaming";
  const latestAssistant = useMemo(() => [...messages].reverse().find((message) => message.role === "ASSISTANT") ?? null, [messages]);
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
  }, []);

  useEffect(() => {
    const syncHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const nextView = HASH_VIEWS[hash];
      if (nextView) setView(nextView);
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const applyPreferences = useCallback((next: V2WorkspacePreferences) => {
    setPreferences(next);
    saveV2WorkspacePreferences(next);
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!authenticated) return setConversations([]);
    try { setConversations(await listConversations()); } catch { setConversations([]); }
  }, [authenticated]);

  const refreshResearchHistory = useCallback(async () => {
    if (!authenticated) return setResearchHistory([]);
    try { setResearchHistory(await listResearchHistory(50)); } catch { setResearchHistory([]); }
  }, [authenticated]);

  const refreshAgents = useCallback(async () => {
    if (!authenticated) return setAgents(null);
    setAgentRefreshing(true);
    try { setAgents(await getAgentDashboard(50)); } catch { setAgents(null); }
    finally { setAgentRefreshing(false); }
  }, [authenticated]);

  const refreshBilling = useCallback(async () => {
    if (!authenticated) return setBilling(null);
    try { setBilling(await getBillingStatus()); } catch { setBilling(null); }
  }, [authenticated]);

  useEffect(() => {
    void Promise.all([refreshConversations(), refreshResearchHistory(), refreshAgents(), refreshBilling()]);
  }, [refreshAgents, refreshBilling, refreshConversations, refreshResearchHistory]);

  useEffect(() => {
    if (view !== "research") return;
    threadEndRef.current?.scrollIntoView({ behavior: preferences.reduceMotion ? "auto" : "smooth", block: "end" });
  }, [messages, preferences.reduceMotion, streamingAnswer, streamingUser, view]);

  const navigateView = useCallback((next: WorkspaceView) => {
    setView(next);
    setShowMore(false);
    if (next === "home") {
      window.history.replaceState(null, "", "/v2");
    } else {
      window.history.replaceState(null, "", `/v2#${next}`);
    }
    if (next === "agents" || next === "library") void refreshAgents();
    if (next === "research") void refreshResearchHistory();
  }, [refreshAgents, refreshResearchHistory]);

  const selectConversation = useCallback(async (id: string) => {
    if (busy) return;
    setConversationId(id);
    navigateView("research");
    setBranchParentId(null);
    setError(null);
    try {
      setMessages(await getConversationMessages(id));
      setStreamingCitations([]);
    } catch (loadError) {
      setError(errorCopy(loadError));
    }
  }, [busy, navigateView]);

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
    navigateView("home");
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [navigateView, preferences.defaultMode, preferences.defaultPreset]);

  const submit = useCallback(async (forcedQuery?: string) => {
    const objective = (forcedQuery ?? query).trim();
    if (!objective || busy || sessionStatus === "loading") return;

    if (!authenticated && mode === "deep") {
      setError({ title: "Sign in for Deep Research", message: "Deep Research and saved follow-up threads require an AIRA AI account." });
      navigateView("research");
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
    navigateView("research");

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
          onStreamError: (payload) => { streamFailure = payload.message ?? "AIRA AI could not complete the research stream."; },
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
          { id: `guest-user-${Date.now()}`, role: "USER", content: objective, parentMessageId: null, citations: null, createdAt },
          { id: `guest-assistant-${Date.now()}`, role: "ASSISTANT", content: answerText, parentMessageId: null, citations: finalCitations, createdAt },
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
  }, [authenticated, busy, conversationId, effectiveParentMessageId, mode, navigateView, presetId, query, refreshBilling, refreshConversations, refreshResearchHistory, sessionStatus]);

  const branchFrom = useCallback((messageId: string) => {
    if (!authenticated || busy) return;
    setBranchParentId(messageId);
    setError(null);
    navigateView("research");
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [authenticated, busy, navigateView]);

  const renderComposer = (compact: boolean) => (
    <div className={compact ? "aira-composer-region compact" : "aira-composer-region"} id="aira-workspace">
      {branchParentId ? (
        <div className="aira-branch-banner">
          <GitBranch aria-hidden="true" />
          <span>Next follow-up branches from the selected earlier answer.</span>
          <button type="button" onClick={() => setBranchParentId(null)}>Use latest instead</button>
        </div>
      ) : null}

      <div className="aira-composer-card">
        <button className="aira-attach-button" type="button" disabled title="File attachments are not enabled in this compatibility layer" aria-label="File attachments are not enabled">
          <Paperclip size={18} aria-hidden="true" />
        </button>
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
          placeholder={branchParentId ? "Ask a follow-up from the selected answer" : effectiveParentMessageId ? "Ask a follow-up" : "Assign a task or ask anything"}
          rows={compact ? 2 : 4}
          maxLength={16000}
          disabled={busy}
          aria-label="Message AIRA AI"
        />
        {busy ? (
          <button className="aira-submit-button active" type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop research"><Square size={15} aria-hidden="true" /></button>
        ) : (
          <button className={`aira-submit-button ${query.trim() ? "active" : ""}`} type="button" onClick={() => void submit()} disabled={!query.trim()} aria-label="Send to AIRA AI"><ArrowUp size={18} aria-hidden="true" /></button>
        )}
      </div>

      <div className="aira-action-row">
        <button type="button" data-active={mode === "deep" ? "true" : "false"} onClick={() => setMode(mode === "deep" ? "standard" : "deep")} disabled={busy}>
          <Globe2 size={18} aria-hidden="true" /> {mode === "deep" ? "Deep Research on" : "Deep Research"}
        </button>
        <button type="button" onClick={() => navigateView("agents")}><Bot size={18} aria-hidden="true" /> AIRA Agents</button>
        <button type="button" onClick={() => navigateView("library")}><Library size={18} aria-hidden="true" /> Library</button>
        <button type="button" onClick={() => navigateView("memory")}><Brain size={18} aria-hidden="true" /> Memory</button>
        <div className="aira-more-wrap">
          <button type="button" className="aira-more-button" onClick={() => setShowMore((current) => !current)}>More <ChevronDown size={16} className={showMore ? "rotate" : ""} aria-hidden="true" /></button>
          {showMore ? (
            <>
              <button className="aira-more-scrim" type="button" aria-label="Close more menu" onClick={() => setShowMore(false)} />
              <div className="aira-more-menu">
                <button type="button" onClick={() => { setContextOpen(true); setShowMore(false); }}><History size={17} aria-hidden="true" /> Research history & sources</button>
                <button type="button" onClick={() => navigateView("settings")}><Settings2 size={17} aria-hidden="true" /> Settings & usage</button>
                <a href="/pricing">Pricing</a>
                <a href="/">Current AIRA</a>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="aira-research-options">
        <label>
          <span>Preset</span>
          <select value={presetId} onChange={(event) => setPresetId(event.target.value as ResearchPresetId)} disabled={busy}>
            {V2_RESEARCH_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
        </label>
        {activeCitations.length > 0 || authenticated ? (
          <button type="button" onClick={() => setContextOpen(true)}><PanelRightOpen size={16} aria-hidden="true" /> Context{activeCitations.length ? ` (${activeCitations.length})` : ""}</button>
        ) : null}
        {authenticated && billing ? <span>{billing.searchesRemaining} searches remaining</span> : null}
      </div>
    </div>
  );

  const contextContent = (
    <ResearchContext
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
    <div className="aira-page" data-reduce-motion={preferences.reduceMotion ? "true" : "false"}>
      <a className="aira-skip-link" href="#aira-main">Skip to main content</a>
      <AiraAnnouncementBanner />
      <AiraHeader />

      <main id="aira-main" className="aira-main" tabIndex={-1}>
        {view === "home" && messages.length === 0 && !streamingUser ? (
          <section className="aira-hero" aria-labelledby="aira-home-title">
            <div className="aira-hero-inner">
              <h1 id="aira-home-title">What can I do for you?</h1>
              {renderComposer(false)}

              <div className="aira-starters" aria-label="Suggested tasks">
                {STARTERS.map((starter) => (
                  <button key={starter.label} type="button" onClick={() => void submit(starter.prompt)}>
                    <strong>{starter.label}</strong>
                    <span>{starter.prompt}</span>
                  </button>
                ))}
              </div>

              {authenticated && conversations.length > 0 ? (
                <section className="aira-recents" aria-labelledby="aira-recents-title">
                  <div className="aira-section-heading"><h2 id="aira-recents-title">Recent work</h2><span>{conversations.length}</span></div>
                  <div className="aira-recents-list">
                    {conversations.slice(0, 6).map((conversation) => (
                      <button key={conversation.id} type="button" onClick={() => void selectConversation(conversation.id)} disabled={busy}>
                        <span>{conversation.title}</span><time>{formatRelative(conversation.lastMessageAt)}</time>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </section>
        ) : view === "research" || (view === "home" && (messages.length > 0 || streamingUser)) ? (
          <section className="aira-workspace-section aira-research-view" aria-label="Research conversation">
            <div className="aira-workspace-heading">
              <div><p>RESEARCH</p><h1>{conversationId ? "Research thread" : "New research"}</h1></div>
              <div className="aira-workspace-actions">
                <button type="button" onClick={() => setContextOpen(true)}><PanelRightOpen size={16} aria-hidden="true" /> Sources & history</button>
                <button type="button" onClick={newTask}>New task</button>
              </div>
            </div>

            <div className="aira-thread">
              {messages.length === 0 && !streamingUser ? (
                <div className="aira-empty-state"><Globe2 aria-hidden="true" /><strong>Research workspace</strong><span>Choose a preset and ask a question. AIRA AI will stream a grounded answer with citations.</span></div>
              ) : null}

              {messages.map((message) => message.role === "USER" ? (
                <div key={message.id} className="aira-user-message"><div>{message.content}</div></div>
              ) : (
                <article key={message.id} className="aira-assistant-message" data-branch-source={branchParentId === message.id ? "true" : "false"}>
                  <div className="aira-assistant-mark" aria-hidden="true">A</div>
                  <div className="aira-assistant-body">
                    <div className="aira-message-meta"><span>AIRA AI</span>{branchParentId === message.id ? <small><GitBranch size={14} aria-hidden="true" /> branch source</small> : null}</div>
                    <MarkdownMessage content={message.content} citations={isCitationArray(message.citations) ? message.citations : []} />
                    <div className="aira-message-actions">
                      {authenticated && conversationId ? <ShareAnswerButton conversationId={conversationId} messageId={message.id} /> : null}
                      {authenticated ? <button type="button" data-active={branchParentId === message.id ? "true" : "false"} onClick={() => branchFrom(message.id)} disabled={busy}><GitBranch size={15} aria-hidden="true" /> {branchParentId === message.id ? "Branch selected" : "Branch from here"}</button> : null}
                    </div>
                  </div>
                </article>
              ))}

              {streamingUser ? <div className="aira-user-message"><div>{streamingUser}</div></div> : null}
              {streamingAnswer || busy ? (
                <article className="aira-assistant-message" aria-live="polite" aria-busy={busy}>
                  <div className="aira-assistant-mark" aria-hidden="true">A</div>
                  <div className="aira-assistant-body">
                    <div className="aira-message-meta"><span>AIRA AI</span>{busy ? <small><Loader2 className="spin" size={14} aria-hidden="true" /> {streamingAnswer ? "Writing" : "Researching"}</small> : null}</div>
                    {streamingAnswer ? <MarkdownMessage content={streamingAnswer} citations={streamingCitations} /> : <div className="aira-answer-skeleton"><span /><span /><span /></div>}
                  </div>
                </article>
              ) : null}

              {error ? <div className="aira-error" role="alert"><strong>{error.title}</strong><span>{error.message}</span></div> : null}
              <div ref={threadEndRef} />
            </div>

            {renderComposer(true)}
          </section>
        ) : view === "agents" ? (
          <section className="aira-workspace-section">
            <AgentWorkspacePanel authenticated={authenticated} dashboard={agents} onDashboardChange={setAgents} />
          </section>
        ) : view === "library" ? (
          <section className="aira-workspace-section">
            <LibraryWorkspacePanel authenticated={authenticated} dashboard={agents} refreshing={agentRefreshing} onRefresh={() => void refreshAgents()} />
          </section>
        ) : view === "memory" ? (
          <section className="aira-workspace-section"><MemoryWorkspacePanel authenticated={authenticated} /></section>
        ) : (
          <section className="aira-workspace-section"><SettingsWorkspacePanel authenticated={authenticated} user={session?.user ?? null} billing={billing} preferences={preferences} onPreferencesChange={applyPreferences} /></section>
        )}
      </main>

      <AiraFooter />

      <MobileContextSheet open={contextOpen} title="Research context" onClose={() => setContextOpen(false)}>{contextContent}</MobileContextSheet>
    </div>
  );
}
