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
    <main className="min-h-[calc(100dvh-58px)] bg-[#090b0e] px-4 py-6 text-[#ecece8] md:px-7">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b89a51]">Workflows</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Durable routines & DAG execution</h1><p className="mt-1 max-w-3xl text-sm text-[#858b94]">Create validated manual routines and execute the real automation engine. Agent runtime history remains available in Agents.</p></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs"><RefreshCw className="size-3.5" />Refresh</button></header>
        {error ? <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200">{error}</div> : null}
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]"><aside className="space-y-4"><div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-4"><h2 className="text-sm font-semibold">Templates</h2><div className="mt-3 space-y-2">{templates.map((template) => <button key={template.id} type="button" onClick={() => chooseTemplate(template)} className="w-full rounded-xl border border-white/[0.06] p-3 text-left hover:bg-white/[0.03]"><p className="text-xs font-semibold">{template.name}</p><p className="mt-1 line-clamp-2 text-[11px] text-[#747a82]">{template.description}</p></button>)}</div></div><div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-3"><p className="px-2 py-2 text-[10px] uppercase tracking-[0.14em] text-[#666d76]">Saved routines · {routines.length}</p><div className="max-h-[430px] space-y-1 overflow-auto">{routines.map((routine) => <button key={routine.id} type="button" onClick={() => { setSelectedId(routine.id); setLastRun(null); }} className={`w-full rounded-xl px-3 py-3 text-left ${routine.id === selectedId ? "bg-[#1a1e24]" : "hover:bg-white/[0.03]"}`}><p className="truncate text-sm font-medium">{routine.name}</p><p className="mt-1 text-[10px] text-[#747a82]">v{routine.version} · {routine.enabled ? "ACTIVE" : "PAUSED"}</p></button>)}</div></div></aside>
          <section className="space-y-4"><div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><div className="flex items-center gap-2"><Braces className="size-4 text-[#d0ae55]" /><h2 className="text-sm font-semibold">Create validated routine</h2></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" placeholder="Routine name" /><input type="number" min={0} max={250} value={budgetUsd} onChange={(e) => setBudgetUsd(Math.max(0, Number(e.target.value) || 0))} className="rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" aria-label="Budget USD" /></div><input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" placeholder="Description" /><textarea value={dagText} onChange={(e) => setDagText(e.target.value)} rows={14} spellCheck={false} className="mt-2 w-full rounded-xl border border-white/[0.08] bg-[#07090c] px-3 py-3 font-mono text-[11px] leading-5 text-[#b8bdc5]" /><button type="button" onClick={() => void createRoutine()} disabled={busy !== null || name.trim().length < 1} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#d0ae55] px-3 py-2 text-sm font-semibold text-[#111214] disabled:opacity-40">{busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Workflow className="size-4" />}Save as new routine</button></div>
            <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5">{selected ? <><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{selected.name}</h2><p className="mt-1 text-xs text-[#747a82]">{selected.workflowDag.nodes.length} nodes · {selected.workflowDag.edges.length} edges · ${selected.budgetUsd.toFixed(2)} ceiling</p></div><button type="button" onClick={() => void runRoutine()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-[#d0ae55] px-3 py-2 text-sm font-semibold text-[#111214] disabled:opacity-40">{busy === "run" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Run now</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{selected.workflowDag.nodes.map((node) => <div key={node.id} className="rounded-xl border border-white/[0.06] p-3"><p className="text-[10px] uppercase text-[#d0ae55]">{node.type}</p><p className="mt-1 text-xs font-medium">{node.name}</p><p className="mt-2 text-[10px] text-[#747a82]">Failure: {node.failurePolicy ?? "FAIL_WORKFLOW"}</p></div>)}</div>{lastRun ? <div className={`mt-4 rounded-xl border p-4 ${lastRun.status === "FAILED" ? "border-red-400/20 bg-red-400/[0.05]" : lastRun.status === "WAITING_APPROVAL" ? "border-amber-300/20 bg-amber-300/[0.05]" : "border-emerald-400/20 bg-emerald-400/[0.05]"}`}><p className="text-xs font-semibold">Run {lastRun.status}</p><p className="mt-1 break-all text-[10px] text-[#747a82]">{lastRun.id}</p>{lastRun.failedNodeId ? <p className="mt-2 text-xs text-red-200">Failed node: {lastRun.failedNodeId} · {lastRun.error}</p> : null}{lastRun.pendingApprovalNodeId ? <p className="mt-2 text-xs text-amber-200">Waiting approval at: {lastRun.pendingApprovalNodeId}</p> : null}<p className="mt-2 text-[10px] text-[#747a82]">Recorded outputs: {Object.keys(lastRun.stepOutputs).length} · cost ${lastRun.totalCostUsd.toFixed(4)}</p></div> : null}</> : <p className="text-sm text-[#747a82]">Create or select a routine.</p>}</div>
          </section></div>
      </div>
    </main>
  );
}
