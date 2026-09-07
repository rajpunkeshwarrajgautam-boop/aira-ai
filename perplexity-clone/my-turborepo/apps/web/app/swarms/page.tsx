import type { Metadata } from "next";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { SwarmWorkspace } from "@/components/swarms/SwarmWorkspace";

export const metadata: Metadata = {
  title: "Swarms — AIRA AI",
  description: "Multi-agent missions dispatched through the persisted AGENT_SWARM runtime.",
};

export default function SwarmsPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <SwarmWorkspace />
      </AiraV2Frame>
    </div>
  );
}
