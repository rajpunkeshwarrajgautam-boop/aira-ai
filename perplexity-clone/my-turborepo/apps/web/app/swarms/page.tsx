"use client";

import { Bot, CircleAlert, Loader2, RefreshCw, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { CapabilityGate, type CapabilityState } from "@/components/CapabilityGate";
import surface from "../workspace-surface.module.css";

type AgentRun = {
  readonly id: string;
  readonly provider: string;
  readonly objective: string;
  readonly status: string;
  readonly createdAt: string;
};

type RunsPayload = {
  readonly runs?: AgentRun[];
  readonly feature?: { readonly enabled?: boolean; readonly configured?: boolean; readonly ready?: boolean };
  readonly error?: { readonly message?: string };
};

const ACTIVE = new Set(["QUEUED", "RUNNING", "REVIEW", "INCOMPLETE"]);

export default function SwarmsPage() {
  const [payload, setPayload] = useState<RunsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agents/runs?limit=12", { credentials: "include", cache: "no-store" });
      const body = (await response.json()) as RunsPayload;
      if (!response.ok) throw new Error(body.error?.message ?? "Agent orchestration status is unavailable.");
      setPayload(body);
    } catch (cause) {
      setPayload(null);
      setError(cause instanceof Error ? cause.message : "Agent orchestration status is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runs = payload?.runs ?? [];
  const activeRuns = runs.filter((run) => ACTIVE.has(run.status));
  const state = useMemo<CapabilityState>(() => {
    if (loading) return "not-configured";
    if (!payload?.feature?.enabled || !payload.feature.configured) return "not-configured";
    if (!payload.feature.ready) return "offline";
    return "unsupported";
  }, [loading, payload]);

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={surface.page}>
          <div className={surface.inner}>
            <CapabilityGate
              eyebrow="Automation"
              title="Swarm Management"
              description="Coordinate multi-agent work without inventing topology that the runtime does not persist."
              state={state}
              detail={error ?? (payload?.feature?.ready
                ? "The autonomous run fabric is ready and the activity below is live. A durable swarm-membership or dependency-topology contract is not exposed yet, so AIRA does not fabricate a control-room graph."
                : "The autonomous execution fabric must be configured and reachable before swarm coordination can be enabled.")}
              actions={[
                { href: "/agents", label: "Open Agents" },
                { href: "/runs", label: "Open Run Center" },
                { href: "/control-center", label: "Open Control Center" },
              ]}
            >
              <div className={surface.facts} aria-label="Live orchestration facts">
                <div><span>Execution fabric</span><strong>{loading ? "Checking…" : payload?.feature?.ready ? "Ready" : "Unavailable"}</strong></div>
                <div><span>Recent runs</span><strong>{loading ? "—" : runs.length}</strong></div>
                <div><span>Active runs</span><strong>{loading ? "—" : activeRuns.length}</strong></div>
              </div>
              <button type="button" className={surface.secondary} onClick={() => void refresh()} disabled={loading}>
                {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                Refresh orchestration
              </button>
            </CapabilityGate>

            <section className={surface.panel} aria-labelledby="swarm-activity-heading">
              <div className={surface.panelHeader}>
                <div><span>Live data</span><h2 id="swarm-activity-heading">Autonomous activity</h2></div>
                <Workflow className="size-4" aria-hidden />
              </div>
              {loading ? (
                <div className={surface.empty}><div><Loader2 className="size-4 animate-spin" aria-hidden /><p>Loading persisted runs…</p></div></div>
              ) : error ? (
                <div className={surface.empty}><div><CircleAlert className="size-4" aria-hidden /><p>{error}</p></div></div>
              ) : runs.length ? (
                <ul className={surface.runList}>
                  {runs.map((run) => (
                    <li key={run.id}>
                      <span className={surface.runIcon}><Bot className="size-3.5" aria-hidden /></span>
                      <div><strong>{run.provider}</strong><p title={run.objective}>{run.objective}</p></div>
                      <span className={surface.runStatus}>{run.status.toLowerCase().replaceAll("_", " ")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={surface.empty}><div><Bot className="size-4" aria-hidden /><p>No persisted autonomous runs yet.</p></div></div>
              )}
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
