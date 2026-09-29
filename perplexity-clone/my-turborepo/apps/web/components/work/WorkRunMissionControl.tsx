"use client";

import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Coins,
  FileCheck2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  StopCircle,
  Wrench,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface PlatformRun {
  id: string;
  projectId: string;
  status: string;
  runtime?: string | null;
  summary?: string | null;
  knownCostUsd?: number | null;
  inputTokensUsed?: number | null;
  outputTokensUsed?: number | null;
  cachedTokensUsed?: number | null;
  budgets?: {
    maxAgents?: number;
    maxParallelAgents?: number;
    maxToolCalls?: number;
    maxCostUsd?: number;
    maxTokens?: number;
    maxDurationMinutes?: number;
    maxRetries?: number;
  };
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface PlatformProject {
  id: string;
  name: string;
  objective: string;
}

interface PlatformTask {
  id: string;
  title: string;
  objective?: string;
  agentRole: string;
  modelTier: string;
  priority: number;
  status: string;
  attempt: number;
  maxAttempts: number;
  dependencies: string[];
  outputArtifacts: string[];
  runtimeRunId?: string | null;
  lastError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string;
}

interface PlatformEvent {
  id: string;
  taskId?: string | null;
  agentId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface PlatformApproval {
  id: string;
  taskId?: string | null;
  action: string;
  risk: string;
  status: string;
  context?: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string | null;
}

interface PlatformArtifact {
  id: string;
  taskId?: string | null;
  name: string;
  kind: string;
  uri: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface AgentInstance {
  id: string;
  role: string;
  objective: string;
  status: string;
  modelTier: string;
  allowedTools: string[];
  capabilities: string[];
  workspace?: string | null;
  currentTaskId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MissionToolCall {
  id: string;
  taskId?: string | null;
  agentId?: string | null;
  tool: string;
  action: string;
  risk: string;
  status: string;
  approvalId?: string | null;
  inputSummary: Record<string, unknown>;
  resultSummary?: Record<string, unknown> | null;
  usage: Record<string, unknown>;
  errorCode?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

interface MissionUsage {
  toolCallsUsed: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  cachedTokensUsed: number;
  knownCostUsd: string;
  costAccountingComplete: boolean;
  budgets: Record<string, unknown>;
}

interface RunDetailsResponse {
  run: PlatformRun;
  project?: PlatformProject | null;
  tasks: PlatformTask[];
  events: PlatformEvent[];
  approvals: PlatformApproval[];
  artifacts: PlatformArtifact[];
  agents: AgentInstance[];
  toolCalls: MissionToolCall[];
  usage?: MissionUsage | null;
}

interface ArtifactDetail {
  id: string;
  name: string;
  kind: string;
  uri: string;
  content?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

const ACTIVE_RUN = new Set(["QUEUED", "PLANNING", "RUNNING", "WAITING", "APPROVAL_REQUIRED", "BLOCKED"]);
const ACTIVE_TASK = new Set(["READY", "CLAIMED", "RUNNING", "WAITING", "APPROVAL_REQUIRED", "BLOCKED"]);
const ACTIVE_AGENT = new Set(["WORKING", "WAITING"]);
const TERMINAL_TOOL = new Set(["COMPLETED", "FAILED", "DENIED", "CANCELLED"]);

function statusStyle(status: string): string {
  if (status === "COMPLETED" || status === "SUCCEEDED") return "border-emerald-600/20 bg-emerald-50 text-emerald-800";
  if (status === "FAILED" || status === "DENIED") return "border-red-500/20 bg-red-50 text-red-800";
  if (status === "CANCELLED" || status === "STOPPED") return "border-zinc-300 bg-zinc-100 text-zinc-700";
  if (status === "APPROVAL_REQUIRED" || status === "BLOCKED") return "border-amber-600/20 bg-amber-50 text-amber-800";
  if (status === "RUNNING" || status === "WORKING" || status === "CLAIMED") return "border-[#3A0CA3]/20 bg-[#3A0CA3]/[0.06] text-[#3A0CA3]";
  return "border-[rgba(17,17,21,0.1)] bg-[#FAF9F6] text-[#6B6A75]";
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function durationLabel(start?: string | null, end?: string | null): string {
  if (!start) return "Not started";
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((to - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function eventSummary(event: PlatformEvent): string {
  const p = event.payload ?? {};
  const tool = typeof p.tool === "string" ? p.tool : null;
  const action = typeof p.action === "string" ? p.action : null;
  const role = typeof p.role === "string" ? p.role : null;
  const title = typeof p.title === "string" ? p.title : null;
  const message = typeof p.message === "string" ? p.message : null;
  if (message) return message;
  if (tool && action) return `${tool} · ${action}`;
  if (tool) return tool;
  if (role && title) return `${role} · ${title}`;
  if (title) return title;
  return event.type.replaceAll(".", " ");
}

function safeUsageNumber(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function taskTitle(tasks: PlatformTask[], taskId?: string | null): string | null {
  if (!taskId) return null;
  return tasks.find((task) => task.id === taskId)?.title ?? null;
}

export function WorkRunMissionControl() {
  const params = useParams();
  const router = useRouter();
  const { status: authStatus } = useSession();
  const runId = typeof params?.runId === "string" ? params.runId : "";

  const [data, setData] = useState<RunDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail | null>(null);
  const [artifactPending, setArtifactPending] = useState<string | null>(null);
  const [steerTaskId, setSteerTaskId] = useState<string | null>(null);
  const [steerInstruction, setSteerInstruction] = useState("");
  const [taskActionPending, setTaskActionPending] = useState<string | null>(null);

  const fetchData = useCallback(async (quiet = false) => {
    if (!runId) return;
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const response = await fetch(`/api/agent-platform/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          router.push(`/signin?callbackUrl=${encodeURIComponent(`/work/runs/${runId}`)}`);
          return;
        }
        if (response.status === 404) {
          setError("Managed run not found or you do not have permission to view it.");
          return;
        }
        throw new Error(`Failed to load mission state (${response.status}).`);
      }
      const body = (await response.json()) as RunDetailsResponse;
      setData(body);
      setError(null);
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : "Could not load mission state.");
    } finally {
      if (!quiet) setLoading(false);
      setRefreshing(false);
    }
  }, [runId, router]);

  useEffect(() => {
    if (authStatus === "loading") return;
    if (authStatus !== "authenticated") {
      router.push(`/signin?callbackUrl=${encodeURIComponent(`/work/runs/${runId}`)}`);
      return;
    }
    void fetchData();
  }, [authStatus, fetchData, runId, router]);

  useEffect(() => {
    if (!data || !ACTIVE_RUN.has(data.run.status)) return;
    const timer = window.setInterval(() => void fetchData(true), 3000);
    return () => window.clearInterval(timer);
  }, [data, fetchData]);

  async function handleCancel() {
    if (!runId || actionPending || !window.confirm("Cancel this managed run? Active tasks and in-flight tool work will be fenced and stopped where supported.")) return;
    setActionPending("cancel");
    setError(null);
    try {
      const response = await fetch(`/api/agent-platform/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error(`Cancel request failed (${response.status}).`);
      await fetchData(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cancel request failed.");
    } finally {
      setActionPending(null);
    }
  }

  async function handleApproval(approvalId: string, decision: "approve" | "reject") {
    if (actionPending) return;
    setActionPending(approvalId);
    setError(null);
    try {
      const response = await fetch(`/api/agent-platform/approvals/${encodeURIComponent(approvalId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error(`Approval decision failed (${response.status}).`);
      await fetchData(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval decision failed.");
    } finally {
      setActionPending(null);
    }
  }

  async function inspectArtifact(artifact: PlatformArtifact) {
    setArtifactPending(artifact.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/agent-platform/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}`,
        { cache: "no-store" },
      );
      const body = (await response.json().catch(() => null)) as { artifact?: ArtifactDetail; error?: { message?: string } } | null;
      if (!response.ok || !body?.artifact) throw new Error(body?.error?.message ?? "Could not load artifact.");
      setSelectedArtifact(body.artifact);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load artifact.");
    } finally {
      setArtifactPending(null);
    }
  }

  async function steerTask(taskId: string) {
    const instruction = steerInstruction.trim();
    if (instruction.length < 2 || taskActionPending) return;
    setTaskActionPending(`steer:${taskId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/agent-platform/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/steer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction }),
        },
      );
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Task steering failed.");
      setSteerTaskId(null);
      setSteerInstruction("");
      await fetchData(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task steering failed.");
    } finally {
      setTaskActionPending(null);
    }
  }

  async function reconcileTask(taskId: string) {
    if (taskActionPending) return;
    setTaskActionPending(`reconcile:${taskId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/agent-platform/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/reconcile`,
        { method: "POST" },
      );
      const body = (await response.json().catch(() => null)) as {
        recovery?: { outcome?: string; reason?: string };
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Task reconciliation failed.");
      if (body?.recovery?.outcome === "PENDING") {
        setError(`Reconciliation remains pending: ${body.recovery.reason ?? "runtime state is not authoritative yet"}.`);
      }
      await fetchData(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task reconciliation failed.");
    } finally {
      setTaskActionPending(null);
    }
  }

  const metrics = useMemo(() => {
    if (!data) return null;
    const completedTasks = data.tasks.filter((task) => task.status === "COMPLETED").length;
    const activeTasks = data.tasks.filter((task) => ACTIVE_TASK.has(task.status)).length;
    const workingAgents = data.agents.filter((agent) => ACTIVE_AGENT.has(agent.status)).length;
    const completedTools = data.toolCalls.filter((tool) => tool.status === "COMPLETED").length;
    const failedTools = data.toolCalls.filter((tool) => tool.status === "FAILED" || tool.status === "DENIED").length;
    return { completedTasks, activeTasks, workingAgents, completedTools, failedTools };
  }, [data]);

  if (loading && !data) {
    return (
      <main className="grid min-h-[calc(100dvh-72px)] place-items-center bg-[var(--aira-canvas,#F9F8F6)]">
        <div className="flex items-center gap-3 text-sm text-[#6B6A75]">
          <Loader2 className="size-5 animate-spin text-[#3A0CA3]" />
          <span>Loading Mission Control…</span>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="min-h-[calc(100dvh-72px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-8">
        <div className="mx-auto max-w-4xl space-y-4">
          <Link href="/work" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B6A75] hover:text-[#3A0CA3]">
            <ArrowLeft className="size-3.5" /> Back to Work
          </Link>
          <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-50 p-6 text-red-800">{error}</div>
        </div>
      </main>
    );
  }

  if (!data || !metrics) return null;

  const { run, project, tasks, events, approvals, artifacts, agents, toolCalls, usage } = data;
  const isActive = ACTIVE_RUN.has(run.status);
  const pendingApprovals = approvals.filter((approval) => approval.status === "PENDING");
  const progress = tasks.length ? Math.round((metrics.completedTasks / tasks.length) * 100) : 0;
  const inputTokens = Number(usage?.inputTokensUsed ?? run.inputTokensUsed ?? 0);
  const outputTokens = Number(usage?.outputTokensUsed ?? run.outputTokensUsed ?? 0);
  const cachedTokens = Number(usage?.cachedTokensUsed ?? run.cachedTokensUsed ?? 0);
  const knownCost = Number(usage?.knownCostUsd ?? run.knownCostUsd ?? 0);
  const maxCost = Number(run.budgets?.maxCostUsd ?? usage?.budgets?.maxCostUsd ?? 0);
  const maxToolCalls = Number(run.budgets?.maxToolCalls ?? usage?.budgets?.maxToolCalls ?? 0);
  const toolCallsUsed = Number(usage?.toolCallsUsed ?? toolCalls.length);

  return (
    <main className="min-h-[calc(100dvh-72px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-5 text-[#111115] md:px-7">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="rounded-[22px] border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-[0_12px_40px_rgba(22,18,35,0.04)] md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/work" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B6A75] transition hover:text-[#3A0CA3]">
              <ArrowLeft className="size-3.5" /> Work
            </Link>
            <div className="flex gap-2">
              <button type="button" onClick={() => void fetchData(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs font-semibold hover:bg-[#FAF9F6] disabled:opacity-50">
                {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh
              </button>
              {isActive ? (
                <button type="button" onClick={() => void handleCancel()} disabled={actionPending === "cancel"} className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                  {actionPending === "cancel" ? <Loader2 className="size-3.5 animate-spin" /> : <StopCircle className="size-3.5" />} Cancel
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.7fr)]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#3A0CA3]">AIRA Mission Control</span>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusStyle(run.status)}`}>{run.status}</span>
                {isActive ? <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />Live</span> : null}
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.035em] md:text-[32px]">{project?.name ?? "Managed mission"}</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-[#5F5E68]">{project?.objective ?? run.summary ?? "Managed AIRA Work execution."}</p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[#8F8E98]">
                <span>Runtime <strong className="font-semibold text-[#52515B]">{run.runtime ?? "managed"}</strong></span>
                <span>Duration <strong className="font-semibold text-[#52515B]">{durationLabel(run.startedAt, run.completedAt)}</strong></span>
                <span>Run <strong className="font-mono font-medium text-[#52515B]">{run.id.slice(0, 12)}</strong></span>
              </div>
            </div>

            <div className="rounded-2xl border border-[#3A0CA3]/10 bg-[#3A0CA3]/[0.025] p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">Mission progress</span>
                <span className="font-semibold text-[#3A0CA3]">{metrics.completedTasks}/{tasks.length} tasks</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#EAE8EF]">
                <div className="h-full rounded-full bg-[#3A0CA3] transition-[width] duration-500" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white p-2.5"><p className="text-lg font-semibold">{metrics.activeTasks}</p><p className="text-[9px] uppercase tracking-wide text-[#8F8E98]">Active tasks</p></div>
                <div className="rounded-xl bg-white p-2.5"><p className="text-lg font-semibold">{metrics.workingAgents}</p><p className="text-[9px] uppercase tracking-wide text-[#8F8E98]">Live agents</p></div>
                <div className="rounded-xl bg-white p-2.5"><p className="text-lg font-semibold">{pendingApprovals.length}</p><p className="text-[9px] uppercase tracking-wide text-[#8F8E98]">Approvals</p></div>
              </div>
            </div>
          </div>
        </header>

        {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2 text-xs text-[#6B6A75]"><Coins className="size-3.5 text-[#3A0CA3]" />Known cost</div>
            <p className="mt-2 text-xl font-semibold">${knownCost.toFixed(4)}</p>
            <p className="mt-1 text-[10px] text-[#8F8E98]">{maxCost > 0 ? `Budget $${maxCost.toFixed(2)}` : "No cost ceiling reported"}</p>
          </div>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2 text-xs text-[#6B6A75]"><Sparkles className="size-3.5 text-[#3A0CA3]" />Tokens</div>
            <p className="mt-2 text-xl font-semibold">{compactNumber(inputTokens + outputTokens)}</p>
            <p className="mt-1 text-[10px] text-[#8F8E98]">{compactNumber(inputTokens)} in · {compactNumber(outputTokens)} out · {compactNumber(cachedTokens)} cached</p>
          </div>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2 text-xs text-[#6B6A75]"><Wrench className="size-3.5 text-[#3A0CA3]" />Tool calls</div>
            <p className="mt-2 text-xl font-semibold">{toolCallsUsed}</p>
            <p className="mt-1 text-[10px] text-[#8F8E98]">{metrics.completedTools} completed · {metrics.failedTools} failed/denied{maxToolCalls > 0 ? ` · max ${maxToolCalls}` : ""}</p>
          </div>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2 text-xs text-[#6B6A75]"><Bot className="size-3.5 text-[#3A0CA3]" />Agents</div>
            <p className="mt-2 text-xl font-semibold">{agents.length}</p>
            <p className="mt-1 text-[10px] text-[#8F8E98]">{metrics.workingAgents} currently working/waiting</p>
          </div>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2 text-xs text-[#6B6A75]"><Clock3 className="size-3.5 text-[#3A0CA3]" />Accounting</div>
            <p className="mt-2 text-sm font-semibold">{usage?.costAccountingComplete ? "Complete" : "Partial / unknown"}</p>
            <p className="mt-1 text-[10px] text-[#8F8E98]">Shown truthfully from persisted usage accounting</p>
          </div>
        </section>

        {pendingApprovals.length ? (
          <section className="rounded-[20px] border border-amber-500/25 bg-amber-50/60 p-5">
            <div className="flex items-center gap-2"><ShieldAlert className="size-5 text-amber-700" /><h2 className="text-sm font-semibold text-amber-950">Approval required</h2></div>
            <p className="mt-1 text-xs leading-5 text-amber-900/70">AIRA is waiting for explicit authorization before continuing these actions.</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {pendingApprovals.map((approval) => (
                <article key={approval.id} className="rounded-2xl border border-amber-500/20 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{approval.action}</p>
                      <p className="mt-1 text-[11px] text-[#6B6A75]">{taskTitle(tasks, approval.taskId) ?? "Mission-level action"}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${statusStyle(approval.risk === "HIGH" || approval.risk === "PROTECTED" ? "FAILED" : "APPROVAL_REQUIRED")}`}>{approval.risk}</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button type="button" onClick={() => void handleApproval(approval.id, "reject")} disabled={actionPending === approval.id} className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"><XCircle className="size-3.5" />Reject</button>
                    <button type="button" onClick={() => void handleApproval(approval.id, "approve")} disabled={actionPending === approval.id} className="inline-flex items-center gap-1.5 rounded-xl bg-[#3A0CA3] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                      {actionPending === approval.id ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}Approve
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(390px,0.7fr)]">
          <div className="space-y-5">
            <section className="rounded-[20px] border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div className="flex items-end justify-between gap-3">
                <div><h2 className="text-sm font-semibold">Task graph</h2><p className="mt-1 text-xs text-[#6B6A75]">Persisted work units, dependencies and execution state.</p></div>
                <span className="text-[10px] font-semibold text-[#8F8E98]">{tasks.length} tasks</span>
              </div>
              <div className="mt-4 space-y-3">
                {tasks.map((task, index) => (
                  <article key={task.id} className="rounded-2xl border border-[rgba(17,17,21,0.07)] bg-[#FCFBF9] p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid size-7 shrink-0 place-items-center rounded-lg border border-[rgba(17,17,21,0.08)] bg-white text-[10px] font-semibold text-[#6B6A75]">{index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold">{task.title}</h3>
                            {task.objective ? <p className="mt-1 text-xs leading-5 text-[#6B6A75]">{task.objective}</p> : null}
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold ${statusStyle(task.status)}`}>{task.status}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-[#8F8E98]">
                          <span>Agent <strong className="text-[#52515B]">{task.agentRole}</strong></span>
                          <span>Model tier <strong className="text-[#52515B]">{task.modelTier}</strong></span>
                          <span>Attempt <strong className="text-[#52515B]">{task.attempt}/{task.maxAttempts}</strong></span>
                          {task.startedAt ? <span>Elapsed <strong className="text-[#52515B]">{durationLabel(task.startedAt, task.completedAt)}</strong></span> : null}
                        </div>
                        {task.dependencies.length ? <p className="mt-2 text-[10px] text-[#8F8E98]">Depends on {task.dependencies.length} task{task.dependencies.length === 1 ? "" : "s"}</p> : null}
                        {task.lastError ? <div className="mt-3 rounded-xl border border-red-500/15 bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-700">{task.lastError}</div> : null}

                        {(task.status === "RUNNING" && task.runtimeRunId) || task.status === "BLOCKED" ? (
                          <div className="mt-3 flex flex-wrap gap-2 border-t border-[rgba(17,17,21,0.06)] pt-3">
                            {task.status === "RUNNING" && task.runtimeRunId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSteerTaskId((current) => current === task.id ? null : task.id);
                                  setSteerInstruction("");
                                }}
                                className="rounded-lg border border-[#3A0CA3]/15 bg-[#3A0CA3]/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-[#3A0CA3] hover:bg-[#3A0CA3]/[0.08]"
                              >
                                Steer running task
                              </button>
                            ) : null}
                            {task.status === "BLOCKED" ? (
                              <button
                                type="button"
                                onClick={() => void reconcileTask(task.id)}
                                disabled={taskActionPending === `reconcile:${task.id}`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                              >
                                {taskActionPending === `reconcile:${task.id}` ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                                Reconcile existing runtime
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {steerTaskId === task.id ? (
                          <div className="mt-3 rounded-xl border border-[#3A0CA3]/15 bg-white p-3">
                            <label className="text-[10px] font-semibold text-[#52515B]" htmlFor={`steer-${task.id}`}>Steering instruction</label>
                            <textarea
                              id={`steer-${task.id}`}
                              value={steerInstruction}
                              onChange={(event) => setSteerInstruction(event.target.value)}
                              maxLength={4000}
                              rows={3}
                              placeholder="Give the active delegated runtime a concrete mid-run instruction…"
                              className="mt-2 w-full resize-y rounded-lg border border-[rgba(17,17,21,0.1)] px-3 py-2 text-xs leading-5 outline-none focus:border-[#3A0CA3]"
                            />
                            <div className="mt-2 flex items-center justify-between gap-3">
                              <span className="text-[9px] text-[#8F8E98]">Sent only if this runtime supports steering.</span>
                              <button
                                type="button"
                                onClick={() => void steerTask(task.id)}
                                disabled={steerInstruction.trim().length < 2 || taskActionPending === `steer:${task.id}`}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#3A0CA3] px-3 py-1.5 text-[10px] font-semibold text-white disabled:opacity-40"
                              >
                                {taskActionPending === `steer:${task.id}` ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                                Send instruction
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
                {!tasks.length ? <p className="py-8 text-center text-xs text-[#8F8E98]">No task rows persisted for this run.</p> : null}
              </div>
            </section>

            <section className="rounded-[20px] border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div className="flex items-end justify-between gap-3">
                <div><h2 className="text-sm font-semibold">Tool execution ledger</h2><p className="mt-1 text-xs text-[#6B6A75]">Actual Tool Gateway operations, risks, status and bounded audit summaries.</p></div>
                <Link href="/tools" className="text-[10px] font-semibold text-[#3A0CA3] hover:underline">Gateway status</Link>
              </div>
              <div className="mt-4 space-y-2">
                {toolCalls.map((call) => {
                  const totalToolTokens = safeUsageNumber(call.usage, "inputTokens") + safeUsageNumber(call.usage, "outputTokens");
                  const toolCost = safeUsageNumber(call.usage, "costUsd");
                  return (
                    <article key={call.id} className="rounded-2xl border border-[rgba(17,17,21,0.07)] bg-[#FCFBF9] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#3A0CA3]/[0.06] text-[#3A0CA3]"><Wrench className="size-3.5" /></span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold"><span className="text-[#3A0CA3]">{call.tool}</span> · {call.action}</p>
                            <p className="mt-1 text-[10px] text-[#8F8E98]">{taskTitle(tasks, call.taskId) ?? "Mission operation"} · risk {call.risk}</p>
                          </div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold ${statusStyle(call.status)}`}>{call.status}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#8F8E98]">
                        <span>{new Date(call.createdAt).toLocaleTimeString()}</span>
                        {call.startedAt ? <span>{durationLabel(call.startedAt, call.completedAt)}</span> : null}
                        {totalToolTokens > 0 ? <span>{compactNumber(totalToolTokens)} tokens</span> : null}
                        {toolCost > 0 ? <span>${toolCost.toFixed(4)}</span> : null}
                        {call.errorCode ? <span className="text-red-700">{call.errorCode}</span> : null}
                      </div>
                      {(Object.keys(call.inputSummary).length > 0 || call.resultSummary) ? (
                        <details className="mt-3 rounded-xl border border-[rgba(17,17,21,0.06)] bg-white px-3 py-2">
                          <summary className="cursor-pointer text-[10px] font-semibold text-[#6B6A75]">Inspect audit summary</summary>
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-[#52515B]">{JSON.stringify({ input: call.inputSummary, result: call.resultSummary }, null, 2)}</pre>
                        </details>
                      ) : null}
                    </article>
                  );
                })}
                {!toolCalls.length ? <p className="py-8 text-center text-xs text-[#8F8E98]">No Tool Gateway calls persisted for this run.</p> : null}
              </div>
            </section>

            <section className="rounded-[20px] border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div><h2 className="text-sm font-semibold">Artifacts</h2><p className="mt-1 text-xs text-[#6B6A75]">Durable run outputs stored by AIRA with run ownership enforcement.</p></div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {artifacts.map((artifact) => (
                  <button key={artifact.id} type="button" onClick={() => void inspectArtifact(artifact)} disabled={artifactPending === artifact.id} className="group flex items-center justify-between rounded-2xl border border-[rgba(17,17,21,0.08)] bg-[#FCFBF9] p-4 text-left transition hover:border-[#3A0CA3]/20 hover:bg-white disabled:opacity-60">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#3A0CA3]/[0.06] text-[#3A0CA3]"><FileCheck2 className="size-4" /></span>
                      <div className="min-w-0"><p className="truncate text-sm font-semibold">{artifact.name}</p><p className="mt-1 text-[10px] text-[#8F8E98]">{artifact.kind} · {new Date(artifact.createdAt).toLocaleString()}</p></div>
                    </div>
                    {artifactPending === artifact.id ? <Loader2 className="size-4 animate-spin text-[#3A0CA3]" /> : <ChevronRight className="size-4 text-[#A3A2AA] transition group-hover:translate-x-0.5 group-hover:text-[#3A0CA3]" />}
                  </button>
                ))}
                {!artifacts.length ? <p className="md:col-span-2 py-8 text-center text-xs text-[#8F8E98]">No durable artifacts recorded yet.</p> : null}
              </div>
              {selectedArtifact ? (
                <div className="mt-4 rounded-2xl border border-[#3A0CA3]/15 bg-[#3A0CA3]/[0.02] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{selectedArtifact.name}</p><p className="mt-1 text-[10px] text-[#8F8E98]">{selectedArtifact.kind} · {selectedArtifact.uri}</p></div><button type="button" onClick={() => setSelectedArtifact(null)} className="text-[10px] font-semibold text-[#6B6A75] hover:text-[#111115]">Close</button></div>
                  {selectedArtifact.content ? <pre className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-4 text-[11px] leading-5 text-[#52515B]">{selectedArtifact.content}</pre> : <p className="mt-4 text-xs text-[#6B6A75]">This artifact has metadata but no inline text content.</p>}
                </div>
              ) : null}
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-[20px] border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div><h2 className="text-sm font-semibold">Agent roster</h2><p className="mt-1 text-xs text-[#6B6A75]">Actual managed agent instances persisted for this run.</p></div>
              <div className="mt-4 space-y-2.5">
                {agents.map((agent) => (
                  <article key={agent.id} className="rounded-2xl border border-[rgba(17,17,21,0.07)] bg-[#FCFBF9] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#3A0CA3]/[0.06] text-[#3A0CA3]"><Bot className="size-3.5" /></span><div><p className="text-sm font-semibold">{agent.role}</p><p className="mt-1 text-[10px] text-[#8F8E98]">{agent.modelTier}</p></div></div>
                      <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${statusStyle(agent.status)}`}>{agent.status}</span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#6B6A75]">{agent.objective}</p>
                    {agent.allowedTools.length ? <div className="mt-3 flex flex-wrap gap-1.5">{agent.allowedTools.slice(0, 8).map((tool) => <span key={tool} className="rounded-md border border-[rgba(17,17,21,0.07)] bg-white px-2 py-1 text-[9px] text-[#6B6A75]">{tool}</span>)}</div> : null}
                  </article>
                ))}
                {!agents.length ? <p className="py-8 text-center text-xs text-[#8F8E98]">No agent instances persisted yet.</p> : null}
              </div>
            </section>

            <section className="rounded-[20px] border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div><h2 className="text-sm font-semibold">Execution timeline</h2><p className="mt-1 text-xs text-[#6B6A75]">Persisted runtime events, newest first.</p></div>
              <div className="mt-4 max-h-[640px] space-y-2 overflow-y-auto pr-1">
                {[...events].reverse().map((event) => (
                  <article key={event.id} className="rounded-xl border border-[rgba(17,17,21,0.07)] bg-[#FCFBF9] p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-1 size-2 shrink-0 rounded-full bg-[#3A0CA3]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2"><p className="truncate text-[11px] font-semibold text-[#3A0CA3]">{event.type}</p><time className="shrink-0 text-[9px] text-[#A3A2AA]">{new Date(event.createdAt).toLocaleTimeString()}</time></div>
                        <p className="mt-1 text-[11px] leading-5 text-[#5F5E68]">{eventSummary(event)}</p>
                        {Object.keys(event.payload ?? {}).length ? <details className="mt-1.5"><summary className="cursor-pointer text-[9px] font-semibold text-[#8F8E98]">Metadata</summary><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-[9px] leading-4 text-[#6B6A75]">{JSON.stringify(event.payload, null, 2)}</pre></details> : null}
                      </div>
                    </div>
                  </article>
                ))}
                {!events.length ? <p className="py-8 text-center text-xs text-[#8F8E98]">No runtime events persisted yet.</p> : null}
              </div>
            </section>

            <section className="rounded-[20px] border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div><h2 className="text-sm font-semibold">Approval history</h2><p className="mt-1 text-xs text-[#6B6A75]">Recorded human authorization decisions for this mission.</p></div>
              <div className="mt-4 space-y-2">
                {approvals.map((approval) => (
                  <div key={approval.id} className="flex items-start justify-between gap-3 rounded-xl border border-[rgba(17,17,21,0.07)] bg-[#FCFBF9] p-3">
                    <div className="min-w-0"><p className="truncate text-[11px] font-semibold">{approval.action}</p><p className="mt-1 text-[9px] text-[#8F8E98]">{approval.risk} · {new Date(approval.createdAt).toLocaleString()}</p></div>
                    <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${statusStyle(approval.status === "APPROVED" ? "COMPLETED" : approval.status === "PENDING" ? "APPROVAL_REQUIRED" : approval.status)}`}>{approval.status}</span>
                  </div>
                ))}
                {!approvals.length ? <p className="py-6 text-center text-xs text-[#8F8E98]">No approval records for this mission.</p> : null}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
