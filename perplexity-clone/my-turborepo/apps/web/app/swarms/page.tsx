import type { Metadata } from "next";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { CapabilityGate, type CapabilityState } from "@/components/CapabilityGate";
import { SwarmWorkspace } from "@/components/swarms/SwarmWorkspace";
import { getAgentRuntimeStates } from "@/lib/agent-runtime/registry";

export const metadata: Metadata = {
  title: "Swarms — AIRA AI",
  description: "Multi-agent missions dispatched through the persisted AGENT_SWARM runtime.",
};

export default async function SwarmsPage() {
  let state: CapabilityState = "offline";
  let detail = "AIRA could not confirm Agent Swarm health. Swarm launch remains disabled until the external runtime can be verified.";
  let ready = false;

  try {
    const runtimes = await getAgentRuntimeStates();
    const swarm = runtimes.find((runtime) => runtime.id === "AGENT_SWARM");
    ready = swarm?.ready === true;
    if (!ready) {
      state = swarm?.configured ? "offline" : "not-configured";
      detail = swarm?.configured
        ? "Agent Swarm is configured but does not currently report ready. AIRA will not create a swarm project or simulate multi-agent execution while the runtime is unavailable."
        : "Agent Swarm requires a real external execution host plus server-only runtime credentials. No ready Agent Swarm runtime is configured for this deployment.";
    }
  } catch {
    ready = false;
  }

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        {ready ? (
          <SwarmWorkspace />
        ) : (
          <CapabilityGate
            eyebrow="Swarm orchestration"
            title="Agent Swarm is not ready"
            description="Swarms dispatch only through the persisted AGENT_SWARM execution runtime. AIRA does not synthesize worker participation in the browser."
            state={state}
            detail={detail}
            actions={[
              { href: "/work", label: "Use Work planning" },
              { href: "/projects", label: "Manage projects" },
            ]}
          />
        )}
      </AiraV2Frame>
    </div>
  );
}
