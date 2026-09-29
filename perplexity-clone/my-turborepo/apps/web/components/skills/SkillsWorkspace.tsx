"use client";

import { Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Skill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  requiredTools: string[];
  preferredRoles: string[];
  keywords: string[];
  permissions: string[];
  version: string;
  enabled: boolean;
  isBuiltin: boolean;
  author: string;
  evaluationScore: number;
  createdAt: string;
  updatedAt: string;
};

type SkillsPayload = { skills: Skill[] };
type ApiError = { error?: { message?: string } };

export function SkillsWorkspace() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    instructions: "",
    requiredTools: "",
    preferredRoles: "",
    keywords: "",
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/agent-platform/skills", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as SkillsPayload & ApiError | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not load skills.");
      setSkills(body?.skills ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load skills.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      [skill.name, skill.description, skill.author, ...skill.requiredTools, ...skill.keywords]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [filter, skills]);

  async function toggle(skill: Skill) {
    if (skill.isBuiltin) return;
    setBusyId(skill.id);
    setError(null);
    try {
      const response = await fetch(`/api/agent-platform/skills/${encodeURIComponent(skill.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !skill.enabled }),
      });
      const body = (await response.json().catch(() => null)) as ApiError | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not update skill.");
      setSkills((current) => current.map((item) => item.id === skill.id ? { ...item, enabled: !item.enabled } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update skill.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(skill: Skill) {
    if (skill.isBuiltin) return;
    setBusyId(skill.id);
    setError(null);
    try {
      const response = await fetch(`/api/agent-platform/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as ApiError | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not remove skill.");
      setSkills((current) => current.filter((item) => item.id !== skill.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove skill.");
    } finally {
      setBusyId(null);
    }
  }

  async function install(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.name.trim().length < 2 || form.instructions.trim().length < 5) return;
    setInstalling(true);
    setError(null);
    try {
      const split = (value: string) => value.split(",").map((entry) => entry.trim()).filter(Boolean);
      const response = await fetch("/api/agent-platform/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          requiredTools: split(form.requiredTools),
          preferredRoles: split(form.preferredRoles),
          keywords: split(form.keywords),
          permissions: [],
          version: "1.0.0",
          author: "Custom",
        }),
      });
      const body = (await response.json().catch(() => null)) as { skill?: Skill } & ApiError | null;
      if (!response.ok || !body?.skill) throw new Error(body?.error?.message ?? "Could not install skill.");
      setSkills((current) => [body.skill!, ...current.filter((item) => item.id !== body.skill!.id)]);
      setForm({ name: "", description: "", instructions: "", requiredTools: "", preferredRoles: "", keywords: "" });
      setShowInstall(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not install skill.");
    } finally {
      setInstalling(false);
    }
  }

  const customCount = skills.filter((skill) => !skill.isBuiltin).length;

  return (
    <main className="min-h-[calc(100dvh-72px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">AIRA Command</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Skills</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">
              Persistent capability packages used by AIRA's planner. Custom skills are stored per user; built-in skills remain platform-controlled.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.12)] bg-white px-3.5 py-2.5 text-sm font-semibold shadow-xs hover:bg-[#FAF9F6]">
              <RefreshCw className="size-4" /> Refresh
            </button>
            <button type="button" onClick={() => setShowInstall((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-[#3A0CA3] px-3.5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-[#2D0A82]">
              <Plus className="size-4" /> Install skill
            </button>
          </div>
        </header>

        {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs"><p className="text-xs text-[#6B6A75]">Total skills</p><p className="mt-2 text-2xl font-semibold">{skills.length}</p></div>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs"><p className="text-xs text-[#6B6A75]">Custom</p><p className="mt-2 text-2xl font-semibold">{customCount}</p></div>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs"><p className="text-xs text-[#6B6A75]">Enabled</p><p className="mt-2 text-2xl font-semibold text-emerald-700">{skills.filter((skill) => skill.enabled).length}</p></div>
        </section>

        {showInstall ? (
          <form onSubmit={(event) => void install(event)} className="rounded-2xl border border-[#3A0CA3]/20 bg-white p-5 shadow-xs">
            <div className="mb-4 flex items-center gap-2"><ShieldCheck className="size-4 text-[#3A0CA3]" /><h2 className="text-sm font-semibold">Install custom skill</h2></div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Skill name" maxLength={80} className="rounded-xl border border-[rgba(17,17,21,0.12)] px-3 py-2.5 text-sm outline-none focus:border-[#3A0CA3]" />
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Short description" maxLength={400} className="rounded-xl border border-[rgba(17,17,21,0.12)] px-3 py-2.5 text-sm outline-none focus:border-[#3A0CA3]" />
              <textarea value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} placeholder="Execution instructions" rows={5} maxLength={10000} className="md:col-span-2 rounded-xl border border-[rgba(17,17,21,0.12)] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[#3A0CA3]" />
              <input value={form.requiredTools} onChange={(e) => setForm((f) => ({ ...f, requiredTools: e.target.value }))} placeholder="Required tools: web, files, github" className="rounded-xl border border-[rgba(17,17,21,0.12)] px-3 py-2.5 text-sm outline-none focus:border-[#3A0CA3]" />
              <input value={form.preferredRoles} onChange={(e) => setForm((f) => ({ ...f, preferredRoles: e.target.value }))} placeholder="Preferred roles: RESEARCH, BACKEND" className="rounded-xl border border-[rgba(17,17,21,0.12)] px-3 py-2.5 text-sm outline-none focus:border-[#3A0CA3]" />
              <input value={form.keywords} onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))} placeholder="Keywords: audit, security, source" className="md:col-span-2 rounded-xl border border-[rgba(17,17,21,0.12)] px-3 py-2.5 text-sm outline-none focus:border-[#3A0CA3]" />
            </div>
            <button type="submit" disabled={installing || form.name.trim().length < 2 || form.instructions.trim().length < 5} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#111115] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {installing ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Persist skill
            </button>
          </form>
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8F8E98]" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search skills, tools, authors, keywords…" className="w-full rounded-xl border border-[rgba(17,17,21,0.1)] bg-white py-3 pl-10 pr-4 text-sm outline-none focus:border-[#3A0CA3]" />
        </div>

        {loading ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white"><Loader2 className="size-5 animate-spin text-[#3A0CA3]" /></div>
        ) : (
          <section className="grid gap-3 md:grid-cols-2">
            {filtered.map((skill) => (
              <article key={skill.id} className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{skill.name}</h2>
                      {skill.isBuiltin ? <span className="rounded-full bg-[#3A0CA3]/[0.07] px-2 py-0.5 text-[9px] font-semibold text-[#3A0CA3]">BUILT-IN</span> : <span className="rounded-full bg-[#F4F4F5] px-2 py-0.5 text-[9px] font-semibold text-[#525252]">CUSTOM</span>}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#6B6A75]">{skill.description || "No description provided."}</p>
                  </div>
                  <span className={skill.enabled ? "text-[10px] font-semibold text-emerald-700" : "text-[10px] font-semibold text-[#8F8E98]"}>{skill.enabled ? "ENABLED" : "DISABLED"}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {skill.requiredTools.map((tool) => <span key={tool} className="rounded-md border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-2 py-1 text-[10px] text-[#525252]">{tool}</span>)}
                  {!skill.requiredTools.length ? <span className="text-[10px] text-[#8F8E98]">No required tools</span> : null}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(17,17,21,0.07)] pt-3">
                  <span className="text-[10px] text-[#8F8E98]">v{skill.version} · {skill.author} · eval {skill.evaluationScore}</span>
                  {!skill.isBuiltin ? (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void toggle(skill)} disabled={busyId === skill.id} className="rounded-lg border border-[rgba(17,17,21,0.1)] px-2.5 py-1.5 text-[10px] font-semibold hover:bg-[#FAF9F6] disabled:opacity-40">
                        {busyId === skill.id ? "Working…" : skill.enabled ? "Disable" : "Enable"}
                      </button>
                      <button type="button" onClick={() => void remove(skill)} disabled={busyId === skill.id} aria-label={`Remove ${skill.name}`} className="grid size-8 place-items-center rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ) : <span className="text-[10px] font-medium text-[#8F8E98]">Platform managed</span>}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
