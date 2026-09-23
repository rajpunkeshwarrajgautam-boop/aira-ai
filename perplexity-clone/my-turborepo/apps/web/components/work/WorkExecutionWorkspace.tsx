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
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  provider?: string | null;
  degradedCapabilities?: readonly string[];
  reason?: string | null;
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
        const response = await fetch("/api/agent-platform/runtime/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setRuntimeState("unavailable");
          return;
        }
        const body = (await response.json()) as RuntimeStatus;
        setRuntimeState(body.ready === true && body.enabled === true ? "ready" : "unavailable");
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
    <main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">Work Mode</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#111115] md:text-3xl">Outcome → plan → managed execution</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">Planning is available independently. Managed execution launches only when a real autonomous runtime reports ready; AIRA never fabricates execution or completion.</p>
        </header>

        {managedRunUnavailable ? (
          <div role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-900">
            Managed execution is currently unavailable because no autonomous execution runtime is ready for this deployment. You can still generate and inspect plans; launch remains disabled until a real runtime is healthy.
          </div>
        ) : null}

        {error ? <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-800">{error}</div> : null}

        {sessionStatus !== "authenticated" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(58,12,163,0.18)] bg-[rgba(58,12,163,0.04)] p-4 text-xs">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-[rgba(58,12,163,0.12)] text-[#3A0CA3]">
                <ShieldCheck className="size-4" />
              </span>
              <div>
                <p className="font-semibold text-[#111115]">Discover AIRA Work Mode</p>
                <p className="text-[#6B6A75]">Pick a verified mission template below to preview multi-agent execution graphs, or sign in to launch live autonomous missions.</p>
              </div>
            </div>
            <Link
              href="/signin?callbackUrl=%2Fwork"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#3A0CA3] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#2D0A82]"
            >
              Sign in to Launch
            </Link>
          </div>
        ) : null}

        {/* Mission Templates */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              title: "Market & Due Diligence",
              desc: "Deep competitive matrix, regulatory posture, and evidence synthesis.",
              goal: "Conduct a comprehensive due diligence investigation into competitive AI gateway infrastructure, evaluating fail-closed security, SLA guarantees, and enterprise pricing models.",
              depth: "HIGH" as const,
              cost: 10,
            },
            {
              title: "Security & Threat Modeling",
              desc: "IDOR boundaries, SSRF prevention, and strict tenant isolation.",
              goal: "Perform an end-to-end security architecture audit for cross-tenant data isolation, verifying that row-level policies, signed storage tokens, and memory namespaces fail closed under attack.",
              depth: "MAXIMUM" as const,
              cost: 15,
            },
            {
              title: "System Performance Audit",
              desc: "Latency bottlenecks, connection pools, and cold-start profiling.",
              goal: "Analyze end-to-end serverless request latency, PostgreSQL pool saturation limits, and pgvector retrieval similarity bounds under high concurrency.",
              depth: "MEDIUM" as const,
              cost: 5,
            },
          ].map((tmpl) => (
            <button
              key={tmpl.title}
              type="button"
              onClick={() => {
                setObjective(tmpl.goal);
                setEffort(tmpl.depth);
                setMaxBudgetUsd(tmpl.cost);
              }}
              className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-3.5 text-left shadow-xs transition hover:border-[#3A0CA3]/40 hover:bg-[#FAF9F6]"
            >
              <p className="text-xs font-semibold text-[#111115]">{tmpl.title}</p>
              <p className="mt-1 text-[11px] leading-5 text-[#6B6A75]">{tmpl.desc}</p>
              <span className="mt-2 inline-block rounded bg-[rgba(58,12,163,0.08)] px-2 py-0.5 text-[10px] font-semibold text-[#3A0CA3]">
                Load template →
              </span>
            </button>
          ))}
        </div>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
            <label className="text-xs font-semibold text-[#111115]" htmlFor="work-objective">Outcome objective</label>
            <textarea id="work-objective" value={objective} onChange={(event) => setObjective(event.target.value.slice(0, 8000))} rows={6} placeholder="Describe the outcome, constraints and evidence you expect…" className="mt-3 w-full rounded-xl border border-[rgba(17,17,21,0.12)] bg-white px-4 py-3 text-sm leading-6 text-[#111115] outline-none placeholder:text-[#8F8E98] focus:border-[#3A0CA3]" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[#6B6A75]">Reasoning depth
                <select value={effort} onChange={(event) => setEffort(event.target.value as typeof effort)} className="mt-1 block w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] focus:border-[#3A0CA3]">
                  <option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>MAXIMUM</option>
                </select>
              </label>
              <label className="text-xs text-[#6B6A75]">Cost ceiling (USD)
                <input type="number" min={0.5} max={250} step={0.5} value={maxBudgetUsd} onChange={(event) => setMaxBudgetUsd(Math.max(0.5, Number(event.target.value) || 0.5))} className="mt-1 block w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] focus:border-[#3A0CA3]" />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => void generatePlan()} disabled={busy !== null || objective.trim().length < 3} className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.12)] bg-white px-4 py-2.5 text-sm font-semibold text-[#111115] shadow-xs transition hover:bg-[#FAF9F6] disabled:opacity-40">{busy === "plan" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4 text-[#3A0CA3]" />}Generate plan</button>
              <button type="button" onClick={() => void executePlan()} disabled={busy !== null || !plan || runtimeState !== "ready"} title={runtimeState === "unavailable" ? "Managed execution requires a configured, healthy autonomous runtime." : undefined} className="inline-flex items-center gap-2 rounded-xl bg-[#3A0CA3] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#2D0A82] disabled:opacity-40">{busy === "launch" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Launch managed run</button>
            </div>
          </div>

          <aside className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
            <h2 className="text-sm font-semibold text-[#111115]">Execution evidence</h2>
            {!plan ? <p className="mt-4 text-sm leading-6 text-[#6B6A75]">Generate a plan or load a template above to inspect the task graph before execution.</p> : <div className="mt-4 space-y-3"><div className="rounded-xl border border-[rgba(17,17,21,0.06)] bg-[#FAF9F6] p-3 text-xs text-[#6B6A75]"><div>Risk: <span className="font-medium text-[#111115]">{plan.overallRisk}</span></div><div className="mt-1">Estimated cost: <span className="font-medium text-[#111115]">${plan.totalEstimatedCostUsd.toFixed(3)}</span></div><div className="mt-1">Tasks: <span className="font-medium text-[#111115]">{plan.tasks.length}</span></div></div>{plan.tasks.slice(0, 6).map((task) => <div key={task.id} className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white px-3 py-2 shadow-2xs"><p className="text-xs font-medium text-[#111115]">{task.title}</p><p className="mt-1 text-[11px] text-[#6B6A75]">{task.agentRole} · {task.risk}</p></div>)}</div>}
            {launch ? <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] p-3"><p className="text-xs font-semibold text-emerald-800">Managed run created · {launch.status}</p><p className="mt-1 break-all text-[10px] text-[#6B6A75]">{launch.runId}</p><Link href={`/work/runs/${encodeURIComponent(launch.runId)}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#3A0CA3] hover:underline">Open Work Mission Control <ExternalLink className="size-3" /></Link></div> : null}
          </aside>
        </section>
      </div>
    </main>
  );
}

