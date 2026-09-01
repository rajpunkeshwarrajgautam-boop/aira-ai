import { Boxes, FileText, FolderOpen, History } from "lucide-react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { CapabilityGate } from "@/components/CapabilityGate";
import surface from "../workspace-surface.module.css";

export default function ProjectsPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={surface.page}>
          <div className={surface.inner}>
            <CapabilityGate
              eyebrow="Workspace"
              title="Project Hub"
              description="Projects should become durable containers for context, agents, execution and artifacts only after ownership and authorization are real."
              state="unsupported"
              detail="AIRA already persists knowledge, conversations, autonomous runs and run artifacts, but the current server does not expose a durable Project entity that owns those resources. Create/edit project controls remain intentionally unavailable until that contract exists."
              actions={[
                { href: "/knowledge", label: "Open Knowledge" },
                { href: "/agents", label: "Open Agents" },
                { href: "/runs", label: "Open Run Center" },
              ]}
            >
              <div className={surface.facts} aria-label="Project Hub backing capabilities">
                <div><span>Knowledge context</span><strong>Available</strong></div>
                <div><span>Agent runs</span><strong>Available</strong></div>
                <div><span>Durable Project entity</span><strong>Not implemented</strong></div>
              </div>
            </CapabilityGate>

            <section className={surface.panel} aria-labelledby="project-foundation-heading">
              <div className={surface.panelHeader}>
                <div><span>Existing foundation</span><h2 id="project-foundation-heading">Project-ready capabilities</h2></div>
                <Boxes className="size-4" aria-hidden />
              </div>
              <div className={surface.featureGrid}>
                <article><FolderOpen className="size-4" aria-hidden /><strong>Knowledge</strong><p>Files and retrieval context already live in an authenticated knowledge workspace.</p></article>
                <article><History className="size-4" aria-hidden /><strong>Execution</strong><p>Autonomous runs already persist objectives, providers, status and outputs.</p></article>
                <article><FileText className="size-4" aria-hidden /><strong>Artifacts</strong><p>Run artifacts can be downloaded without inventing project ownership.</p></article>
              </div>
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
