"use client";

import {
  Activity,
  ArrowUpRight,
  Bot,
  Brain,
  CheckCircle2,
  CircleAlert,
  Columns2,
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
    omniRouteModel?: string;
  };
};

type OmniRoutePayload = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  model: string;
  modelCount: number;
  latencyMs?: number;
  gatewayHost?: string | null;
  checkedAt: string;
  version?: string;
  message?: string;
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
  omniRoute: OmniRoutePayload | null;
  runs: RunsPayload | null;
  errors: string[];
};

const MODULES = [
  { href: "/", label: "Research", description: "Live web research with grounded citations", icon: Search },
  { href: "/compare", label: "Model Lab", description: "Compare configured models side by side", icon: Columns2 },
  { href: "/workflows", label: "Workflows", description: "Build and inspect durable automation routines", icon: History },
  { href: "/agents", label: "Agents", description: "Configure controlled agent work", icon: Bot },
  { href: "/knowledge", label: "Knowledge", description: "Files, documents and retrieval context", icon: FolderOpen },
  { href: "/memory", label: "Memory", description: "Inspect persistent user context", icon: Brain },
] as const;

function statusTone(ok: boolean | null): string {
  if (ok === true) return "text-emerald-700 font-semibold";
  if (ok === false) return "text-amber-700 font-semibold";
  return "text-[#6B6A75]";
}

function humanRunStatus(status: string): string {
  return status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (value) => value.toUpperCase());
}

function omniRouteStatus(payload: OmniRoutePayload | null): string {
  if (!payload) return "Unknown";
  if (!payload.configured) return "Not configured";
  return payload.connected ? "Connected" : "Unavailable";
}

