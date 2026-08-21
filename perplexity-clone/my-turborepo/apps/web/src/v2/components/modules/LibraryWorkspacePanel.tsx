"use client";

import { Download, FileClock, FileText, FolderOpen, RotateCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import {
  agentArtifactHref,
  agentArtifactPaths,
  agentProviderLabel,
  agentWorkspaceFilePaths,
  type AgentDashboard,
} from "@/src/v2/compat/aira-api";

type LibraryKind = "artifact" | "workspace";

interface LibraryVersion {
  readonly key: string;
  readonly kind: LibraryKind;
  readonly runId: string;
  readonly objective: string;
  readonly provider: string;
  readonly path: string;
  readonly relativePath: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly downloadable: boolean;
}

interface LibraryEntry {
  readonly key: string;
  readonly name: string;
  readonly relativePath: string;
  readonly kind: LibraryKind;
  readonly versions: readonly LibraryVersion[];
}

function artifactName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "Artifact";
}

function extension(name: string): string {
  const value = name.split(".").at(-1);
  return value && value !== name ? value.toUpperCase() : "FILE";
}

function relativeArtifactPath(path: string): string {
  return path.replace(/^mnt\/user-data\/outputs\//, "");
}

function safeTime(iso: string): number {
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : 0;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | LibraryKind>("all");

  const versions = useMemo<readonly LibraryVersion[]>(
    () =>
      (dashboard?.runs ?? []).flatMap((run) => {
        const updatedAt = run.completedAt ?? run.updatedAt;
        const artifacts = agentArtifactPaths(run.result).map((path) => ({
          key: `artifact:${run.id}:${path}`,
          kind: "artifact" as const,
          runId: run.id,
          objective: run.objective,
          provider: run.provider,
          path,
          relativePath: relativeArtifactPath(path),
          name: artifactName(path),
          updatedAt,
          downloadable: true,
        }));
        const workspaceFiles = agentWorkspaceFilePaths(run.result).map((path) => ({
          key: `workspace:${run.id}:${path}`,
          kind: "workspace" as const,
          runId: run.id,
          objective: run.objective,
          provider: run.provider,
          path,
          relativePath: path,
          name: artifactName(path),
          updatedAt,
          downloadable: false,
        }));
        return [...artifacts, ...workspaceFiles];
      }),
    [dashboard],
  );

  const entries = useMemo<readonly LibraryEntry[]>(() => {
    const groups = new Map<string, LibraryVersion[]>();
    for (const version of versions) {
      const groupKey = `${version.kind}:${version.relativePath.toLowerCase()}`;
      const current = groups.get(groupKey) ?? [];
      current.push(version);
      groups.set(groupKey, current);
    }

    return Array.from(groups.entries())
      .map(([key, groupVersions]) => {
        const sorted = [...groupVersions].sort((a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt));
        const latest = sorted[0];
        return {
          key,
          name: latest.name,
          relativePath: latest.relativePath,
          kind: latest.kind,
          versions: sorted,
        } satisfies LibraryEntry;
      })
      .sort((a, b) => safeTime(b.versions[0].updatedAt) - safeTime(a.versions[0].updatedAt));
  }, [versions]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (kind !== "all" && entry.kind !== kind) return false;
      if (!normalized) return true;
      const latest = entry.versions[0];
      return [entry.name, entry.relativePath, latest.objective, latest.provider]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [entries, kind, query]);

  if (!authenticated) {
    return (
      <section className="v2-module-page">
        <div className="v2-module-heading"><div><p className="v2-eyebrow">ARTIFACTS</p><h1>Library</h1></div></div>
        <div className="v2-empty-card"><strong>Sign in to access generated artifacts.</strong><p>Artifact downloads remain protected by the existing per-user backend ownership checks.</p></div>
      </section>
    );
  }

  return (
    <section className="v2-module-page v2-library-workspace" aria-labelledby="v2-library-title">
      <div className="v2-module-heading">
        <div>
          <p className="v2-eyebrow">OUTPUTS</p>
          <h1 id="v2-library-title">Library</h1>
        </div>
        <button className="v2-text-action" type="button" onClick={onRefresh} disabled={refreshing}>
          <RotateCw className={refreshing ? "spin" : ""} aria-hidden /> Refresh
        </button>
      </div>

      <div className="v2-library-summary">
        <div><FolderOpen aria-hidden /><span>Indexed files</span><strong>{entries.length}</strong></div>
        <p>Files are indexed from immutable agent-run history. Repeated paths are grouped into version history without changing the backend or database.</p>
      </div>

      <div className="v2-library-controls">
        <label>
          <Search aria-hidden />
          <span className="v2-sr-only">Search library</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files, objectives, or runtimes" />
        </label>
        <div role="group" aria-label="Library file type">
          {(["all", "artifact", "workspace"] as const).map((value) => (
            <button key={value} type="button" data-active={kind === value} onClick={() => setKind(value)}>
              {value === "all" ? "All" : value === "artifact" ? "Downloads" : "Workspace changes"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="v2-empty-card">
          <strong>{entries.length === 0 ? "No indexed files yet." : "No files match this filter."}</strong>
          <p>Completed DeerFlow downloads and AAE workspace modifications appear here when recorded by the existing agent backend.</p>
        </div>
      ) : (
        <div className="v2-library-version-list">
          {filtered.map((entry) => {
            const latest = entry.versions[0];
            return (
              <article key={entry.key}>
                <div className="v2-library-file-icon"><FileText aria-hidden /><span>{extension(entry.name)}</span></div>
                <div className="v2-library-version-copy">
                  <div className="v2-library-title-row">
                    <strong>{entry.name}</strong>
                    <span>{entry.versions.length} {entry.versions.length === 1 ? "version" : "versions"}</span>
                  </div>
                  <code>{entry.relativePath}</code>
                  <p>{latest.objective}</p>
                  <div className="v2-library-latest-meta">
                    <span>{agentProviderLabel(latest.provider)}</span>
                    <span>{formatWhen(latest.updatedAt)}</span>
                    <span>{entry.kind === "artifact" ? "downloadable" : "workspace change"}</span>
                  </div>
                  {entry.versions.length > 1 ? (
                    <details>
                      <summary><FileClock aria-hidden /> Version history</summary>
                      <div className="v2-library-versions">
                        {entry.versions.map((version, index) => (
                          <div key={version.key}>
                            <span>v{entry.versions.length - index}</span>
                            <div><strong>{agentProviderLabel(version.provider)}</strong><small>{formatWhen(version.updatedAt)} · {version.objective}</small></div>
                            {version.downloadable ? (
                              <a href={agentArtifactHref(version.runId, version.path)} aria-label={`Download ${entry.name} version ${entry.versions.length - index}`}><Download aria-hidden /></a>
                            ) : (
                              <span className="v2-library-recorded">Recorded</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
                {latest.downloadable ? (
                  <a href={agentArtifactHref(latest.runId, latest.path)} aria-label={`Download latest ${entry.name}`}><Download aria-hidden /></a>
                ) : (
                  <span className="v2-library-recorded">Recorded</span>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
