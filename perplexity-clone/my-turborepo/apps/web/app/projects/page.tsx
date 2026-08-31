import { Boxes, FileText, FolderOpen, History } from "lucide-react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { CapabilityGate } from "@/components/CapabilityGate";

export default function ProjectsPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="aira-os-page">
          <div className="aira-os-page__inner">
            <CapabilityGate
              eyebrow="Automation"
              title="Project Hub"
              description="The Stitch Project Hub is the intended container for context, agents, workflows, activity and artifacts."
              state="unsupported"
              detail="AIRA already persists the underlying knowledge, conversations, autonomous runs and artifacts, but this branch does not yet expose a durable Project entity that owns those resources. Create/edit project controls remain disabled until ownership, authorization and migration semantics are defined server-side."
              actions={[
                { href: "/knowledge", label: "Open Knowledge" },
                { href: "/agents", label: "Open Agents" },
                { href: "/runs", label: "Open Workflows" },
              ]}
            >
              <div className="aira-capability-facts" aria-label="Project Hub backing capabilities">
                <div><span>Knowledge context</span><strong>Available</strong></div>
                <div><span>Agent runs</span><strong>Available</strong></div>
                <div><span>Durable Project entity</span><strong>Not implemented</strong></div>
              </div>
            </CapabilityGate>

            <section className="aira-os-panel" aria-labelledby="project-foundation-heading">
              <div className="aira-os-panel__header"><div><span>Existing foundation</span><h2 id="project-foundation-heading">Project-ready capabilities</h2></div><Boxes className="size-4" aria-hidden /></div>
              <div className="aira-os-feature-grid">
                <article><FolderOpen className="size-4" aria-hidden /><strong>Knowledge</strong><p>Files and retrieval context already have a dedicated authenticated workspace.</p></article>
                <article><History className="size-4" aria-hidden /><strong>Execution</strong><p>Autonomous runs already persist objectives, provider state and artifacts.</p></article>
                <article><FileText className="size-4" aria-hidden /><strong>Artifacts</strong><p>Run artifacts can be inspected without inventing project ownership.</p></article>
              </div>
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}