export default function ControlCenterPage() {
  const [state, setState] = useState<LoadState>({
    integrations: null,
    omniRoute: null,
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
        if (!response.ok) throw new Error(body.error?.message ?? `${label} is unavailable.`);
        return body;
      } catch (error) {
        errors.push(error instanceof Error ? `${label}: ${error.message}` : `${label} is unavailable.`);
        return null;
      }
    };

    const [integrations, omniRoute, runs] = await Promise.all([
      readJson<IntegrationsPayload>("/api/integrations/status", "Integrations"),
      readJson<OmniRoutePayload>("/api/omniroute/status", "OmniRoute"),
      readJson<RunsPayload>("/api/agents/runs?limit=6", "Agent runtime"),
    ]);

    setState({ integrations, omniRoute, runs, errors });
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
  const omniConnected = state.omniRoute?.connected ?? null;
  const agentReady = state.runs?.feature.ready ?? null;
  const activeRuns = state.runs?.runs.filter((run) => ["QUEUED", "RUNNING", "REVIEW", "INCOMPLETE"].includes(run.status)).length ?? 0;

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-64px)] bg-[var(--aira-canvas,#F9F8F6)] px-5 py-6 text-[#111115] md:px-8 md:py-8">
          <div className="mx-auto max-w-[1380px]">
            <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3A0CA3]">
                  <Sparkles className="size-3.5" />
                  AIRA Intelligence OS
                </div>
                <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[#111115] md:text-[32px]">Control Center</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B6A75]">
                  One operational view across model routing, autonomous execution, integrations, knowledge and memory. Runtime availability is reported only from live health assertions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 text-xs font-medium text-[#111115] shadow-xs transition hover:bg-[#FAF9F6] disabled:opacity-50"
              >
                <RefreshCw className={`size-3.5 ${loading ? "animate-spin text-[#3A0CA3]" : ""}`} />
                Refresh runtime
              </button>
            </div>

            {state.errors.length ? (
              <div className="mb-5 flex gap-3 rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900" role="status">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />
                <div>
                  <p className="font-semibold text-amber-900">Some runtime telemetry is unavailable</p>
                  <p className="mt-1 text-amber-800/80">{state.errors.join(" · ")}</p>
                </div>
              </div>
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Runtime overview">
              <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-xl bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]"><Gauge className="size-4" /></span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[#6B6A75]">Configured</span>
                </div>
                <p className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-[#111115]">{state.integrations ? `${configuredServices}/${totalServices}` : "—"}</p>
                <p className="mt-1 text-xs text-[#6B6A75]">Deployment integrations</p>
              </div>

              <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-xl bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]"><Activity className="size-4" /></span>
                  <span className={`text-[10px] uppercase tracking-[0.12em] ${statusTone(omniConnected)}`}>{omniRouteStatus(state.omniRoute)}</span>
                </div>
                <p className="mt-5 truncate text-lg font-semibold tracking-[-0.02em] text-[#111115]">{state.omniRoute?.model ?? "OmniRoute"}</p>
                <p className="mt-1 text-xs text-[#6B6A75]">
                  {state.omniRoute?.connected
                    ? `${state.omniRoute.modelCount} models${state.omniRoute.latencyMs != null ? ` · ${state.omniRoute.latencyMs} ms` : ""}`
                    : state.omniRoute?.message ?? "Live gateway health not established"}
                </p>
              </div>

              <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-xl bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]"><Bot className="size-4" /></span>
                  <span className={`text-[10px] uppercase tracking-[0.12em] ${statusTone(agentReady)}`}>{agentReady === true ? "Ready" : agentReady === false ? "Unavailable" : "Unknown"}</span>
                </div>
                <p className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-[#111115]">{activeRuns}</p>
                <p className="mt-1 text-xs text-[#6B6A75]">Active autonomous runs</p>
              </div>

              <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-xl bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]"><Activity className="size-4" /></span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[#6B6A75]">Routing policy</span>
                </div>
                <p className="mt-5 truncate text-lg font-semibold tracking-[-0.02em] text-[#111115]">{state.integrations?.defaults.primaryProvider ?? "—"}</p>
                <p className="mt-1 text-xs text-[#6B6A75]">Fallback · {state.integrations?.defaults.fallbackProvider ?? "—"}</p>
              </div>
            </section>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_.8fr]">
              <section className="overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs">
                <div className="flex items-center justify-between border-b border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-5 py-4">
                  <div>
                    <h2 className="text-sm font-semibold text-[#111115]">Execution fabric</h2>
                    <p className="mt-1 text-xs text-[#6B6A75]">Latest persisted autonomous activity</p>
                  </div>
                  <Link href="/workflows" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#3A0CA3] hover:underline">Open workflows <ArrowUpRight className="size-3.5" /></Link>
                </div>
                {loading && !state.runs ? (
                  <div className="grid min-h-60 place-items-center"><Loader2 className="size-5 animate-spin text-[#3A0CA3]" /></div>
                ) : state.runs?.runs.length ? (
                  <ul className="divide-y divide-[rgba(17,17,21,0.06)]">
                    {state.runs.runs.slice(0, 6).map((run) => (
                      <li key={run.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[36px_1fr_auto] sm:items-center">
                        <span className="grid size-9 place-items-center rounded-lg bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]"><Bot className="size-4" /></span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-xs font-semibold text-[#111115]">{run.provider}</strong>
                            <span className="rounded-full border border-[rgba(17,17,21,0.1)] bg-[#FAF9F6] px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[#6B6A75]">{humanRunStatus(run.status)}</span>
                          </div>
                          <p className="mt-1 truncate text-xs text-[#6B6A75]">{run.objective}</p>
                        </div>
                        <time className="text-[10px] text-[#8F8E98]">{new Date(run.createdAt).toLocaleDateString()}</time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="grid min-h-60 place-items-center px-6 text-center">
                    <div>
                      <History className="mx-auto size-5 text-[#8F8E98]" />
                      <p className="mt-3 text-sm text-[#6B6A75]">No persisted runs yet</p>
                      <Link href="/workflows" className="mt-2 inline-flex text-xs font-semibold text-[#3A0CA3] hover:underline">Start a workflow</Link>
                    </div>
                  </div>
                )}
              </section>

              <section className="overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs">
                <div className="border-b border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-5 py-4">
                  <h2 className="text-sm font-semibold text-[#111115]">Configured stack</h2>
                  <p className="mt-1 text-xs text-[#6B6A75]">Configuration state only; live health is asserted separately</p>
                </div>
                {loading && !state.integrations ? (
                  <div className="grid min-h-60 place-items-center"><Loader2 className="size-5 animate-spin text-[#3A0CA3]" /></div>
                ) : state.integrations ? (
                  <ul className="divide-y divide-[rgba(17,17,21,0.06)]">
                    {state.integrations.integrations.map((integration) => (
                      <li key={integration.id} className="flex items-center gap-3 px-5 py-3.5">
                        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${integration.configured ? "bg-emerald-50 text-emerald-700" : "bg-[#FAF9F6] text-[#8F8E98]"}`}>
                          {integration.configured ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-[#111115]">{integration.label}</p>
                          <p className="mt-0.5 truncate text-[10px] text-[#6B6A75]">{integration.model ?? integration.detail}</p>
                        </div>
                        <span className="text-[9px] uppercase tracking-[0.08em] text-[#6B6A75]">{integration.configured ? "Configured" : "Not configured"}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="grid min-h-60 place-items-center px-6 text-center text-xs text-[#6B6A75]">Sign in to inspect deployment integrations.</div>
                )}
                <div className="border-t border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3">
                  <Link href="/settings" className="flex h-9 items-center justify-center gap-2 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white text-xs font-medium text-[#111115] shadow-xs transition hover:bg-[#FAF9F6]">
                    <Settings2 className="size-3.5" />Manage integrations
                  </Link>
                </div>
              </section>
            </div>

            <section className="mt-5">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[#111115]">Workspace modules</h2>
                  <p className="mt-1 text-xs text-[#6B6A75]">Move between AIRA capabilities without leaving the operating shell</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {MODULES.map((module) => {
                  const Icon = module.icon;
                  return (
                    <Link key={module.href} href={module.href} className="group rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-[#3A0CA3]/30 hover:shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid size-9 place-items-center rounded-xl bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]"><Icon className="size-4" /></span>
                        <ArrowUpRight className="size-3.5 text-[#8F8E98] transition group-hover:text-[#3A0CA3]" />
                      </div>
                      <h3 className="mt-4 text-sm font-semibold text-[#111115]">{module.label}</h3>
                      <p className="mt-1 text-xs leading-5 text-[#6B6A75]">{module.description}</p>
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
