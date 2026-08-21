"use client";

import {
  Archive,
  ArrowUp,
  Bot,
  Brain,
  ChevronRight,
  Globe2,
  Library,
  Loader2,
  Menu,
  MessageSquare,
  PanelRightClose,
  Search,
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

import { ShareAnswerButton } from "@/src/v2/components/ShareAnswerButton";
import { AgentWorkspacePanel } from "@/src/v2/components/modules/AgentWorkspacePanel";
import { LibraryWorkspacePanel } from "@/src/v2/components/modules/LibraryWorkspacePanel";
import { MemoryWorkspacePanel } from "@/src/v2/components/modules/MemoryWorkspacePanel";
import {
  getBillingStatus,
  type BillingStatus,
} from "@/src/v2/compat/account-api";
import {
  getAgentDashboard,
  getConversationMessages,
  listConversations,
  streamSearch,
  type AgentDashboard,
  type Citation,
  type ConversationMessage,
  type ConversationSummary,
  type ResearchMode,
} from "@/src/v2/compat/aira-api";

type WorkspaceView = "home" | "research" | "agents" | "library" | "memory";

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
    return (
      typeof record.index === "number" &&
      typeof record.title === "string" &&
      typeof record.url === "string"
    );
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

function MarkdownMessage({
  content,
  citations,
}: {
  readonly content: string;
  readonly citations: readonly Citation[];
}) {
  return (
    <div className="v2-answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {citations.length > 0 ? (
        <div className="v2-inline-sources" aria-label="Answer sources">
          {citations.slice(0, 6).map((citation) => (
            <a
              key={`${citation.index}-${citation.url}`}
              href={citation.url}
              target="_blank"
              rel="noreferrer"
              title={citation.title}
            >
              {citation.index}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AiraV2Workspace() {
  const { data: session, status: sessionStatus } = useSession();
  const authenticated = sessionStatus === "authenticated";
  const [view, setView] = useState<WorkspaceView>("home");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ResearchMode>("standard");
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([]);
  const [streamingUser, setStreamingUser] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<readonly Citation[]>([]);
  const [phase, setPhase] = useState<"idle" | "searching" | "streaming" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentDashboard | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [agentRefreshing, setAgentRefreshing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const busy = phase === "searching" || phase === "streaming";
  const parentMessageId = useMemo(
    () => [...messages].reverse().find((message) => message.role === "ASSISTANT")?.id,
    [messages],
  );

  const activeCitations = useMemo(() => {
    if (streamingCitations.length > 0) return streamingCitations;
    const lastAssistant = [...messages].reverse().find((message) => message.role === "ASSISTANT");
    return lastAssistant && isCitationArray(lastAssistant.citations) ? lastAssistant.citations : [];
  }, [messages, streamingCitations]);

  const refreshConversations = useCallback(async () => {
    if (!authenticated) return;
    try {
      setConversations(await listConversations());
    } catch {
      // History failure should never make the live research composer unusable.
    }
  }, [authenticated]);

  const refreshAgents = useCallback(async () => {
    if (!authenticated) return;
    setAgentRefreshing(true);
    try {
      setAgents(await getAgentDashboard());
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
    void refreshConversations();
    void refreshAgents();
    void refreshBilling();
  }, [refreshAgents, refreshBilling, refreshConversations]);

  useEffect(() => {
    if (view !== "research" && view !== "home") return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, phase, streamingAnswer, streamingUser, view]);

  const selectConversation = useCallback(async (id: string) => {
    if (busy) return;
    setConversationId(id);
    setView("research");
    setSidebarOpen(false);
    setError(null);
    try {
      setMessages(await getConversationMessages(id));
      setStreamingCitations([]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Conversation could not be loaded.");
    }
  }, [busy]);

  const newTask = useCallback(() => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setStreamingUser(null);
    setStreamingAnswer("");
    setStreamingCitations([]);
    setError(null);
    setPhase("idle");
    setQuery("");
    setView("home");
    setSidebarOpen(false);
  }, []);

  const submit = useCallback(
    async (forcedQuery?: string) => {
      const objective = (forcedQuery ?? query).trim();
      if (!objective || busy) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setQuery("");
      setError(null);
      setStreamingUser(objective);
      setStreamingAnswer("");
      setStreamingCitations([]);
      setPhase("searching");
      setView("research");

      try {
        let completedConversationId: string | null = null;

        await streamSearch(
          {
            query: objective,
            mode,
            ...(conversationId ? { conversationId } : {}),
            ...(parentMessageId ? { parentMessageId } : {}),
          },
          {
            onMetadata: (payload) => {
              setStreamingCitations(payload.citations ?? []);
              setPhase("streaming");
            },
            onText: (payload) => {
              if (!payload.delta) return;
              setPhase("streaming");
              setStreamingAnswer((current) => current + payload.delta);
            },
            onDone: (payload) => {
              if (!payload.conversationId) return;
              completedConversationId = payload.conversationId;
              setConversationId(payload.conversationId);
            },
            onStreamError: (payload) => {
              setError(payload.message ?? "AIRA could not complete the research stream.");
            },
          },
          controller.signal,
        );

        const resolvedConversationId = completedConversationId ?? conversationId;
        if (resolvedConversationId) {
          const refreshedMessages = await getConversationMessages(resolvedConversationId).catch(
            () => null,
          );
          if (refreshedMessages) setMessages(refreshedMessages);
        }

        setStreamingUser(null);
        setStreamingAnswer("");
        setPhase("idle");
        await Promise.all([refreshConversations(), refreshBilling()]);
      } catch (submitError) {
        if (controller.signal.aborted) {
          setPhase("idle");
          setStreamingUser(null);
          setStreamingAnswer("");
          return;
        }
        setError(submitError instanceof Error ? submitError.message : "AIRA could not complete the request.");
        setPhase("error");
        await refreshBilling();
      } finally {
        abortRef.current = null;
      }
    },
    [busy, conversationId, mode, parentMessageId, query, refreshBilling, refreshConversations],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const switchView = useCallback((next: WorkspaceView) => {
    setView(next);
    setSidebarOpen(false);
    if (next === "agents" || next === "library") void refreshAgents();
  }, [refreshAgents]);

  const accountLabel = session?.user?.name?.trim() || session?.user?.email?.trim() || "Account";

  return (
    <div className="aira-v2">
      <header className="v2-topbar">
        <button
          className="v2-icon-button v2-mobile-only"
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open workspace navigation"
        >
          <Menu aria-hidden />
        </button>
        <Link href="/v2" className="v2-brand" aria-label="AIRA V2 home">
          <AiraMark />
          <span>AIRA</span>
          <span className="v2-preview-badge">V2 PREVIEW</span>
        </Link>
        <div className="v2-topbar-center">
          <Search aria-hidden />
          <span>One workspace for research, memory, artifacts, and autonomous work</span>
        </div>
        <div className="v2-topbar-actions">
          {authenticated && billing ? (
            <Link href="/pricing" className="v2-usage-pill" title="View plan and usage">
              <span>{billing.billingPlan}</span>
              <strong>{billing.searchesRemaining}</strong>
              <small>searches</small>
            </Link>
          ) : null}
          {authenticated ? (
            <div className="v2-account-chip" title={accountLabel}>
              <span>{initials(session?.user?.name, session?.user?.email)}</span>
              <div><strong>{accountLabel}</strong><small>Signed in</small></div>
            </div>
          ) : sessionStatus === "unauthenticated" ? (
            <Link href={`/signin?callbackUrl=${encodeURIComponent("/v2")}`} className="v2-signin-link">Sign in</Link>
          ) : (
            <span className="v2-account-loading"><Loader2 className="spin" aria-hidden /></span>
          )}
          <Link href="/" className="v2-legacy-link">Current AIRA</Link>
        </div>
      </header>

      <div className="v2-frame">
        <aside className={`v2-sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="v2-sidebar-mobile-head">
            <span>Workspace</span>
            <button type="button" className="v2-icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation">
              <X aria-hidden />
            </button>
          </div>

          <button className="v2-new-task" type="button" onClick={newTask}>
            <Sparkles aria-hidden />
            New task
            <span>+</span>
          </button>

          <nav className="v2-primary-nav" aria-label="AIRA V2">
            {([
              ["home", "Home", MessageSquare],
              ["research", "Research", Globe2],
              ["agents", "Agents", Bot],
              ["library", "Library", Library],
              ["memory", "Memory", Brain],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                data-active={view === id ? "true" : "false"}
                onClick={() => switchView(id)}
                aria-current={view === id ? "page" : undefined}
              >
                <Icon aria-hidden />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="v2-recents">
            <div className="v2-section-label">
              <span>Recent</span>
              <Archive aria-hidden />
            </div>
            {!authenticated ? (
              <p className="v2-muted-copy">Sign in to sync conversations and workspace memory.</p>
            ) : conversations.length === 0 ? (
              <p className="v2-muted-copy">Your saved work will appear here.</p>
            ) : (
              conversations.slice(0, 12).map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  data-active={conversationId === conversation.id ? "true" : "false"}
                  onClick={() => void selectConversation(conversation.id)}
                  disabled={busy}
                >
                  <span>{conversation.title}</span>
                  <time>{formatRelative(conversation.lastMessageAt)}</time>
                </button>
              ))
            )}
          </div>

          <div className="v2-sidebar-footer">
            <span className="v2-status-light" aria-hidden />
            Existing backend connected
          </div>
        </aside>

        {sidebarOpen ? (
          <button type="button" className="v2-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />
        ) : null}

        <main className="v2-main">
          <div className="v2-main-scroll" ref={scrollRef}>
            {view === "home" && messages.length === 0 && !streamingUser ? (
              <section className="v2-home">
                <div className="v2-home-mark"><AiraMark /></div>
                <p className="v2-eyebrow">AI WORKSPACE</p>
                <h1>What do you want AIRA to accomplish?</h1>
                <p className="v2-home-subtitle">
                  Research, reason, remember, create, and run autonomous work from one surface.
                  The existing AIRA backend remains the compatibility and safety layer.
                </p>

                <div className="v2-starter-grid">
                  {STARTERS.map((starter) => (
                    <button key={starter.label} type="button" onClick={() => void submit(starter.prompt)}>
                      <span>{starter.label}</span>
                      <ChevronRight aria-hidden />
                    </button>
                  ))}
                </div>
              </section>
            ) : view === "agents" ? (
              <AgentWorkspacePanel
                authenticated={authenticated}
                dashboard={agents}
                onDashboardChange={setAgents}
              />
            ) : view === "library" ? (
              <LibraryWorkspacePanel
                authenticated={authenticated}
                dashboard={agents}
                refreshing={agentRefreshing}
                onRefresh={() => void refreshAgents()}
              />
            ) : view === "memory" ? (
              <MemoryWorkspacePanel authenticated={authenticated} />
            ) : (
              <section className="v2-thread" aria-live="polite">
                {messages.length === 0 && !streamingUser ? (
                  <div className="v2-thread-empty">
                    <Globe2 aria-hidden />
                    <h1>Research workspace</h1>
                    <p>Ask a question and AIRA will use the existing grounded-search backend with live citations.</p>
                  </div>
                ) : null}

                {messages.map((message) =>
                  message.role === "USER" ? (
                    <div className="v2-user-message" key={message.id}>
                      <div>{message.content}</div>
                    </div>
                  ) : (
                    <article className="v2-assistant-message" key={message.id}>
                      <div className="v2-assistant-avatar">A</div>
                      <div className="v2-assistant-body">
                        <div className="v2-message-meta">AIRA</div>
                        <MarkdownMessage
                          content={message.content}
                          citations={isCitationArray(message.citations) ? message.citations : []}
                        />
                        {authenticated && conversationId ? (
                          <ShareAnswerButton conversationId={conversationId} messageId={message.id} />
                        ) : null}
                      </div>
                    </article>
                  ),
                )}

                {streamingUser ? (
                  <div className="v2-user-message"><div>{streamingUser}</div></div>
                ) : null}

                {streamingUser ? (
                  <article className="v2-assistant-message">
                    <div className="v2-assistant-avatar">A</div>
                    <div className="v2-assistant-body">
                      <div className="v2-message-meta">
                        AIRA
                        {busy ? <span className="v2-live-state"><Loader2 aria-hidden /> working</span> : null}
                      </div>
                      {streamingAnswer ? (
                        <MarkdownMessage content={streamingAnswer} citations={streamingCitations} />
                      ) : (
                        <div className="v2-thinking">
                          <span /><span /><span />
                          {streamingCitations.length > 0
                            ? `Reading ${streamingCitations.length} sources`
                            : "Searching and reasoning"}
                        </div>
                      )}
                    </div>
                  </article>
                ) : null}

                {error ? (
                  <div className="v2-error"><strong>Request not completed</strong><span>{error}</span></div>
                ) : null}
              </section>
            )}
          </div>

          {(view === "home" || view === "research") ? (
            <div className="v2-composer-wrap">
              <form
                className="v2-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="Ask AIRA to research, analyze, create, or plan…"
                  disabled={busy}
                  rows={1}
                  aria-label="AIRA objective"
                />
                <div className="v2-composer-tools">
                  <div className="v2-mode-switch" role="group" aria-label="Research depth">
                    <button type="button" data-active={mode === "standard"} onClick={() => setMode("standard")} disabled={busy}>
                      <Globe2 aria-hidden /> Web
                    </button>
                    <button type="button" data-active={mode === "deep"} onClick={() => setMode("deep")} disabled={busy}>
                      <Zap aria-hidden /> Deep
                    </button>
                  </div>
                  {busy ? (
                    <button type="button" className="v2-send stop" onClick={stop} aria-label="Stop AIRA">
                      <Square aria-hidden />
                    </button>
                  ) : (
                    <button type="submit" className="v2-send" disabled={!query.trim()} aria-label="Send to AIRA">
                      <ArrowUp aria-hidden />
                    </button>
                  )}
                </div>
              </form>
              <p>AIRA can make mistakes. Verify important decisions and sources.</p>
            </div>
          ) : null}
        </main>

        <aside className={`v2-context ${contextOpen ? "" : "closed"}`}>
          <div className="v2-context-head">
            <div>
              <span>Context</span>
              <small>
                {view === "agents" ? "Runtime" : view === "memory" ? "Privacy" : view === "library" ? "Artifacts" : "Sources"}
              </small>
            </div>
            <button type="button" className="v2-icon-button" onClick={() => setContextOpen(false)} aria-label="Close context panel">
              <PanelRightClose aria-hidden />
            </button>
          </div>

          {view === "agents" ? (
            <div className="v2-context-content">
              <div className="v2-context-stat"><span>Runtime</span><strong>{agents?.feature?.preferredProvider ?? "Automatic"}</strong></div>
              <div className="v2-context-stat"><span>Ready</span><strong>{agents?.feature?.ready ? "Yes" : "No"}</strong></div>
              <div className="v2-context-stat"><span>Remaining</span><strong>{agents?.usage?.agentRunsRemaining ?? "—"}</strong></div>
            </div>
          ) : view === "memory" ? (
            <div className="v2-context-placeholder">
              <Brain aria-hidden />
              <strong>Private account memory</strong>
              <p>V2 never reads the database directly. Memory ownership and sensitive-content rejection remain enforced by the existing AIRA backend.</p>
            </div>
          ) : view === "library" ? (
            <div className="v2-context-placeholder">
              <Library aria-hidden />
              <strong>Protected outputs</strong>
              <p>Artifact links resolve through the existing authenticated download route, which validates both run ownership and recorded artifact paths.</p>
            </div>
          ) : activeCitations.length > 0 ? (
            <div className="v2-source-list">
              {activeCitations.map((citation) => (
                <a key={`${citation.index}-${citation.url}`} href={citation.url} target="_blank" rel="noreferrer">
                  <div className="v2-source-index">{citation.index}</div>
                  <div>
                    <strong>{citation.title}</strong>
                    <span>{sourceDomain(citation.url)}</span>
                    {citation.excerpt ? <p>{citation.excerpt}</p> : null}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="v2-context-placeholder">
              <Globe2 aria-hidden />
              <strong>Sources appear here</strong>
              <p>The answer stays readable while evidence, files, memory, and tool activity live in context.</p>
            </div>
          )}
        </aside>

        {!contextOpen ? (
          <button className="v2-context-reopen" type="button" onClick={() => setContextOpen(true)} aria-label="Open context panel">
            <ChevronRight aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
