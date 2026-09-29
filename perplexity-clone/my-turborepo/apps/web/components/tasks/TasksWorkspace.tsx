"use client";

import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Task = {
  id: string;
  projectId: string;
  runId: string;
  title: string;
  objective: string;
  status: string;
  priority: number;
  agentRole: string;
  modelTier: string;
  attempt: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  runStatus: string;
  projectName: string;
};

type Payload = { tasks: Task[]; count: number };
type ApiError = { error?: { message?: string } };

const ACTIVE = new Set(["QUEUED", "READY", "CLAIMED", "RUNNING", "WAITING", "BLOCKED", "APPROVAL_REQUIRED"]);
const FAILED = new Set(["FAILED", "CANCELLED"]);

function statusClasses(status: string): string {
  if (status === "COMPLETED") return "border-emerald-600/20 bg-emerald-50 text-emerald-800";
  if (FAILED.has(status)) return "border-red-300 bg-red-50 text-red-800";
  if (status === "BLOCKED" || status === "APPROVAL_REQUIRED") return "border-amber-600/20 bg-amber-50 text-amber-800";
  if (status === "RUNNING" || status === "CLAIMED") return "border-[#3A0CA3]/20 bg-[#3A0CA3]/[0.07] text-[#3A0CA3]";
  return "border-[rgba(17,17,21,0.1)] bg-[#FAF9F6] text-[#6B6A75]";
}

export function TasksWorkspace() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<"all" | "active" | "completed" | "failed">("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/agent-platform/tasks?limit=150", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as Payload & ApiError | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not load managed tasks.");
      setTasks(body?.tasks ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load managed tasks.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => tasks.filter((task) => {
    if (view === "active") return ACTIVE.has(task.status);
    if (view === "completed") return task.status === "COMPLETED";
    if (view === "failed") return FAILED.has(task.status);
    return true;
  }), [tasks, view]);

  const counts = useMemo(() => ({
    active: tasks.filter((task) => ACTIVE.has(task.status)).length,
    completed: tasks.filter((task) => task.status === "COMPLETED").length,
    failed: tasks.filter((task) => FAILED.has(task.status)).length,
  }), [tasks]);

  return (
    <main className="min-h-[calc(100dvh-72px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">AIRA Command</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Tasks</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">
              Persisted task graph across your managed Work runs. No synthetic progress is generated on this screen.
            </p>
          </div>
          <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.12)] bg-white px-4 py-2.5 text-sm font-semibold shadow-xs hover:bg-[#FAF9F6] disabled:opacity-50">
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
          </button>
        </header>

        {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

        <section className="grid gap-3 sm:grid-cols-4">
          {[
            ["all", "All", tasks.length],
            ["active", "Active", counts.active],
            ["completed", "Completed", counts.completed],
            ["failed", "Failed / cancelled", counts.failed],
          ].map(([key, label, count]) => (
            <button key={String(key)} type="button" onClick={() => setView(key as typeof view)} className={`rounded-2xl border p-4 text-left shadow-xs transition ${view === key ? "border-[#3A0CA3]/30 bg-[#3A0CA3]/[0.05]" : "border-[rgba(17,17,21,0.08)] bg-white hover:bg-[#FAF9F6]"}`}>
              <p className="text-xs text-[#6B6A75]">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{count}</p>
            </button>
          ))}
        </section>

        {loading ? (
          <div className="grid min-h-72 place-items-center rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white"><Loader2 className="size-5 animate-spin text-[#3A0CA3]" /></div>
        ) : filtered.length ? (
          <section className="overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs">
            <div className="hidden grid-cols-[minmax(280px,1.6fr)_140px_120px_120px_150px] gap-3 border-b border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8F8E98] lg:grid">
              <span>Task</span><span>Agent</span><span>Status</span><span>Attempts</span><span>Updated</span>
            </div>
            <div className="divide-y divide-[rgba(17,17,21,0.07)]">
              {filtered.map((task) => (
                <article key={task.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(280px,1.6fr)_140px_120px_120px_150px] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {task.status === "COMPLETED" ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : FAILED.has(task.status) ? <AlertTriangle className="size-4 shrink-0 text-red-600" /> : <Clock3 className="size-4 shrink-0 text-[#3A0CA3]" />}
                      <h2 className="truncate text-sm font-semibold">{task.title}</h2>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#6B6A75]">{task.objective}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#8F8E98]">
                      <span>{task.projectName}</span><span>·</span><span>Run {task.runStatus}</span>
                      <Link href={`/work/runs/${encodeURIComponent(task.runId)}`} className="inline-flex items-center gap-1 font-semibold text-[#3A0CA3] hover:underline">Mission control <ExternalLink className="size-3" /></Link>
                    </div>
                    {task.lastError ? <p className="mt-2 text-[11px] leading-5 text-red-700">{task.lastError}</p> : null}
                  </div>
                  <div><span className="text-xs font-medium">{task.agentRole}</span><p className="mt-1 text-[10px] text-[#8F8E98]">{task.modelTier}</p></div>
                  <div><span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-semibold ${statusClasses(task.status)}`}>{task.status}</span></div>
                  <div className="text-xs text-[#6B6A75]">{task.attempt} / {task.maxAttempts}</div>
                  <time className="text-[10px] text-[#8F8E98]">{new Date(task.updatedAt).toLocaleString()}</time>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white px-6 py-16 text-center">
            <p className="text-sm font-medium">No persisted tasks in this view.</p>
            <p className="mt-2 text-xs text-[#6B6A75]">Tasks appear here when a real managed Work run creates them.</p>
            <Link href="/work" className="mt-4 inline-flex rounded-xl bg-[#3A0CA3] px-4 py-2.5 text-sm font-semibold text-white">Open Work Mode</Link>
          </div>
        )}
      </div>
    </main>
  );
}
