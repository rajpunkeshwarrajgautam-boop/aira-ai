"use client";

import { Bot, Loader2, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type AgentRun = { id: string; provider: string; objective: string; status: string; result: unknown | null; errorMessage: string | null; createdAt: string; updatedAt: string; completedAt: string | null };
type Payload = {
  runs: AgentRun[];
  feature: { enabled: boolean; configured: boolean; ready: boolean; preferredProvider: "DEERFLOW" | "AUTOGPT" | null; providers: Record<string, { enabled: boolean; configured: boolean; healthy: boolean | null; ready: boolean }> };
  usage: { billingPlan: string; monthlyAgentRunLimit: number; agentRunsUsed: number; agentRunsRemaining: number };
};

export default function RunsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [objective, setObjective] = useState("");
  const [provider, setProvider] = useState<"AUTO" | "DEERFLOW" | "AUTOGPT">("AUTO");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agents/runs?limit=50", { cache: "no-store" });
      const body = (await response.json()) as Payload & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load agent runs.");
      setData(body);
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load agent runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!data?.runs.some((run) => ["QUEUED", "RUNNING", "REVIEW", "INCOMPLETE"].includes(run.status))) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [data, refresh]);

  async function startRun() {
    if (objective.trim().length < 3) return;
    setSubmitting(true); setMessage(null);
    try {
      const response = await fetch("/api/agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: crypto.randomUUID(), objective: objective.trim(), ...(provider === "AUTO" ? {} : { provider }) }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Agent run could not be started.");
      setObjective("");
      await refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Agent run could not be started."); }
    finally { setSubmitting(false); }
  }

  return <div className="aira-v2-page"><AiraV2Frame><main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-5 py-7 md:px-8"><div className="mx-auto max-w-6xl">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#a98b43]">Agent operations</p><h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#f2f2ee] md:text-3xl">Agent run center</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#8b9098]">Launch autonomous objectives, inspect runtime readiness, track quota, and monitor every persisted run from one operational view.</p></div><button onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#111419] px-3 py-2 text-xs font-medium text-[#abb0b7]"><RefreshCw className="size-3.5" />Refresh</button></div>
    {message ? <div className="mb-5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-4 py-3 text-sm text-red-200">{message}</div> : null}
    {loading || !data ? <div className="grid place-items-center rounded-2xl border border-white/[0.08] bg-[#0f1216] py-20"><Loader2 className="size-5 animate-spin text-[#a98b43]" /></div> : <>
      <section className="mb-5 grid gap-4 lg:grid-cols-[1.4fr_.6fr]">
        <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><h2 className="text-sm font-semibold text-[#eeeeeb]">Start autonomous work</h2><textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={4} placeholder="Describe the objective, deliverable, constraints and stopping condition…" className="mt-4 w-full rounded-xl border border-white/[0.09] bg-[#0b0d10] px-4 py-3 text-sm leading-6 text-[#f0f0ed] outline-none placeholder:text-[#5e636b] focus:border-[#c9a84c]/45"/><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className="rounded-lg border border-white/[0.08] bg-[#14171c] px-3 py-2 text-xs text-[#c8cbd0]"><option value="AUTO">Auto-select runtime</option><option value="DEERFLOW">DeerFlow</option><option value="AUTOGPT">AutoGPT</option></select><button onClick={() => void startRun()} disabled={submitting || objective.trim().length < 3 || !data.feature.ready} className="inline-flex items-center gap-2 rounded-xl bg-[#d0ae55] px-4 py-2.5 text-sm font-semibold text-[#111214] disabled:opacity-40">{submitting ? <Loader2 className="size-4 animate-spin"/> : <Play className="size-4"/>}Start run</button></div></div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><h2 className="text-sm font-semibold text-[#eeeeeb]">Runtime</h2><div className="mt-4 space-y-3 text-sm"><div className="flex items-center justify-between"><span className="text-[#747981]">Status</span><span className={data.feature.ready ? "text-emerald-300" : "text-amber-200"}>{data.feature.ready ? "Ready" : "Unavailable"}</span></div><div className="flex items-center justify-between"><span className="text-[#747981]">Preferred</span><span className="text-[#d8dade]">{data.feature.preferredProvider ?? "None"}</span></div><div className="flex items-center justify-between"><span className="text-[#747981]">Plan</span><span className="text-[#d8dade]">{data.usage.billingPlan}</span></div><div className="flex items-center justify-between"><span className="text-[#747981]">Runs left</span><span className="text-[#d8dade]">{data.usage.agentRunsRemaining} / {data.usage.monthlyAgentRunLimit}</span></div></div></div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1216]"><div className="border-b border-white/[0.07] px-5 py-4"><h2 className="text-sm font-semibold text-[#eeeeeb]">Run history</h2><p className="mt-1 text-xs text-[#72777f]">{data.runs.length} persisted runs</p></div>{data.runs.length ? <ul className="divide-y divide-white/[0.06]">{data.runs.map((run) => <li key={run.id} className="flex flex-wrap gap-4 px-5 py-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#171a1f] text-[#a0a5ac]"><Bot className="size-4"/></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-[#e9e9e6]">{run.provider}</p><span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-[#8a8f97]">{run.status}</span></div><p className="mt-1 line-clamp-2 text-sm leading-6 text-[#7f848c]">{run.objective}</p>{run.errorMessage ? <p className="mt-1 text-xs text-red-300">{run.errorMessage}</p> : null}</div><time className="text-[11px] text-[#666b73]">{new Date(run.createdAt).toLocaleString()}</time></li>)}</ul> : <div className="px-6 py-16 text-center text-sm text-[#686d75]">No agent runs yet.</div>}</section>
    </>}
  </div></main></AiraV2Frame></div>;
}
