"use client";

import { Bot, Loader2, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { cn } from "@/lib/cn";
import styles from "./runs.module.css";

type AgentRun = {
  readonly id: string;
  readonly provider: string;
  readonly objective: string;
  readonly status: string;
  readonly result: unknown | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
};
type Payload = {
  readonly runs: AgentRun[];
  readonly feature: {
    readonly enabled: boolean;
    readonly configured: boolean;
    readonly ready: boolean;
    readonly preferredProvider: "DEERFLOW" | "AUTOGPT" | null;
    readonly providers: Record<string, { enabled: boolean; configured: boolean; healthy: boolean | null; ready: boolean }>;
  };
  readonly usage: {
    readonly billingPlan: string;
    readonly monthlyAgentRunLimit: number;
    readonly agentRunsUsed: number;
    readonly agentRunsRemaining: number;
  };
};

type ProviderChoice = "AUTO" | "DEERFLOW" | "AUTOGPT";
const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING", "REVIEW", "INCOMPLETE"]);

function statusClass(status: string): string {
  if (["COMPLETED"].includes(status)) return styles.statusSuccess;
  if (["FAILED", "TERMINATED", "CANCELLED"].includes(status)) return styles.statusDanger;
  if (["REVIEW", "INCOMPLETE"].includes(status)) return styles.statusReview;
  if (["QUEUED", "RUNNING"].includes(status)) return styles.statusActive;
  return "";
}

function dateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

export default function RunsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [objective, setObjective] = useState("");
  const [provider, setProvider] = useState<ProviderChoice>("AUTO");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agents/runs?limit=50", {
        cache: "no-store",
        credentials: "include",
      });
      const body = (await response.json()) as Payload & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load agent runs.");
      setData(body);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load agent runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!data?.runs.some((run) => ACTIVE_STATUSES.has(run.status))) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [data, refresh]);

  async function startRun() {
    if (objective.trim().length < 3) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/agents/runs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          objective: objective.trim(),
          ...(provider === "AUTO" ? {} : { provider }),
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Agent run could not be started.");
      setObjective("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agent run could not be started.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={styles.page}>
          <div className={styles.inner}>
            <header className={styles.header}>
              <div>
                <p className={styles.eyebrow}>Agent operations</p>
                <h1 className={styles.title}>Run Center</h1>
                <p className={styles.description}>
                  Launch autonomous objectives, inspect the actual runtime readiness and quota, and monitor every persisted run from one operational view.
                </p>
              </div>
              <button type="button" onClick={() => void refresh()} disabled={loading} className={styles.button}>
                <RefreshCw className={cn("size-3.5", loading && styles.spin)} aria-hidden /> Refresh
              </button>
            </header>

            {message ? <p className={styles.alert} role="alert">{message}</p> : null}

            {loading || !data ? (
              <div className={styles.loading}><Loader2 className={cn("size-5", styles.spin)} aria-label="Loading agent runs" /></div>
            ) : (
              <>
                <section className={styles.topGrid}>
                  <div className={styles.panel}>
                    <h2 className={styles.panelTitle}>Assign autonomous work</h2>
                    <p className={styles.panelNote}>Describe the deliverable, constraints, and stopping condition. AIRA submits the objective to a real configured agent runtime.</p>
                    <textarea
                      value={objective}
                      onChange={(event) => setObjective(event.target.value)}
                      rows={4}
                      placeholder="Example: Research three competitors, compare positioning and pricing, and return a concise sourced report. Stop after the final report is produced."
                      className={styles.textarea}
                    />
                    <div className={styles.formFooter}>
                      <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderChoice)} className={styles.select} aria-label="Agent runtime">
                        <option value="AUTO">Auto-select runtime</option>
                        <option value="DEERFLOW">DeerFlow</option>
                        <option value="AUTOGPT">AutoGPT</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void startRun()}
                        disabled={submitting || objective.trim().length < 3 || !data.feature.ready}
                        className={styles.primary}
                      >
                        {submitting ? <Loader2 className={cn("size-4", styles.spin)} aria-hidden /> : <Play className="size-4" aria-hidden />}
                        {submitting ? "Starting…" : "Start run"}
                      </button>
                    </div>
                  </div>

                  <aside className={styles.panel} aria-label="Agent runtime status">
                    <h2 className={styles.panelTitle}>Runtime</h2>
                    <p className={styles.panelNote}>Current server-reported availability and plan allowance.</p>
                    <dl className={styles.facts}>
                      <div className={styles.fact}><dt>Status</dt><dd className={data.feature.ready ? styles.good : styles.warn}>{data.feature.ready ? "Ready" : "Unavailable"}</dd></div>
                      <div className={styles.fact}><dt>Preferred</dt><dd>{data.feature.preferredProvider ?? "None"}</dd></div>
                      <div className={styles.fact}><dt>Plan</dt><dd>{data.usage.billingPlan}</dd></div>
                      <div className={styles.fact}><dt>Runs remaining</dt><dd>{data.usage.agentRunsRemaining} / {data.usage.monthlyAgentRunLimit}</dd></div>
                    </dl>
                  </aside>
                </section>

                <section className={styles.library} aria-label="Agent run history">
                  <div className={styles.libraryHeader}>
                    <h2>Run history</h2>
                    <span>{data.runs.length} persisted {data.runs.length === 1 ? "run" : "runs"}</span>
                  </div>
                  <div className={styles.tableHeader} aria-hidden>
                    <span>Runtime</span><span>Objective</span><span>Status</span><span>Started</span>
                  </div>
                  {data.runs.length ? (
                    <div role="list">
                      {data.runs.map((run) => (
                        <article key={run.id} role="listitem" className={styles.row}>
                          <div className={styles.provider}>
                            <span className={styles.providerIcon}><Bot className="size-4" aria-hidden /></span>
                            <span>{run.provider}</span>
                          </div>
                          <div className={styles.objective}>
                            <strong title={run.objective}>{run.objective}</strong>
                            {run.errorMessage ? <small title={run.errorMessage}>{run.errorMessage}</small> : null}
                          </div>
                          <span className={cn(styles.status, statusClass(run.status))}>{run.status}</span>
                          <time className={styles.time} dateTime={run.createdAt}>{dateTime(run.createdAt)}</time>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.empty}>No persisted agent runs yet. Assign an objective above when a runtime is ready.</div>
                  )}
                </section>
              </>
            )}
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
