"use client";

import { Download, FileText, FolderOpen, RotateCw } from "lucide-react";
import { useMemo } from "react";

import {
  agentArtifactHref,
  agentArtifactPaths,
  type AgentDashboard,
} from "@/src/v2/compat/aira-api";

function artifactName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "Artifact";
}

function extension(name: string): string {
  const value = name.split(".").at(-1);
  return value && value !== name ? value.toUpperCase() : "FILE";
}

export function LibraryWorkspacePanel({
  authenticated,
  dashboard,
  refreshing,
  onRefresh,
}: {
  readonly authenticated: boolean;
  readonly dashboard: AgentDashboard | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}) {
  const artifacts = useMemo(
    () =>
      (dashboard?.runs ?? []).flatMap((run) =>
        agentArtifactPaths(run.result).map((path) => ({
          key: `${run.id}:${path}`,
          runId: run.id,
          objective: run.objective,
          provider: run.provider,
          path,
          name: artifactName(path),
          updatedAt: run.completedAt ?? run.updatedAt,
        })),
      ),
    [dashboard],
  );

  if (!authenticated) {
    return (
      <section className="v2-module-page">
        <div className="v2-module-heading"><div><p className="v2-eyebrow">ARTIFACTS</p><h1>Library</h1></div></div>
        <div className="v2-empty-card"><strong>Sign in to access generated artifacts.</strong><p>Artifact downloads remain protected by the existing per-user backend ownership checks.</p></div>
      </section>
    );
  }

  return (
    <section className="v2-module-page v2-library-workspace">
      <div className="v2-module-heading">
        <div>
          <p className="v2-eyebrow">OUTPUTS</p>
          <h1>Library</h1>
        </div>
        <button className="v2-text-action" type="button" onClick={onRefresh} disabled={refreshing}>
          <RotateCw className={refreshing ? "spin" : ""} aria-hidden /> Refresh
        </button>
      </div>

      <div className="v2-library-summary">
        <div><FolderOpen aria-hidden /><span>Generated artifacts</span><strong>{artifacts.length}</strong></div>
        <p>V2 indexes artifacts already recorded on your completed agent runs. The existing backend still validates ownership before every download.</p>
      </div>

      {artifacts.length === 0 ? (
        <div className="v2-empty-card">
          <strong>No downloadable artifacts yet.</strong>
          <p>Completed DeerFlow tasks that produce files will appear here automatically. Research exports and versioned workspace files are a later V2 milestone.</p>
        </div>
      ) : (
        <div className="v2-library-grid">
          {artifacts.map((artifact) => (
            <article key={artifact.key}>
              <div className="v2-library-file-icon"><FileText aria-hidden /><span>{extension(artifact.name)}</span></div>
              <div className="v2-library-file-copy">
                <strong>{artifact.name}</strong>
                <p>{artifact.objective}</p>
                <span>{artifact.provider}</span>
              </div>
              <a href={agentArtifactHref(artifact.runId, artifact.path)} aria-label={`Download ${artifact.name}`}>
                <Download aria-hidden />
              </a>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
