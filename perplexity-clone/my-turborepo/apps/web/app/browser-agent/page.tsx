"use client";

import { Loader2, MonitorUp, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { CapabilityGate, type CapabilityState } from "@/components/CapabilityGate";
import surface from "../workspace-surface.module.css";

type LocalStatus = {
  readonly enabled?: boolean;
  readonly configured?: boolean;
  readonly model?: string | null;
  readonly health?: {
    readonly reachable?: boolean;
    readonly status?: string;
    readonly model?: string | null;
    readonly latencyMs?: number | null;
  };
};

export default function BrowserAgentPage() {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/local-ai/status", { credentials: "include", cache: "no-store" });
      const body = (await response.json()) as LocalStatus & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Local runtime status is unavailable.");
      setStatus(body);
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "Local runtime status is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const state = useMemo<CapabilityState>(() => {
    if (loading) return "not-configured";
    if (!status?.enabled || !status.configured) return "not-configured";
    if (status.health?.reachable === false) return "offline";
    return "unsupported";
  }, [loading, status]);

  const detail = useMemo(() => {
    if (loading) return "Checking the real local runtime before exposing browser-agent controls.";
    if (error) return `AIRA could not verify local runtime readiness: ${error}`;
    if (!status?.enabled || !status.configured) return "The private local runtime is not configured for this workspace. Browser execution remains disabled.";
    if (status.health?.reachable === false) return "The configured local runtime is currently unreachable. Browser execution remains disabled until the runtime recovers.";
    const model = status.model ?? status.health?.model;
    return `Local inference is reachable${model ? ` with ${model}` : ""}, but this web deployment does not yet expose a durable browser-session control contract. AIRA will not simulate a viewport or action stream.`;
  }, [error, loading, status]);

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={surface.page}>
          <div className={surface.inner}>
            <CapabilityGate
              eyebrow="Automation"
              title="Browser Agent"
              description="A production-safe workspace for delegated browser execution, approvals and takeover."
              state={state}
              detail={detail}
              actions={[
                { href: "/local-ai", label: "Open Local Runtime" },
                { href: "/settings#integrations", label: "Open Integrations" },
                { href: "/agents", label: "Open Agents" },
              ]}
            >
              <div className={surface.facts} aria-label="Browser agent readiness">
                <div><span>Local runtime</span><strong>{loading ? "Checking…" : status?.health?.reachable ? "Reachable" : status?.configured ? "Unavailable" : "Not configured"}</strong></div>
                <div><span>Model</span><strong>{status?.model ?? status?.health?.model ?? "—"}</strong></div>
                <div><span>Live browser session API</span><strong>Not exposed</strong></div>
              </div>
              <button type="button" className={surface.secondary} onClick={() => void refresh()} disabled={loading}>
                {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                Refresh readiness
              </button>
            </CapabilityGate>

            <section className={surface.note} aria-label="Browser execution contract">
              <MonitorUp className="size-4" aria-hidden />
              <div>
                <strong>Why the live viewport is gated</strong>
                <p>A browser session UI becomes interactive only after the web app has a server-authorized session identifier plus action and approval streams. Until then AIRA intentionally exposes no simulated viewport or takeover controls.</p>
              </div>
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
