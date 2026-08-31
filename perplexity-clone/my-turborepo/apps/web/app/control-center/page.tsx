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

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { cn } from "@/lib/cn";
import styles from "./control-center.module.css";

type Integration = {
  readonly id: string;
  readonly label: string;
  readonly configured: boolean;
  readonly detail: string;
  readonly model?: string;
};
type IntegrationsPayload = {
  readonly integrations: Integration[];
  readonly defaults: { readonly primaryProvider: string; readonly fallbackProvider: string; readonly localRouting?: string };
};
type LocalAiPayload = {
  readonly enabled?: boolean;
  readonly configured?: boolean;
  readonly model?: string | null;
  readonly models?: string[];
  readonly health?: { readonly reachable?: boolean; readonly status?: string; readonly model?: string | null; readonly latencyMs?: number | null };
};
type AgentRun = { readonly id: string; readonly provider: string; readonly objective: string; readonly status: string; readonly createdAt: string };
type RunsPayload = {
  readonly runs: AgentRun[];
  readonly feature: { readonly enabled: boolean; readonly configured: boolean; readonly ready: boolean; readonly preferredProvider: "DEERFLOW" | "AUTOGPT" | null };
  readonly usage: { readonly billingPlan: string; readonly monthlyAgentRunLimit: number; readonly agentRunsUsed: number; readonly agentRunsRemaining: number };
};
type LoadState = { readonly integrations: IntegrationsPayload | null; readonly localAi: LocalAiPayload | null; readonly runs: RunsPayload | null; readonly errors: string[] };

const MODULES = [
  { href: "/", label: "Research", description: "Grounded answers and citations", icon: Search },
  { href: "/compare", label: "Model Lab", description: "Configured provider comparison", icon: Columns2 },
  { href: "/runs", label: "Run Center", description: "Autonomous execution history", icon: History },
  { href: "/agents", label: "Agents", description: "Controlled delegated work", icon: Bot },
  { href: "/knowledge", label: "Knowledge", description: "Indexed files and ingestion", icon: FolderOpen },
  { href: "/memory", label: "Memory", description: "Persistent user context", icon: Brain },
] as const;

const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING", "REVIEW", "INCOMPLETE"]);

