"use client";

import {
  Activity,
  ArrowUpRight,
  Bot,
  Brain,
  CheckCircle2,
  CircleAlert,
  Columns2,
  Cpu,
  FolderOpen,
  Gauge,
  History,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type Integration = {
  id: string;
  label: string;
  configured: boolean;
  detail: string;
  model?: string;
};

type IntegrationsPayload = {
  integrations: Integration[];
  defaults: {
    primaryProvider: string;
    fallbackProvider: string;
    localRouting?: string;
  };
};

type LocalAiPayload = {
  enabled?: boolean;
  configured?: boolean;
  model?: string | null;
  models?: string[];
  health?: {
    reachable?: boolean;
    status?: string;
    model?: string | null;
    latencyMs?: number | null;
  };
};

type AgentRun = {
  id: string;
  provider: string;
  objective: string;
  status: string;
  createdAt: string;
};

type RunsPayload = {
  runs: AgentRun[];
  feature: {
    enabled: boolean;
    configured: boolean;
    ready: boolean;
    preferredProvider: "DEERFLOW" | "AUTOGPT" | null;
  };
  usage: {
    billingPlan: string;
    monthlyAgentRunLimit: number;
    agentRunsUsed: number;
    agentRunsRemaining: number;
  };
};

type LoadState = {
  integrations: IntegrationsPayload | null;
  localAi: LocalAiPayload | null;
  runs: RunsPayload | null;
  errors: string[];
};

const MODULES = [
  { href: "/", label: "Research", description: "Live web research with grounded citations", icon: Search },
  { href: "/compare", label: "Model Lab", description: "Compare configured models side by side", icon: Columns2 },
  { href: "/runs", label: "Workflows", description: "Launch and inspect autonomous execution", icon: History },
  { href: "/agents", label: "Agents", description: "Configure controlled agent work", icon: Bot },
  { href: "/knowledge", label: "Knowledge", description: "Files, documents and retrieval context", icon: FolderOpen },
  { href: "/memory", label: "Memory", description: "Inspect persistent user context", icon: Brain },
] as const;

function statusTone(ok: boolean | null): string {
  if (ok === true) return "text-emerald-300";
  if (ok === false) return "text-amber-200";
  return "text-[#81868e]";
}

function humanRunStatus(status: string): string {
  return status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (value) => value.toUpperCase());
}

