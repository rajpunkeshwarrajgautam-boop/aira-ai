"use client";

import { Cpu, ShieldCheck } from "lucide-react";

import { agentProviderLabel, type AgentDashboard } from "@/src/v2/compat/aira-api";

export function AgentRuntimeStatusStrip({ dashboard }: { readonly dashboard: AgentDashboard | null }) {
  const providers = Object.entries(dashboard?.feature?.providers ?? {});
  if (providers.length === 0) return null;

  return (
    <section className="v2-runtime-strip" aria-label="Autonomous runtime availability">
      <div className="v2-runtime-strip-title"><Cpu aria-hidden /><span>Runtime compatibility</span></div>
      <div className="v2-runtime-strip-providers">
        {providers.map(([provider, state]) => (
          <div key={provider} data-ready={state.ready === true ? "true" : "false"}>
            <span className="v2-runtime-state" aria-hidden />
            <strong>{agentProviderLabel(provider)}</strong>
            <small>
              {state.ready
                ? "ready"
                : state.configured
                  ? state.healthy === false
                    ? "unhealthy"
                    : "configured"
                  : state.enabled
                    ? "not configured"
                    : "off"}
            </small>
          </div>
        ))}
      </div>
      <p><ShieldCheck aria-hidden /> V2 consumes the backend provider contract generically, including AAE when that provider is enabled by the existing AIRA backend.</p>
    </section>
  );
}
