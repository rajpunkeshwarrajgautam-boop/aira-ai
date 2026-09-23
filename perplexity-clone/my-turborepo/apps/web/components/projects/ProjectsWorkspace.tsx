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
    if (response.status === 401) {
      router.replace(`/signin?callbackUrl=${encodeURIComponent("/projects")}`);
      return;
    }
    if (!response.ok) throw await readError(response);
    const body = (await response.json()) as { projects: Project[] };
    setProjects(body.projects);
    setSelectedId((current) => current && body.projects.some((item) => item.id === current) ? current : body.projects[0]?.id ?? null);
  }, [router]);

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
    if (sessionStatus === "unauthenticated") {
      router.replace(`/signin?callbackUrl=${encodeURIComponent("/projects")}`);
      return;
    }
  }, [router, sessionStatus]);

  useEffect(() => {
    void loadProjects()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Projects could not be loaded."))
      .finally(() => setLoading(false));
  }, [loadProjects]);

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

  if (sessionStatus !== "authenticated" || loading) return <div className="grid min-h-[calc(100dvh-58px)] place-items-center bg-[var(--aira-canvas,#F9F8F6)]"><Loader2 className="size-5 animate-spin text-[#3A0CA3]" /></div>;

  return (
    <main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#3A0CA3]">
              <Boxes className="size-3.5" aria-hidden /> Projects
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#111115]">Persistent mission context</h1>
            <p className="mt-1 text-sm text-[#6B6A75]">Projects, managed runs and project-scoped artifacts are loaded from authenticated server APIs.</p>
          </div>
          <button type="button" onClick={() => void loadProjects()} className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.08)] bg-white px-3.5 py-2 text-xs font-semibold text-[#111115] shadow-2xs transition hover:bg-[#FAF9F6]">
            <RefreshCw className="size-3.5 text-[#3A0CA3]" />Refresh
          </button>
        </div>
        {error ? <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-700">{error}</div> : null}
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
            <h2 className="text-sm font-semibold text-[#111115]">Create project</h2>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="mt-3 w-full rounded-xl border border-[rgba(17,17,21,0.12)] bg-[#FAF9F6] px-3.5 py-2 text-sm text-[#111115] placeholder:text-[#8F8E98] outline-none focus:border-[#3A0CA3]" />
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Objective" rows={3} className="mt-2.5 w-full resize-none rounded-xl border border-[rgba(17,17,21,0.12)] bg-[#FAF9F6] px-3.5 py-2 text-sm leading-6 text-[#111115] placeholder:text-[#8F8E98] outline-none focus:border-[#3A0CA3]" />
            <button type="button" onClick={() => void createProject()} disabled={busy !== null || name.trim().length < 2 || objective.trim().length < 3} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#3A0CA3] px-3.5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-[#2D0A82] disabled:cursor-not-allowed disabled:border disabled:border-[rgba(17,17,21,0.08)] disabled:bg-[rgba(17,17,21,0.04)] disabled:text-[#8F8E98]">{busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}Create</button>
            <div className="mt-5 border-t border-[rgba(17,17,21,0.08)] pt-3"><p className="mb-2 text-xs font-medium text-[#6B6A75]">Active projects ({projects.length})</p><div className="max-h-[540px] space-y-1 overflow-auto">{projects.map((project) => <button key={project.id} type="button" onClick={() => setSelectedId(project.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${project.id === selectedId ? "border border-[#3A0CA3] bg-[#FAF9F6] shadow-2xs" : "border border-transparent hover:bg-[#FAF9F6] text-[#111115]"}`}><p className="truncate text-sm font-medium text-[#111115]">{project.name}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-[#6B6A75]">{project.objective}</p></button>)}</div></div>
          </aside>
          <section className="space-y-4">
            {!selected ? (
              <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-12 text-center shadow-xs">
                <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] text-[#6B6A75]">
                  <Boxes className="size-5" />
                </div>
                <p className="mt-4 text-sm font-semibold text-[#111115]">No project selected</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[#6B6A75]">
                  Create a new project on the left or select an existing project to review mission objectives, managed runs, and deliverables.
                </p>
              </div>
            ) : <>
              <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs"><div className="flex items-center gap-2"><Pencil className="size-4 text-[#3A0CA3]" /><h2 className="text-sm font-semibold text-[#111115]">Project definition</h2></div><input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-4 w-full rounded-xl border border-[rgba(17,17,21,0.12)] bg-[#FAF9F6] px-3.5 py-2 text-sm text-[#111115] outline-none focus:border-[#3A0CA3]" /><textarea value={editObjective} onChange={(e) => setEditObjective(e.target.value)} rows={4} className="mt-2.5 w-full resize-none rounded-xl border border-[rgba(17,17,21,0.12)] bg-[#FAF9F6] px-3.5 py-2 text-sm leading-6 text-[#111115] outline-none focus:border-[#3A0CA3]" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void saveProject()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.08)] bg-white px-3.5 py-2 text-xs font-semibold text-[#111115] shadow-2xs hover:bg-[#FAF9F6]"><Save className="size-3.5" />Save changes</button><button type="button" onClick={() => void archiveProject()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"><Archive className="size-3.5" />Archive</button><Link href={`/build?project=${encodeURIComponent(selected.id)}`} className="inline-flex items-center gap-2 rounded-xl bg-[#3A0CA3] px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#2D0A82]"><Boxes className="size-3.5" />Open in Build</Link></div></div>
              <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs"><h2 className="text-sm font-semibold text-[#111115]">Managed runs</h2>{runs.length ? <div className="mt-3 space-y-2">{runs.map((run) => <div key={run.id} className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-[#111115]">{run.runtime ?? "Auto runtime"}</span><span className="text-[10px] font-semibold text-[#3A0CA3]">{run.status}</span></div><p className="mt-1 line-clamp-2 text-xs text-[#6B6A75]">{run.summary ?? run.id}</p></div>)}</div> : <p className="mt-4 text-sm text-[#6B6A75]">No managed runs yet.</p>}</div><div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs"><h2 className="text-sm font-semibold text-[#111115]">Artifacts</h2>{artifacts.length ? <div className="mt-3 space-y-2">{artifacts.map((artifact) => <Link key={artifact.id} href={`/artifacts?artifact=${encodeURIComponent(artifact.id)}`} className="flex items-center gap-3 rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3 transition hover:bg-[#F3F1EC]"><FileText className="size-4 text-[#3A0CA3]" /><span className="min-w-0"><span className="block truncate text-xs font-medium text-[#111115]">{artifact.name}</span><span className="text-[10px] text-[#6B6A75]">{artifact.format} · v{artifact.currentVersion}</span></span></Link>)}</div> : <p className="mt-4 text-sm text-[#6B6A75]">No project artifacts yet.</p>}</div></div>
            </>}
          </section>
        </div>
      </div>
    </main>
  );
}
