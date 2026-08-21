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

export interface AgentProviderState {
  readonly enabled?: boolean;
  readonly configured?: boolean;
  readonly healthy?: boolean | null;
  readonly ready?: boolean;
}

export interface AgentDashboard {
  readonly runs: readonly AgentRun[];
  readonly feature?: {
    readonly enabled?: boolean;
    readonly configured?: boolean;
    readonly ready?: boolean;
    readonly preferredProvider?: string | null;
    readonly providers?: Readonly<Record<string, AgentProviderState>>;
  };
  readonly usage?: {
    readonly billingPlan?: string;
    readonly monthlyAgentRunLimit?: number;
    readonly agentRunsUsed?: number;
    readonly agentRunsRemaining?: number;
  };
}

export type MemoryKind =
  | "PROFILE"
  | "PREFERENCE"
  | "GOAL"
  | "PROJECT"
  | "DECISION"
  | "CONSTRAINT"
  | "RELATIONSHIP"
  | "OTHER";

export interface UserMemory {
  readonly id: string;
  readonly memoryKey: string;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly keywords: readonly string[];
  readonly importance: number;
  readonly confidence: number;
  readonly pinned: boolean;
  readonly lastRecalledAt: string | null;
  readonly recallCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
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

export class AiraCompatibilityError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, args: { readonly code?: string | null; readonly status: number }) {
    super(message);
    this.name = "AiraCompatibilityError";
    this.code = args.code ?? null;
    this.status = args.status;
  }
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function errorFromResponse(response: Response, fallback: string): Promise<AiraCompatibilityError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return new AiraCompatibilityError(body?.error?.message ?? fallback, {
    code: body?.error?.code ?? null,
    status: response.status,
  });
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
    throw await errorFromResponse(response, `AIRA request failed (${response.status}).`);
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

export async function getAgentDashboard(limit = 24): Promise<AgentDashboard> {
  return apiJson<AgentDashboard>(`/api/agents/runs?limit=${Math.min(Math.max(limit, 1), 50)}`);
}

export async function startAgentRun(objective: string): Promise<{
  readonly run: AgentRun;
  readonly agentRunsRemaining?: number;
}> {
  return apiJson("/api/agents/runs", {
    method: "POST",
    body: JSON.stringify({ clientRequestId: crypto.randomUUID(), objective }),
  });
}

export async function syncAgentRun(runId: string): Promise<{
  readonly run: AgentRun;
  readonly syncWarning?: string;
}> {
  return apiJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
}

export async function cancelAgentRun(runId: string): Promise<{ readonly run: AgentRun }> {
  return apiJson(`/api/agents/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

function resultRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

export function agentResultText(result: unknown): string | null {
  if (typeof result === "string" && result.trim()) return result.trim();
  const output = resultRecord(result)?.output;
  return typeof output === "string" && output.trim() ? output.trim() : null;
}

export function agentArtifactPaths(result: unknown): readonly string[] {
  const artifacts = resultRecord(result)?.artifacts;
  if (!Array.isArray(artifacts)) return [];
  return Array.from(
    new Set(
      artifacts
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/\\/g, "/").replace(/^\/+/, ""))
        .filter((value) => value.startsWith("mnt/user-data/outputs/")),
    ),
  ).slice(0, 25);
}

export function agentArtifactHref(runId: string, artifactPath: string): string {
  const encoded = artifactPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/agents/runs/${encodeURIComponent(runId)}/artifacts/${encoded}`;
}

export async function listMemories(limit = 100): Promise<readonly UserMemory[]> {
  const result = await apiJson<{ readonly memories: readonly UserMemory[] }>(
    `/api/memory?limit=${Math.min(Math.max(limit, 1), 200)}`,
  );
  return result.memories;
}

export async function createMemory(input: {
  readonly content: string;
  readonly kind?: MemoryKind;
  readonly pinned?: boolean;
}): Promise<UserMemory> {
  const result = await apiJson<{ readonly memory: UserMemory }>("/api/memory", {
    method: "POST",
    body: JSON.stringify({
      content: input.content,
      ...(input.kind ? { kind: input.kind } : {}),
      pinned: input.pinned ?? true,
    }),
  });
  return result.memory;
}

export async function setMemoryPinned(id: string, pinned: boolean): Promise<void> {
  await apiJson<{ readonly ok: true }>("/api/memory", {
    method: "PATCH",
    body: JSON.stringify({ id, pinned }),
  });
}

export async function deleteMemory(id: string): Promise<void> {
  await apiJson<{ readonly ok: true }>("/api/memory", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
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
    throw await errorFromResponse(response, `Search failed (${response.status}).`);
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
