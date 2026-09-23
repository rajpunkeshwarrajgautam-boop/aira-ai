"use client";

import { Bot, Loader2, Network, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type Run = { id: string; projectId: string; status: string; runtime: string | null; summary: string | null; createdAt: string };
type Task = { id: string; title: string; objective: string; status: string; agentRole: string; modelTier: string };
type Detail = { run: Run; tasks: Task[]; events: Array<{ id: string; type: string; createdAt: string }> };
type ApiError = { error?: { message?: string } };

async function readError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function SwarmWorkspace() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [objective, setObjective] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (runId: string) => {
    const response = await fetch(`/api/agent-platform/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
    if (!response.ok) throw await readError(response);
    setDetail((await response.json()) as Detail);
  }, []);

  useEffect(() => {
    if (!detail || !["PLANNING", "RUNNING", "WAITING", "BLOCKED", "APPROVAL_REQUIRED"].includes(detail.run.status)) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/agent-platform/runs/${encodeURIComponent(detail.run.id)}/tick`, { method: "POST" })
        .then(() => refresh(detail.run.id))
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [detail, refresh]);

  async function startSwarm() {
    const goal = objective.trim();
    if (goal.length < 3) return;
    if (sessionStatus !== "authenticated") { router.push(`/signin?callbackUrl=${encodeURIComponent("/swarms")}`); return; }
    setBusy(true); setError(null);
    try {
      const projectResponse = await fetch("/api/agent-platform/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Swarm · ${goal.slice(0, 70)}`, objective: goal, config: { source: "swarm-workspace" } }),
      });
      if (!projectResponse.ok) throw await readError(projectResponse);
      const project = (await projectResponse.json()) as { project: { id: string } };
      const runResponse = await fetch(`/api/agent-platform/projects/${encodeURIComponent(project.project.id)}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          objective: goal,
          provider: "AGENT_SWARM",
          budgets: { maxAgents: 16, maxParallelAgents: 4, maxToolCalls: 100, maxCostUsd: 10, maxDurationMinutes: 45 },
        }),
      });
      if (!runResponse.ok) throw await readError(runResponse);
      const body = (await runResponse.json()) as { run: Run; tasks: Task[] };
      setDetail({ run: body.run, tasks: body.tasks, events: [] });
      await refresh(body.run.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Swarm mission could not be started.");
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3A0CA3]">Swarm orchestration</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#111115] md:text-3xl">Real AGENT_SWARM managed runs</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">This surface dispatches through the persisted Agent Platform. It does not synthesize council members or fixed confidence scores in the browser.</p>
        </header>
        {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        <section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
          <textarea value={objective} onChange={(e) => setObjective(e.target.value.slice(0, 8000))} rows={5} placeholder="Describe a mission that benefits from multiple specialist roles…" className="w-full rounded-xl border border-[rgba(17,17,21,0.12)] bg-white px-4 py-3 text-sm leading-6 text-[#111115] outline-none placeholder:text-[#8F8E98] focus:border-[#3A0CA3]" />
          <button type="button" onClick={() => void startSwarm()} disabled={busy || objective.trim().length < 3} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#3A0CA3] hover:bg-[#2D0A82] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition disabled:opacity-40">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Start swarm mission
          </button>
        </section>
        {detail ? (
          <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div className="flex items-center gap-2">
                <Network className="size-4 text-[#3A0CA3]" />
                <h2 className="text-sm font-semibold text-[#111115]">Run state</h2>
              </div>
              <p className="mt-4 text-xs text-[#6B6A75]">Runtime</p>
              <p className="text-sm font-semibold text-[#111115]">{detail.run.runtime ?? "AGENT_SWARM"}</p>
              <p className="mt-3 text-xs text-[#6B6A75]">Status</p>
              <p className="text-sm font-semibold text-[#3A0CA3]">{detail.run.status}</p>
              <p className="mt-3 break-all text-[10px] text-[#8F8E98]">{detail.run.id}</p>
              <button type="button" onClick={() => void refresh(detail.run.id)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-xs font-medium text-[#111115] shadow-xs hover:bg-[#FAF9F6]">
                <RefreshCw className="size-3.5" />Refresh
              </button>
            </aside>
            <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <h2 className="text-sm font-semibold text-[#111115]">Delegated specialist tasks · {detail.tasks.length}</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {detail.tasks.map((task) => (
                  <article key={task.id} className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#111115]">
                        <Bot className="size-3.5 text-[#3A0CA3]" />{task.agentRole}
                      </span>
                      <span className="text-[10px] text-[#6B6A75]">{task.status}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-[#111115]">{task.title}</p>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-[#6B6A75]">{task.objective}</p>
                    <p className="mt-2 text-[10px] text-[#8F8E98]">{task.modelTier}</p>
                  </article>
                ))}
              </div>
              {detail.tasks.length < 2 ? (
                <p className="mt-4 text-xs text-amber-700">The current runtime produced fewer than two specialist tasks; this run does not prove multi-worker participation.</p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