function humanRunStatus(status: string): string {
  return status.toLowerCase().replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

export default function ControlCenterPage() {
  const [state, setState] = useState<LoadState>({ integrations: null, localAi: null, runs: null, errors: [] });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const errors: string[] = [];
    const readJson = async <T,>(url: string, label: string): Promise<T | null> => {
      try {
        const response = await fetch(url, { cache: "no-store", credentials: "include" });
        const body = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
        if (!response.ok || !body) throw new Error(body?.error?.message ?? `${label} is unavailable.`);
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
  const activeRuns = state.runs?.runs.filter((run) => ACTIVE_STATUSES.has(run.status)).length ?? 0;

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={styles.page}>
          <div className={styles.inner}>
            <header className={styles.header}>
              <div>
                <p className={styles.eyebrow}><Sparkles className="size-3.5" aria-hidden />AIRA operations</p>
                <h1 className={styles.title}>Control Center</h1>
                <p className={styles.description}>One operational view across provider configuration, local inference and autonomous execution. Every status shown here is read from a live AIRA endpoint; unavailable telemetry remains explicitly unknown.</p>
              </div>
              <button type="button" onClick={() => void refresh()} disabled={loading} className={styles.button}>
                <RefreshCw className={cn("size-3.5", loading && styles.spin)} aria-hidden /> Refresh runtime
              </button>
            </header>

            {state.errors.length ? (
              <div className={styles.warning} role="status">
                <CircleAlert className="size-4" aria-hidden />
                <div><strong>Some runtime telemetry is unavailable</strong><p>{state.errors.join(" · ")}</p></div>
              </div>
            ) : null}

            <section className={styles.overview} aria-label="Runtime overview">
              <article className={styles.stat}>
                <div className={styles.statHead}><span className={styles.statIcon}><Gauge className="size-4" /></span><span className={styles.statLabel}>Services</span></div>
                <strong className={styles.statValue}>{state.integrations ? `${configuredServices}/${totalServices}` : "—"}</strong>
                <span className={styles.statDetail}>Configured integrations</span>
              </article>
              <article className={styles.stat}>
                <div className={styles.statHead}><span className={styles.statIcon}><Cpu className="size-4" /></span><span className={cn(styles.statLabel, localReachable === true ? styles.good : localReachable === false ? styles.warn : undefined)}>{localReachable === true ? "Online" : localReachable === false ? "Offline" : "Unknown"}</span></div>
                <strong className={styles.statValue}>{state.localAi?.model ?? state.localAi?.health?.model ?? "Local runtime"}</strong>
                <span className={styles.statDetail}>{state.localAi?.health?.latencyMs != null ? `${state.localAi.health.latencyMs} ms health latency` : "Private inference worker"}</span>
              </article>
              <article className={styles.stat}>
                <div className={styles.statHead}><span className={styles.statIcon}><Bot className="size-4" /></span><span className={cn(styles.statLabel, agentReady === true ? styles.good : agentReady === false ? styles.warn : undefined)}>{agentReady === true ? "Ready" : agentReady === false ? "Unavailable" : "Unknown"}</span></div>
                <strong className={styles.statValue}>{activeRuns}</strong>
                <span className={styles.statDetail}>Active autonomous runs</span>
              </article>
              <article className={styles.stat}>
                <div className={styles.statHead}><span className={styles.statIcon}><Activity className="size-4" /></span><span className={styles.statLabel}>Routing</span></div>
                <strong className={styles.statValue}>{state.integrations?.defaults.primaryProvider ?? "—"}</strong>
                <span className={styles.statDetail}>Fallback {state.integrations?.defaults.fallbackProvider ?? "—"}</span>
              </article>
            </section>

            <div className={styles.grid}>
              <section className={styles.panel} aria-label="Execution fabric">
                <header className={styles.panelHeader}>
                  <div><h2>Execution fabric</h2><p>Latest persisted autonomous activity</p></div>
                  <Link href="/runs" className={styles.link}>Open Run Center <ArrowUpRight className="size-3" /></Link>
                </header>
                {loading && !state.runs ? (
                  <div className={styles.empty}><Loader2 className={cn("size-5", styles.spin)} aria-label="Loading run telemetry" /></div>
                ) : state.runs?.runs.length ? (
                  <ul className={styles.list}>
                    {state.runs.runs.slice(0, 6).map((run) => (
                      <li key={run.id} className={styles.run}>
                        <span className={styles.runIcon}><Bot className="size-3.5" aria-hidden /></span>
                        <div className={styles.runCopy}>
                          <div className={styles.runMeta}><strong>{run.provider}</strong><span className={styles.badge}>{humanRunStatus(run.status)}</span></div>
                          <p title={run.objective}>{run.objective}</p>
                        </div>
                        <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleDateString()}</time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={styles.empty}><div><History className="size-5" aria-hidden /><p>No persisted runs yet.</p><Link href="/runs" className={styles.link}>Start a run</Link></div></div>
                )}
              </section>

              <section className={styles.panel} aria-label="Connected stack">
                <header className={styles.panelHeader}><div><h2>Connected stack</h2><p>Deployment capability state</p></div></header>
                {loading && !state.integrations ? (
                  <div className={styles.empty}><Loader2 className={cn("size-5", styles.spin)} aria-label="Loading integrations" /></div>
                ) : state.integrations ? (
                  <ul className={styles.list}>
                    {state.integrations.integrations.map((integration) => (
                      <li key={integration.id} className={styles.service}>
                        <span className={cn(styles.serviceIcon, integration.configured && styles.serviceOn)}>{integration.configured ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}</span>
                        <div className={styles.serviceCopy}><strong>{integration.label}</strong><span>{integration.model ?? integration.detail}</span></div>
                        <span className={cn(styles.dot, integration.configured && styles.dotOn)} aria-label={integration.configured ? "Configured" : "Not configured"} />
                      </li>
                    ))}
                  </ul>
                ) : <div className={styles.empty}>Integration telemetry unavailable.</div>}
                <div className={styles.panelFooter}><Link href="/settings#integrations" className={styles.link}><Settings2 className="size-3.5" />Open integration settings</Link></div>
              </section>
            </div>

            <nav className={styles.moduleGrid} aria-label="AIRA operational workspaces">
              {MODULES.map((module) => {
                const Icon = module.icon;
                return <Link key={module.href} href={module.href} className={styles.module}><span className={styles.moduleIcon}><Icon className="size-4" /></span><span className={styles.moduleCopy}><strong>{module.label}</strong><span>{module.description}</span></span></Link>;
              })}
            </nav>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
