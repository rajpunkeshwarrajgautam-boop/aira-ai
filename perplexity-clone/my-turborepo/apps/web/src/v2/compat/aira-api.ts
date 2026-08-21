export type ResearchMode = "standard" | "deep";

export interface Citation {
  readonly index: number;
  readonly url: string;
  readonly title: string;
  readonly publishedDate: string | null;
  readonly rankingScore: number;
  readonly excerpt?: string;
  readonly sourceQuality?: string;
}

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly lastMessageAt: string;
  readonly createdAt: string;
}

export interface ConversationMessage {
  readonly id: string;
  readonly role: "USER" | "ASSISTANT";
  readonly content: string;
  readonly parentMessageId: string | null;
  readonly citations: unknown;
  readonly createdAt: string;
}

export type AgentRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "TERMINATED"
  | "REVIEW";

export interface AgentRun {
  readonly id: string;
  readonly provider: string;
  readonly objective: string;
  readonly status: AgentRunStatus;
  readonly result: unknown | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface AgentDashboard {
  readonly runs: readonly AgentRun[];
  readonly feature?: {
    readonly enabled?: boolean;
    readonly configured?: boolean;
    readonly ready?: boolean;
    readonly preferredProvider?: string | null;
  };
  readonly usage?: {
    readonly billingPlan?: string;
    readonly monthlyAgentRunLimit?: number;
    readonly agentRunsUsed?: number;
    readonly agentRunsRemaining?: number;
  };
}

interface ApiErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

interface MetadataEvent {
  readonly type?: string;
  readonly query?: string;
  readonly citations?: readonly Citation[];
}

interface TextEvent {
  readonly type?: string;
  readonly delta?: string;
}

interface DoneEvent {
  readonly type?: string;
  readonly conversationId?: string;
  readonly messageId?: string;
}

interface StreamErrorEvent {
  readonly type?: string;
  readonly code?: string;
  readonly message?: string;
}

export interface SearchStreamCallbacks {
  readonly onMetadata?: (payload: MetadataEvent) => void;
  readonly onText?: (payload: TextEvent) => void;
  readonly onDone?: (payload: DoneEvent) => void;
  readonly onStreamError?: (payload: StreamErrorEvent) => void;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? `AIRA request failed (${response.status}).`);
  }

  return (await response.json()) as T;
}

export async function listConversations(): Promise<readonly ConversationSummary[]> {
  const result = await apiJson<{ readonly conversations: readonly ConversationSummary[] }>(
    "/api/conversations",
  );
  return result.conversations;
}

export async function getConversationMessages(
  conversationId: string,
): Promise<readonly ConversationMessage[]> {
  const result = await apiJson<{ readonly messages: readonly ConversationMessage[] }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=500`,
  );
  return result.messages;
}

export async function getAgentDashboard(): Promise<AgentDashboard> {
  return apiJson<AgentDashboard>("/api/agents/runs?limit=12");
}

function dispatchSseBlock(block: string, callbacks: SearchStreamCallbacks): void {
  const lines = block.split(/\r?\n/);
  let eventName = "message";
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }

  if (data.length === 0) return;
  const raw = data.join("\n");

  if (eventName === "metadata") {
    const payload = parseJson<MetadataEvent>(raw);
    if (payload) callbacks.onMetadata?.(payload);
    return;
  }
  if (eventName === "text") {
    const payload = parseJson<TextEvent>(raw);
    if (payload) callbacks.onText?.(payload);
    return;
  }
  if (eventName === "done") {
    const payload = parseJson<DoneEvent>(raw);
    if (payload) callbacks.onDone?.(payload);
    return;
  }
  if (eventName === "stream_error") {
    const payload = parseJson<StreamErrorEvent>(raw);
    if (payload) callbacks.onStreamError?.(payload);
  }
}

export async function streamSearch(
  input: {
    readonly query: string;
    readonly mode: ResearchMode;
    readonly conversationId?: string;
    readonly parentMessageId?: string;
    readonly presetId?: string;
  },
  callbacks: SearchStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/search", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      mode: input.mode,
      presetId: input.presetId ?? "general",
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? `Search failed (${response.status}).`);
  }

  if (!response.body) throw new Error("AIRA search returned no response stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) dispatchSseBlock(part, callbacks);
    if (done) break;
  }

  if (buffer.trim()) dispatchSseBlock(buffer, callbacks);
}
