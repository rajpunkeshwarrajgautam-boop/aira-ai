"use client";

import { Braces, Loader2, Play, RefreshCw, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Node = { id: string; type: string; name: string; config: Record<string, unknown>; inputBindings: Record<string, string>; failurePolicy?: string };
type Edge = { id: string; sourceNodeId: string; targetNodeId: string; condition?: string };
type Dag = { id: string; name: string; version: number; description: string; nodes: Node[]; edges: Edge[] };
type Routine = { id: string; name: string; description: string; enabled: boolean; version: number; trigger: Record<string, unknown>; workflowDag: Dag; budgetUsd: number; updatedAt: string };
type Run = { id: string; status: string; totalCostUsd: number; error?: string; failedNodeId?: string; pendingApprovalNodeId?: string; stepOutputs: Record<string, unknown> };
type ApiError = { error?: { message?: string } };

async function readError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function WorkflowWorkspace() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [templates, setTemplates] = useState<Dag[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("Manual verified workflow");
  const [description, setDescription] = useState("Created from AIRA's durable automation workspace");
  const [budgetUsd, setBudgetUsd] = useState(5);
  const [dagText, setDagText] = useState("");
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => routines.find((routine) => routine.id === selectedId) ?? null, [routines, selectedId]);

  const load = useCallback(async () => {
    const response = await fetch("/api/automation/routines", { cache: "no-store" });
    if (!response.ok) throw await readError(response);
    const body = (await response.json()) as { routines: Routine[]; templates: Dag[] };
    setRoutines(body.routines); setTemplates(body.templates);
    setSelectedId((current) => current && body.routines.some((routine) => routine.id === current) ? current : body.routines[0]?.id ?? null);
    setDagText((current) => current || JSON.stringify(body.templates[0] ?? {
      id: `dag-${crypto.randomUUID()}`, name: "Manual workflow", version: 1, description: "Manual workflow", nodes: [{ id: "trigger", type: "trigger", name: "Manual trigger", config: {}, inputBindings: {} }], edges: [],
    }, null, 2));
  }, []);

  useEffect(() => { void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Workflows could not be loaded.")); }, [load]);

  function chooseTemplate(template: Dag) {
    setDagText(JSON.stringify({ ...template, id: `${template.id}-${crypto.randomUUID()}`, version: 1 }, null, 2));
    setName(template.name); setDescription(template.description); setLastRun(null);
  }

  async function createRoutine() {
    setBusy("create"); setError(null);
    try {
      const workflowDag = JSON.parse(dagText) as Dag;
      const response = await fetch("/api/automation/routines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), enabled: true, trigger: { type: "manual" }, workflowDag, budgetUsd }),
      });
      if (!response.ok) throw await readError(response);
      const body = (await response.json()) as { routine: Routine };
      setRoutines((current) => [body.routine, ...current.filter((routine) => routine.id !== body.routine.id)]); setSelectedId(body.routine.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Routine could not be created. Check DAG JSON and validation rules."); }
    finally { setBusy(null); }
  }

  async function runRoutine() {
    if (!selected) return;
    setBusy("run"); setError(null); setLastRun(null);
    try {
      const response = await fetch(`/api/automation/routines/${encodeURIComponent(selected.id)}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) throw await readError(response);
      const body = (await response.json()) as { run: Run };
      setLastRun(body.run);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workflow could not be executed."); }
    finally { setBusy(null); }
  }

  return (
    <main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-7">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">Workflows</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#111115]">Durable routines & DAG execution</h1><p className="mt-1 max-w-3xl text-sm text-[#6B6A75]">Create validated manual routines and execute the real automation engine. Agent runtime history remains available in Agents.</p></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs font-semibold text-[#111115] shadow-2xs hover:bg-[#FAF9F6]"><RefreshCw className="size-3.5 text-[#3A0CA3]" />Refresh</button></header>
        {error ? <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-800">{error}</div> : null}
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]"><aside className="space-y-4"><div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs"><h2 className="text-sm font-semibold text-[#111115]">Templates</h2><div className="mt-3 space-y-2">{templates.map((template) => <button key={template.id} type="button" onClick={() => chooseTemplate(template)} className="w-full rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-3 text-left shadow-2xs transition hover:bg-[#FAF9F6]"><p className="text-xs font-semibold text-[#111115]">{template.name}</p><p className="mt-1 line-clamp-2 text-[11px] text-[#6B6A75]">{template.description}</p></button>)}</div></div><div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-3 shadow-xs"><p className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6A75]">Saved routines · {routines.length}</p><div className="max-h-[430px] space-y-1 overflow-auto">{routines.map((routine) => <button key={routine.id} type="button" onClick={() => { setSelectedId(routine.id); setLastRun(null); }} className={`w-full rounded-xl px-3 py-3 text-left transition ${routine.id === selectedId ? "border border-[#3A0CA3] bg-[rgba(58,12,163,0.05)] shadow-2xs" : "border border-transparent hover:bg-[#FAF9F6]"}`}><p className="truncate text-sm font-semibold text-[#111115]">{routine.name}</p><p className="mt-1 text-[10px] text-[#6B6A75]">v{routine.version} · {routine.enabled ? "ACTIVE" : "PAUSED"}</p></button>)}</div></div></aside>
          <section className="space-y-4"><div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs"><div className="flex items-center gap-2"><Braces className="size-4 text-[#3A0CA3]" /><h2 className="text-sm font-semibold text-[#111115]">Create validated routine</h2></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] placeholder:text-[#8F8E98] focus:border-[#3A0CA3]" placeholder="Routine name" /><input type="number" min={0} max={250} value={budgetUsd} onChange={(e) => setBudgetUsd(Math.max(0, Number(e.target.value) || 0))} className="rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] focus:border-[#3A0CA3]" aria-label="Budget USD" /></div><input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-2 w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] placeholder:text-[#8F8E98] focus:border-[#3A0CA3]" placeholder="Description" /><textarea value={dagText} onChange={(e) => setDagText(e.target.value)} rows={14} spellCheck={false} className="mt-2 w-full rounded-xl border border-[rgba(17,17,21,0.12)] bg-[#FAF9F6] px-3 py-3 font-mono text-[11px] leading-5 text-[#111115] focus:border-[#3A0CA3]" /><button type="button" onClick={() => void createRoutine()} disabled={busy !== null || name.trim().length < 1} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#3A0CA3] px-3.5 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-[#2D0A82] disabled:opacity-40">{busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Workflow className="size-4" />}Save as new routine</button></div>
            <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">{selected ? <><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[#111115]">{selected.name}</h2><p className="mt-1 text-xs text-[#6B6A75]">{selected.workflowDag.nodes.length} nodes · {selected.workflowDag.edges.length} edges · ${selected.budgetUsd.toFixed(2)} ceiling</p></div><button type="button" onClick={() => void runRoutine()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-[#3A0CA3] px-3.5 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-[#2D0A82] disabled:opacity-40">{busy === "run" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Run now</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{selected.workflowDag.nodes.map((node) => <div key={node.id} className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3"><p className="text-[10px] font-semibold uppercase text-[#3A0CA3]">{node.type}</p><p className="mt-1 text-xs font-semibold text-[#111115]">{node.name}</p><p className="mt-2 text-[10px] text-[#6B6A75]">Failure: {node.failurePolicy ?? "FAIL_WORKFLOW"}</p></div>)}</div>{lastRun ? <div className={`mt-4 rounded-xl border p-4 ${lastRun.status === "FAILED" ? "border-red-500/20 bg-red-500/[0.05] text-red-900" : lastRun.status === "WAITING_APPROVAL" ? "border-amber-500/20 bg-amber-500/[0.05] text-amber-900" : "border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-900"}`}><p className="text-xs font-semibold">Run {lastRun.status}</p><p className="mt-1 break-all text-[10px] text-[#6B6A75]">{lastRun.id}</p>{lastRun.failedNodeId ? <p className="mt-2 text-xs text-red-700">Failed node: {lastRun.failedNodeId} · {lastRun.error}</p> : null}{lastRun.pendingApprovalNodeId ? <p className="mt-2 text-xs text-amber-800">Waiting approval at: {lastRun.pendingApprovalNodeId}</p> : null}<p className="mt-2 text-[10px] text-[#6B6A75]">Recorded outputs: {Object.keys(lastRun.stepOutputs).length} · cost ${lastRun.totalCostUsd.toFixed(4)}</p></div> : null}</> : <p className="text-sm text-[#6B6A75]">Create or select a routine.</p>}</div>
          </section></div>
      </div>
    </main>
  );
}
