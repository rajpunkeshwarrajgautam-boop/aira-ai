"use client";

import { ExternalLink, Loader2, Play, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

type CapabilityPlan = {
  missionId: string;
  effort: string;
  tasks: Array<{ id: string; title: string; agentRole: string; risk: string }>;
  totalEstimatedCostUsd: number;
  overallRisk: string;
  requiresApprovalBeforeStart: boolean;
};

type LaunchResult = { projectId: string; runId: string; status: string };

type ApiError = { error?: { message?: string } };

type RuntimeStatus = {
  feature?: {
    enabled?: boolean;
    configured?: boolean;
    ready?: boolean;
    preferredProvider?: string | null;
  };
};

type RuntimeState = "checking" | "ready" | "unavailable";

const effortMap = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  MAXIMUM: "exhaustive",
} as const;

async function readError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function WorkExecutionWorkspace() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [objective, setObjective] = useState("");
  const [effort, setEffort] = useState<"LOW" | "MEDIUM" | "HIGH" | "MAXIMUM">("MEDIUM");
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(5);
  const [plan, setPlan] = useState<CapabilityPlan | null>(null);
  const [launch, setLaunch] = useState<LaunchResult | null>(null);
  const [busy, setBusy] = useState<"plan" | "launch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("checking");

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (sessionStatus !== "authenticated") {
      setRuntimeState("checking");
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/agents/runs?limit=1", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setRuntimeState("unavailable");
          return;
        }
        const body = (await response.json()) as RuntimeStatus;
        setRuntimeState(body.feature?.ready === true ? "ready" : "unavailable");
      } catch (cause) {
        if ((cause as { name?: string })?.name !== "AbortError") {
          setRuntimeState("unavailable");
        }
      }
    })();

    return () => controller.abort();
  }, [sessionStatus]);

  async function generatePlan() {
    const goal = objective.trim();
    if (goal.length < 3) return;
    if (sessionStatus !== "authenticated") {
      router.push(`/signin?callbackUrl=${encodeURIComponent("/work")}`);
      return;
    }
    setBusy("plan");
    setError(null);
    setLaunch(null);
    try {
      const response = await fetch("/api/agent-platform/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          objective: goal,
          constraints: ["Stay within the declared cost ceiling", "Do not claim completion without evidence"],
          expectedDeliverables: [
            {
              type: "ANALYSIS_REPORT",
              title: "Validated work deliverable",
              formatRequirements: "markdown",
            },
          ],
          acceptanceCriteria: [
            {
              id: "work-ac-1",
              description: "Requested outcome is addressed",
              requiredEvidence: ["A persisted deliverable addressing the requested outcome"],
              weight: 1,
            },
            {
              id: "work-ac-2",
              description: "Execution failures remain visible",
              requiredEvidence: ["Persisted run status and failure evidence when applicable"],
              weight: 1,
            },
          ],
          effort: effortMap[effort],
          maxCostUsd: maxBudgetUsd,
          maxTokens: 200_000,
          allowedTools: [],
          maxRiskClass: "MEDIUM",
          privacyMode: "STANDARD",
        }),
      });
      if (!response.ok) throw await readError(response);
      const body = (await response.json()) as { plan: CapabilityPlan };
      setPlan(body.plan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plan generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function executePlan() {
    const goal = objective.trim();
    if (!plan || goal.length < 3) return;
    if (runtimeState !== "ready") {
      setError("Managed execution is not available in this deployment. Planning remains available while the autonomous execution plane is offline or not configured.");
      return;
    }
    setBusy("launch");
    setError(null);
    try {
      const projectResponse = await fetch("/api/agent-platform/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Work · ${goal.slice(0, 72)}`,
          objective: goal,
          config: { source: "work-mode", missionId: plan.missionId, effort },
        }),
      });
      if (!projectResponse.ok) throw await readError(projectResponse);
      const projectBody = (await projectResponse.json()) as { project: { id: string } };

      const runResponse = await fetch(
        `/api/agent-platform/projects/${encodeURIComponent(projectBody.project.id)}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientRequestId: crypto.randomUUID(),
            objective: goal,
            budgets: {
              maxAgents: 16,
              maxParallelAgents: 4,
              maxCostUsd: maxBudgetUsd,
              maxDurationMinutes: 30,
            },
          }),
        },
      );
      if (!runResponse.ok) throw await readError(runResponse);
      const runBody = (await runResponse.json()) as { run: { id: string; status: string } };
      setLaunch({ projectId: projectBody.project.id, runId: runBody.run.id, status: runBody.run.status });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mission launch failed.");
    } finally {
      setBusy(null);
    }
  }

  const managedRunUnavailable = sessionStatus === "authenticated" && runtimeState === "unavailable";

  return (
    <main className="min-h-[calc(100dvh-58px)] bg-[#090b0e] px-4 py-6 text-[#ecece8] md:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b89a51]">Work Mode</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Outcome → plan → managed execution</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#858b94]">Planning is available independently. Managed execution launches only when a real autonomous runtime reports ready; AIRA never fabricates execution or completion.</p>
        </header>

        {managedRunUnavailable ? (
          <div role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">
            Managed execution is currently unavailable because no autonomous execution runtime is ready for this deployment. You can still generate and inspect plans; launch remains disabled until a real runtime is healthy.
          </div>
        ) : null}

        {error ? <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200">{error}</div> : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5">
            <label className="text-xs font-semibold text-[#deded9]" htmlFor="work-objective">Outcome objective</label>
            <textarea id="work-objective" value={objective} onChange={(event) => setObjective(event.target.value.slice(0, 8000))} rows={6} placeholder="Describe the outcome, constraints and evidence you expect…" className="mt-3 w-full rounded-xl border border-white/[0.09] bg-[#090c10] px-4 py-3 text-sm leading-6 text-[#eee] outline-none placeholder:text-[#5f656d] focus:border-[#c9a84c]/45" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[#858b94]">Reasoning depth
                <select value={effort} onChange={(event) => setEffort(event.target.value as typeof effort)} className="mt-1 block w-full rounded-lg border border-white/[0.08] bg-[#14181d] px-3 py-2 text-sm text-[#d8d8d4]">
                  <option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>MAXIMUM</option>
                </select>
              </label>
              <label className="text-xs text-[#858b94]">Cost ceiling (USD)
                <input type="number" min={0.5} max={250} step={0.5} value={maxBudgetUsd} onChange={(event) => setMaxBudgetUsd(Math.max(0.5, Number(event.target.value) || 0.5))} className="mt-1 block w-full rounded-lg border border-white/[0.08] bg-[#14181d] px-3 py-2 text-sm text-[#d8d8d4]" />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => void generatePlan()} disabled={busy !== null || objective.trim().length < 3} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-[#15191e] px-4 py-2.5 text-sm font-semibold text-[#d9d9d4] disabled:opacity-40">{busy === "plan" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4 text-[#d0ae55]" />}Generate plan</button>
              <button type="button" onClick={() => void executePlan()} disabled={busy !== null || !plan || runtimeState !== "ready"} title={runtimeState === "unavailable" ? "Managed execution requires a configured, healthy autonomous runtime." : undefined} className="inline-flex items-center gap-2 rounded-xl bg-[#d0ae55] px-4 py-2.5 text-sm font-semibold text-[#111214] disabled:opacity-40">{busy === "launch" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Launch managed run</button>
            </div>
          </div>

          <aside className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5">
            <h2 className="text-sm font-semibold">Execution evidence</h2>
            {!plan ? <p className="mt-4 text-sm leading-6 text-[#777d85]">Generate a plan to inspect the real task graph before execution.</p> : <div className="mt-4 space-y-3"><div className="rounded-xl bg-white/[0.03] p-3 text-xs text-[#9ba0a8]"><div>Risk: <span className="text-[#deded9]">{plan.overallRisk}</span></div><div className="mt-1">Estimated cost: <span className="text-[#deded9]">${plan.totalEstimatedCostUsd.toFixed(3)}</span></div><div className="mt-1">Tasks: <span className="text-[#deded9]">{plan.tasks.length}</span></div></div>{plan.tasks.slice(0, 6).map((task) => <div key={task.id} className="rounded-xl border border-white/[0.06] px-3 py-2"><p className="text-xs font-medium text-[#e4e4df]">{task.title}</p><p className="mt-1 text-[11px] text-[#747a82]">{task.agentRole} · {task.risk}</p></div>)}</div>}
            {launch ? <div className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3"><p className="text-xs font-semibold text-emerald-200">Managed run created · {launch.status}</p><p className="mt-1 break-all text-[10px] text-[#778079]">{launch.runId}</p><Link href={`/build?project=${encodeURIComponent(launch.projectId)}&run=${encodeURIComponent(launch.runId)}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#d0ae55]">Open mission control <ExternalLink className="size-3" /></Link></div> : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