export default function ControlCenterPage() {
  const [state, setState] = useState<LoadState>({
    integrations: null,
    localAi: null,
    runs: null,
    errors: [],
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const errors: string[] = [];

    const readJson = async <T,>(url: string, label: string): Promise<T | null> => {
      try {
        const response = await fetch(url, { cache: "no-store", credentials: "include" });
        const body = (await response.json()) as T & { error?: { message?: string } };
        if (!response.ok) {
          throw new Error(body.error?.message ?? `${label} is unavailable.`);
        }
        return body;
      } catch (error) {
        errors.push(error instanceof Error ? `${label}: ${error.message}` : `${label} is unavailable.`);
        return null;
      }
    };

    const [integrations, localAi, runs] = await Promise.all([
      readJson<IntegrationsPayload>("/api/integrations/status", "Integrations"),
      readJson<LocalAiPayload>("/api/local-ai/status", "Local AI"),
      readJson<RunsPayload>("/api/agents/runs?limit=6", "Agent runtime"),
    ]);

    setState({ integrations, localAi, runs, errors });
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const configuredServices = useMemo(
    () => state.integrations?.integrations.filter((integration) => integration.configured).length ?? 0,
    [state.integrations],
  );
  const totalServices = state.integrations?.integrations.length ?? 0;
  const localReachable = state.localAi?.health?.reachable ?? null;
  const agentReady = state.runs?.feature.ready ?? null;
  const activeRuns = state.runs?.runs.filter((run) => ["QUEUED", "RUNNING", "REVIEW", "INCOMPLETE"].includes(run.status)).length ?? 0;

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-64px)] bg-[#0a0c0f] px-5 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-[1380px]">
            <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b5984c]">
                  <Sparkles className="size-3.5" />
                  AIRA Intelligence OS
                </div>
                <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[#f4f3ee] md:text-[32px]">
                  Control Center
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#858b94]">
                  One operational view across model routing, autonomous execution, local inference, knowledge and memory. Every status below is read from the live AIRA runtime.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#12161b] px-3 text-xs font-medium text-[#aeb3ba] transition hover:border-[#c9a84c]/25 hover:bg-[#171b21] disabled:opacity-50"
              >
                <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh runtime
              </button>
            </div>

            {state.errors.length ? (
              <div className="mb-5 flex gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-xs leading-5 text-amber-100/80" role="status">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-200" />
                <div>
                  <p className="font-semibold text-amber-100">Some runtime telemetry is unavailable</p>
                  <p className="mt-1 text-amber-100/60">{state.errors.join(" · ")}</p>
                </div>
              </div>
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Runtime overview">
              <div className="rounded-2xl border border-white/[0.075] bg-[#0f1318] p-4">
                <div className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-xl bg-[#181d23] text-[#ceb25f]"><Gauge className="size-4" /></span><span className="text-[10px] uppercase tracking-[0.12em] text-[#626972]">Services</span></div>
                <p className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-[#ecece8]">{state.integrations ? `${configuredServices}/${totalServices}` : "—"}</p>
                <p className="mt-1 text-xs text-[#727981]">Configured integrations</p>
              </div>
              <div className="rounded-2xl border border-white/[0.075] bg-[#0f1318] p-4">
                <div className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-xl bg-[#181d23] text-[#ceb25f]"><Cpu className="size-4" /></span><span className={`text-[10px] uppercase tracking-[0.12em] ${statusTone(localReachable)}`}>{localReachable === true ? "Online" : localReachable === false ? "Offline" : "Unknown"}</span></div>
                <p className="mt-5 truncate text-lg font-semibold tracking-[-0.02em] text-[#ecece8]">{state.localAi?.model ?? state.localAi?.health?.model ?? "Local runtime"}</p>
                <p className="mt-1 text-xs text-[#727981]">{state.localAi?.health?.latencyMs != null ? `${state.localAi.health.latencyMs} ms health latency` : "Private inference worker"}</p>
              </div>
              <div className="rounded-2xl border border-white/[0.075] bg-[#0f1318] p-4">
                <div className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-xl bg-[#181d23] text-[#ceb25f]"><Bot className="size-4" /></span><span className={`text-[10px] uppercase tracking-[0.12em] ${statusTone(agentReady)}`}>{agentReady === true ? "Ready" : agentReady === false ? "Unavailable" : "Unknown"}</span></div>
                <p className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-[#ecece8]">{activeRuns}</p>
                <p className="mt-1 text-xs text-[#727981]">Active autonomous runs</p>
              </div>
              <div className="rounded-2xl border border-white/[0.075] bg-[#0f1318] p-4">
                <div className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-xl bg-[#181d23] text-[#ceb25f]"><Activity className="size-4" /></span><span className="text-[10px] uppercase tracking-[0.12em] text-[#626972]">Routing</span></div>
                <p className="mt-5 truncate text-lg font-semibold tracking-[-0.02em] text-[#ecece8]">{state.integrations?.defaults.primaryProvider ?? "—"}</p>
                <p className="mt-1 text-xs text-[#727981]">Primary · fallback {state.integrations?.defaults.fallbackProvider ?? "—"}</p>
              </div>
            </section>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_.8fr]">
              <section className="overflow-hidden rounded-2xl border border-white/[0.075] bg-[#0f1318]">
                <div className="flex items-center justify-between border-b border-white/[0.065] px-5 py-4">
                  <div><h2 className="text-sm font-semibold text-[#eeeeea]">Execution fabric</h2><p className="mt-1 text-xs text-[#707780]">Latest persisted autonomous activity</p></div>
                  <Link href="/runs" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#c8ad5c] hover:text-[#ddc36e]">Open workflows <ArrowUpRight className="size-3.5" /></Link>
                </div>
                {loading && !state.runs ? (
                  <div className="grid min-h-60 place-items-center"><Loader2 className="size-5 animate-spin text-[#b89b4c]" /></div>
                ) : state.runs?.runs.length ? (
                  <ul className="divide-y divide-white/[0.055]">
                    {state.runs.runs.slice(0, 6).map((run) => (
                      <li key={run.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[36px_1fr_auto] sm:items-center">
                        <span className="grid size-9 place-items-center rounded-lg bg-[#181d23] text-[#8f969f]"><Bot className="size-4" /></span>
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs font-semibold text-[#dcddd9]">{run.provider}</strong><span className="rounded-full border border-white/[0.075] px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[#7d848d]">{humanRunStatus(run.status)}</span></div><p className="mt-1 truncate text-xs text-[#747b84]">{run.objective}</p></div>
                        <time className="text-[10px] text-[#5f666e]">{new Date(run.createdAt).toLocaleDateString()}</time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="grid min-h-60 place-items-center px-6 text-center"><div><History className="mx-auto size-5 text-[#59616a]" /><p className="mt-3 text-sm text-[#8a9098]">No persisted runs yet</p><Link href="/runs" className="mt-2 inline-flex text-xs font-medium text-[#c8ad5c]">Start a workflow</Link></div></div>
                )}
              </section>

              <section className="overflow-hidden rounded-2xl border border-white/[0.075] bg-[#0f1318]">
                <div className="border-b border-white/[0.065] px-5 py-4"><h2 className="text-sm font-semibold text-[#eeeeea]">Connected stack</h2><p className="mt-1 text-xs text-[#707780]">Deployment capabilities</p></div>
                {loading && !state.integrations ? (
                  <div className="grid min-h-60 place-items-center"><Loader2 className="size-5 animate-spin text-[#b89b4c]" /></div>
                ) : state.integrations ? (
                  <ul className="divide-y divide-white/[0.055]">
                    {state.integrations.integrations.map((integration) => (
                      <li key={integration.id} className="flex items-center gap-3 px-5 py-3.5">
                        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${integration.configured ? "bg-emerald-400/[0.07] text-emerald-300" : "bg-[#181d23] text-[#666e77]"}`}>{integration.configured ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}</span>
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[#d9dad7]">{integration.label}</p><p className="mt-0.5 truncate text-[10px] text-[#666d75]">{integration.model ?? integration.detail}</p></div>
                        <span className={`size-1.5 rounded-full ${integration.configured ? "bg-emerald-400" : "bg-[#4c535c]"}`} aria-label={integration.configured ? "Configured" : "Not configured"} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="grid min-h-60 place-items-center px-6 text-center text-xs text-[#707780]">Sign in to inspect deployment integrations.</div>
                )}
                <div className="border-t border-white/[0.06] p-3"><Link href="/settings" className="flex h-9 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-[#12161b] text-xs font-medium text-[#999fa7] transition hover:bg-[#171b21] hover:text-[#d8d9d6]"><Settings2 className="size-3.5" />Manage integrations</Link></div>
              </section>
            </div>

            <section className="mt-5">
              <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-sm font-semibold text-[#eeeeea]">Workspace modules</h2><p className="mt-1 text-xs text-[#707780]">Move between AIRA capabilities without leaving the operating shell</p></div></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {MODULES.map((module) => {
                  const Icon = module.icon;
                  return (
                    <Link key={module.href} href={module.href} className="group rounded-2xl border border-white/[0.075] bg-[#0f1318] p-4 transition hover:-translate-y-0.5 hover:border-[#c9a84c]/20 hover:bg-[#12171d]">
                      <div className="flex items-start justify-between gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#181d23] text-[#c6aa57]"><Icon className="size-4" /></span><ArrowUpRight className="size-3.5 text-[#555d66] transition group-hover:text-[#b99c4d]" /></div>
                      <h3 className="mt-4 text-sm font-semibold text-[#e5e5e1]">{module.label}</h3>
                      <p className="mt-1 text-xs leading-5 text-[#717881]">{module.description}</p>
                    </Link>
                  );
                })}
              </div>
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
