"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Loader2,
  Play,
  RotateCw,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  agentArtifactHref,
  agentArtifactPaths,
  agentResultText,
  cancelAgentRun,
  getAgentDashboard,
  startAgentRun,
  syncAgentRun,
  type AgentDashboard,
  type AgentRun,
  type AgentRunStatus,
} from "@/src/v2/compat/aira-api";

const ACTIVE = new Set<AgentRunStatus>(["QUEUED", "RUNNING", "REVIEW"]);

function isActive(run: AgentRun): boolean {
  return ACTIVE.has(run.status);
}

function runIcon(status: AgentRunStatus) {
  if (status === "COMPLETED") return CheckCircle2;
  if (status === "FAILED" || status === "TERMINATED") return AlertCircle;
  if (status === "RUNNING") return Loader2;
  return Clock3;
}

function formatWhen(iso: string): string {
  const value = new Date(iso).getTime();
  if (!Number.isFinite(value)) return "";
  const minutes = Math.floor((Date.now() - value) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function artifactName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "Artifact";
}

function providerName(provider: string): string {
  if (provider === "DEERFLOW") return "DeerFlow 2.0";
  if (provider === "AUTOGPT") return "AutoGPT";
  if (provider === "AAE") return "AIRA Agent Engine";
  return provider;
}

export function AgentWorkspacePanel({
  authenticated,
  dashboard,
  onDashboardChange,
}: {
  readonly authenticated: boolean;
  readonly dashboard: AgentDashboard | null;
  readonly onDashboardChange: (dashboard: AgentDashboard | null) => void;
}) {
  const [objective, setObjective] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const runs = dashboard?.runs ?? [];
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );
  const artifacts = useMemo(
    () => (selectedRun ? agentArtifactPaths(selectedRun.result) : []),
    [selectedRun],
  );
  const resultText = selectedRun ? agentResultText(selectedRun.result) : null;

  useEffect(() => {
    if (!selectedRunId && runs[0]) setSelectedRunId(runs[0].id);
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? null);
    }
  }, [runs, selectedRunId]);

  const refresh = useCallback(async () => {
    if (!authenticated) return;
    setRefreshing(true);
    try {
      onDashboardChange(await getAgentDashboard());
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Agent activity could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }, [authenticated, onDashboardChange]);

  const activeIds = useMemo(
    () => runs.filter(isActive).slice(0, 6).map((run) => run.id),
    [runs],
  );

  useEffect(() => {
    if (activeIds.length === 0) return;
    const timer = window.setInterval(() => {
      void Promise.all(
        activeIds.map(async (runId) => {
          try {
            const synced = await syncAgentRun(runId);
            setSyncWarning(synced.syncWarning ?? null);
            onDashboardChange(
              dashboard
                ? {
                    ...dashboard,
                    runs: dashboard.runs.map((run) =>
                      run.id === synced.run.id ? synced.run : run,
                    ),
                  }
                : dashboard,
            );
          } catch {
            // The next poll or a manual refresh will retry. Existing server state remains authoritative.
          }
        }),
      );
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [activeIds, dashboard, onDashboardChange]);

  const start = useCallback(async () => {
    const trimmed = objective.trim();
    if (trimmed.length < 3 || submitting) return;
    setSubmitting(true);
    setError(null);
    setSyncWarning(null);
    try {
      const created = await startAgentRun(trimmed);
      const current = dashboard ?? (await getAgentDashboard());
      onDashboardChange({
        ...current,
        runs: [created.run, ...current.runs.filter((run) => run.id !== created.run.id)],
        usage: current.usage
          ? {
              ...current.usage,
              ...(typeof created.agentRunsRemaining === "number"
                ? {
                    agentRunsRemaining: created.agentRunsRemaining,
                    agentRunsUsed: Math.max(
                      current.usage.agentRunsUsed ?? 0,
                      (current.usage.monthlyAgentRunLimit ?? 0) - created.agentRunsRemaining,
                    ),
                  }
                : {}),
            }
          : current.usage,
      });
      setSelectedRunId(created.run.id);
      setObjective("");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "The autonomous task could not be started.");
    } finally {
      setSubmitting(false);
    }
  }, [dashboard, objective, onDashboardChange, submitting]);

  const cancel = useCallback(async () => {
    if (!selectedRun || !isActive(selectedRun) || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const cancelled = await cancelAgentRun(selectedRun.id);
      if (dashboard) {
        onDashboardChange({
          ...dashboard,
          runs: dashboard.runs.map((run) =>
            run.id === cancelled.run.id ? cancelled.run : run,
          ),
        });
      }
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "The task could not be stopped.");
    } finally {
      setCancelling(false);
    }
  }, [cancelling, dashboard, onDashboardChange, selectedRun]);

  if (!authenticated) {
    return (
      <section className="v2-module-page">
        <div className="v2-module-heading">
          <div><p className="v2-eyebrow">AUTONOMOUS WORK</p><h1>Agents</h1></div>
        </div>
        <div className="v2-empty-card">
          <strong>Sign in to run autonomous tasks.</strong>
          <p>The existing AIRA backend owns agent authorization, plan limits, safety checks, and execution.</p>
        </div>
      </section>
    );
  }

  const remaining = dashboard?.usage?.agentRunsRemaining;
  const ready = dashboard?.feature?.ready === true;
  const planAllows = (dashboard?.usage?.monthlyAgentRunLimit ?? 0) > 0;
  const canStart = ready && planAllows && (remaining ?? 0) > 0;
  const canCancel = Boolean(selectedRun && isActive(selectedRun) && selectedRun.provider !== "AUTOGPT");

  return (
    <section className="v2-module-page v2-agent-workspace">
      <div className="v2-module-heading">
        <div>
          <p className="v2-eyebrow">AUTONOMOUS WORK</p>
          <h1>Agents</h1>
        </div>
        <button className="v2-text-action" type="button" onClick={() => void refresh()} disabled={refreshing}>
          <RotateCw className={refreshing ? "spin" : ""} aria-hidden /> Refresh
        </button>
      </div>

      <div className="v2-agent-launch">
        <div className="v2-agent-launch-head">
          <div>
            <span className={`v2-runtime-state ${ready ? "ready" : ""}`} />
            <strong>{dashboard?.feature?.preferredProvider ? providerName(dashboard.feature.preferredProvider) : "No runtime ready"}</strong>
          </div>
          <span>{typeof remaining === "number" ? `${remaining} runs remaining` : "Plan usage unavailable"}</span>
        </div>
        <textarea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="Describe an outcome. AIRA will plan, use tools, execute, and return verifiable results…"
          rows={3}
          maxLength={4000}
          disabled={submitting || !canStart}
          aria-label="Autonomous task objective"
        />
        <div className="v2-agent-launch-foot">
          <span>{!ready ? "Agent runtime is currently unavailable." : !planAllows ? "Your current plan does not include agent runs." : remaining === 0 ? "Monthly agent limit reached." : "Execution remains behind AIRA safety and quota controls."}</span>
          <button type="button" onClick={() => void start()} disabled={!canStart || submitting || objective.trim().length < 3}>
            {submitting ? <Loader2 className="spin" aria-hidden /> : <Play aria-hidden />}
            Start task
          </button>
        </div>
      </div>

      {error ? <div className="v2-error"><strong>Agent action failed</strong><span>{error}</span></div> : null}
      {syncWarning ? <div className="v2-warning">{syncWarning}</div> : null}

      <div className="v2-agent-grid">
        <div className="v2-agent-run-list" aria-label="Agent runs">
          <div className="v2-panel-title"><span>Runs</span><small>{runs.length}</small></div>
          {runs.length === 0 ? <div className="v2-panel-empty">No agent runs yet.</div> : runs.map((run) => {
            const Icon = runIcon(run.status);
            return (
              <button key={run.id} type="button" data-active={selectedRun?.id === run.id} onClick={() => setSelectedRunId(run.id)}>
                <Icon className={run.status === "RUNNING" ? "spin" : ""} aria-hidden />
                <div>
                  <strong>{run.objective}</strong>
                  <span>{providerName(run.provider)} · {run.status.toLowerCase()}</span>
                </div>
                <time>{formatWhen(run.updatedAt)}</time>
              </button>
            );
          })}
        </div>

        <div className="v2-agent-detail">
          <div className="v2-panel-title">
            <span>Run details</span>
            {selectedRun ? <small>{selectedRun.status.toLowerCase()}</small> : null}
          </div>
          {!selectedRun ? <div className="v2-panel-empty">Select a run to inspect it.</div> : (
            <div className="v2-agent-detail-body">
              <div className="v2-agent-objective-copy">
                <span>Objective</span>
                <strong>{selectedRun.objective}</strong>
              </div>
              <div className="v2-agent-metadata">
                <div><span>Runtime</span><strong>{providerName(selectedRun.provider)}</strong></div>
                <div><span>Updated</span><strong>{formatWhen(selectedRun.updatedAt)}</strong></div>
              </div>

              {isActive(selectedRun) ? (
                <div className="v2-agent-active-state">
                  <Loader2 className="spin" aria-hidden />
                  <div><strong>AIRA is working</strong><span>Status refreshes automatically.</span></div>
                  {canCancel ? (
                    <button type="button" onClick={() => void cancel()} disabled={cancelling}>
                      <Square aria-hidden /> {cancelling ? "Stopping…" : "Stop"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {selectedRun.errorMessage ? (
                <div className="v2-error"><strong>Run error</strong><span>{selectedRun.errorMessage}</span></div>
              ) : null}

              {resultText ? (
                <div className="v2-agent-result">
                  <span>Result</span>
                  <pre>{resultText}</pre>
                </div>
              ) : null}

              {artifacts.length > 0 ? (
                <div className="v2-agent-artifacts">
                  <span>Artifacts</span>
                  {artifacts.map((path) => (
                    <a key={path} href={agentArtifactHref(selectedRun.id, path)}>
                      <FileText aria-hidden />
                      <span>{artifactName(path)}</span>
                      <Download aria-hidden />
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
