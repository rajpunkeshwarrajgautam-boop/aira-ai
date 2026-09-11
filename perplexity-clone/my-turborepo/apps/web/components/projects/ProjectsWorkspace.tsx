"use client";

import { Archive, Boxes, FileText, Loader2, Pencil, Plus, RefreshCw, Save } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Project = { id: string; name: string; objective: string; status: string; createdAt: string; updatedAt: string };
type Run = { id: string; status: string; runtime: string | null; summary: string | null; createdAt: string };
type Artifact = { id: string; name: string; format: string; currentVersion: number; updatedAt: string };
type ApiError = { error?: { message?: string } };

async function readError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function ProjectsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status: sessionStatus } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("project"));
  const [runs, setRuns] = useState<Run[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [editName, setEditName] = useState("");
  const [editObjective, setEditObjective] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => projects.find((project) => project.id === selectedId) ?? null, [projects, selectedId]);

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/agent-platform/projects", { cache: "no-store" });
    if (!response.ok) throw await readError(response);
    const body = (await response.json()) as { projects: Project[] };
    setProjects(body.projects);
    setSelectedId((current) => current && body.projects.some((item) => item.id === current) ? current : body.projects[0]?.id ?? null);
  }, []);

  const loadSelected = useCallback(async (projectId: string) => {
    const [runResponse, artifactResponse] = await Promise.all([
      fetch(`/api/agent-platform/projects/${encodeURIComponent(projectId)}/runs`, { cache: "no-store" }),
      fetch(`/api/artifacts?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
    ]);
    if (!runResponse.ok) throw await readError(runResponse);
    const runBody = (await runResponse.json()) as { runs: Run[] };
    setRuns(runBody.runs);
    if (artifactResponse.ok) {
      const artifactBody = (await artifactResponse.json()) as { artifacts: Artifact[] };
      setArtifacts(artifactBody.artifacts);
    } else {
      setArtifacts([]);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") { router.replace(`/signin?callbackUrl=${encodeURIComponent("/projects")}`); return; }
    if (sessionStatus !== "authenticated") return;
    void loadProjects().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Projects could not be loaded.")).finally(() => setLoading(false));
  }, [loadProjects, router, sessionStatus]);

  useEffect(() => {
    if (!selected) { setRuns([]); setArtifacts([]); setEditName(""); setEditObjective(""); return; }
    setEditName(selected.name); setEditObjective(selected.objective);
    void loadSelected(selected.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Project details could not be loaded."));
  }, [loadSelected, selected]);

  async function createProject() {
    if (name.trim().length < 2 || objective.trim().length < 3) return;
    setBusy("create"); setError(null);
    try {
      const response = await fetch("/api/agent-platform/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), objective: objective.trim() }) });
      if (!response.ok) throw await readError(response);
      const body = (await response.json()) as { project: Project };
      setProjects((current) => [body.project, ...current.filter((item) => item.id !== body.project.id)]);
      setSelectedId(body.project.id); setName(""); setObjective("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Project could not be created."); }
    finally { setBusy(null); }
  }

  async function saveProject() {
    if (!selected || editName.trim().length < 2 || editObjective.trim().length < 3) return;
    setBusy("save"); setError(null);
    try {
      const response = await fetch(`/api/agent-platform/projects/${encodeURIComponent(selected.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName.trim(), objective: editObjective.trim() }) });
      if (!response.ok) throw await readError(response);
      const body = (await response.json()) as { project: Project };
      setProjects((current) => current.map((item) => item.id === body.project.id ? body.project : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Project could not be updated."); }
    finally { setBusy(null); }
  }

  async function archiveProject() {
    if (!selected) return;
    setBusy("archive"); setError(null);
    try {
      const response = await fetch(`/api/agent-platform/projects/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      if (!response.ok) throw await readError(response);
      const remaining = projects.filter((item) => item.id !== selected.id);
      setProjects(remaining); setSelectedId(remaining[0]?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Project could not be archived."); }
    finally { setBusy(null); }
  }

  if (sessionStatus !== "authenticated" || loading) return <div className="grid min-h-[calc(100dvh-58px)] place-items-center bg-[#090b0e]"><Loader2 className="size-5 animate-spin text-[#d0ae55]" /></div>;

  return (
    <main className="min-h-[calc(100dvh-58px)] bg-[#090b0e] px-4 py-6 text-[#ecece8] md:px-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b89a51]">Projects</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Persistent mission context</h1><p className="mt-1 text-sm text-[#858b94]">Projects, managed runs and project-scoped artifacts are loaded from authenticated server APIs.</p></div><button type="button" onClick={() => void loadProjects()} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#12161b] px-3 py-2 text-xs text-[#aeb2b8]"><RefreshCw className="size-3.5" />Refresh</button></div>
        {error ? <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200">{error}</div> : null}
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-4">
            <h2 className="text-sm font-semibold">Create project</h2>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="mt-3 w-full rounded-lg border border-white/[0.08] bg-[#0a0d11] px-3 py-2 text-sm" />
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Objective" rows={3} className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#0a0d11] px-3 py-2 text-sm" />
            <button type="button" onClick={() => void createProject()} disabled={busy !== null || name.trim().length < 2 || objective.trim().length < 3} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d0ae55] px-3 py-2 text-sm font-semibold text-[#111214] disabled:opacity-40">{busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}Create</button>
            <div className="mt-5 border-t border-white/[0.07] pt-3"><p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[#666d76]">Active projects · {projects.length}</p><div className="max-h-[540px] space-y-1 overflow-auto">{projects.map((project) => <button key={project.id} type="button" onClick={() => setSelectedId(project.id)} className={`w-full rounded-xl px-3 py-3 text-left ${project.id === selectedId ? "bg-[#1a1e24]" : "hover:bg-white/[0.03]"}`}><p className="truncate text-sm font-medium text-[#e5e5e1]">{project.name}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-[#737982]">{project.objective}</p></button>)}</div></div>
          </aside>
          <section className="space-y-4">
            {!selected ? <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] px-6 py-20 text-center text-sm text-[#747a82]">Create a project to begin.</div> : <>
              <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><div className="flex items-center gap-2"><Pencil className="size-4 text-[#d0ae55]" /><h2 className="text-sm font-semibold">Project definition</h2></div><input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-4 w-full rounded-lg border border-white/[0.08] bg-[#0a0d11] px-3 py-2 text-sm" /><textarea value={editObjective} onChange={(e) => setEditObjective(e.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#0a0d11] px-3 py-2 text-sm" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void saveProject()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs"><Save className="size-3.5" />Save changes</button><button type="button" onClick={() => void archiveProject()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-200"><Archive className="size-3.5" />Archive</button><Link href={`/build?project=${encodeURIComponent(selected.id)}`} className="inline-flex items-center gap-2 rounded-lg bg-[#d0ae55] px-3 py-2 text-xs font-semibold text-[#111214]"><Boxes className="size-3.5" />Open in Build</Link></div></div>
              <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><h2 className="text-sm font-semibold">Managed runs</h2>{runs.length ? <div className="mt-3 space-y-2">{runs.map((run) => <div key={run.id} className="rounded-xl border border-white/[0.06] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{run.runtime ?? "Auto runtime"}</span><span className="text-[10px] text-[#d0ae55]">{run.status}</span></div><p className="mt-1 line-clamp-2 text-xs text-[#747a82]">{run.summary ?? run.id}</p></div>)}</div> : <p className="mt-4 text-sm text-[#747a82]">No managed runs yet.</p>}</div><div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><h2 className="text-sm font-semibold">Artifacts</h2>{artifacts.length ? <div className="mt-3 space-y-2">{artifacts.map((artifact) => <Link key={artifact.id} href={`/artifacts?artifact=${encodeURIComponent(artifact.id)}`} className="flex items-center gap-3 rounded-xl border border-white/[0.06] p-3 hover:bg-white/[0.025]"><FileText className="size-4 text-[#d0ae55]" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{artifact.name}</span><span className="text-[10px] text-[#747a82]">{artifact.format} · v{artifact.currentVersion}</span></span></Link>)}</div> : <p className="mt-4 text-sm text-[#747a82]">No project artifacts yet.</p>}</div></div>
            </>}
          </section>
        </div>
      </div>
    </main>
  );
}
