"use client";

import {
  Archive,
  Bot,
  ChevronRight,
  CopyPlus,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Role =
  | "PRODUCT" | "RESEARCH" | "ARCHITECT" | "UI_UX" | "FRONTEND" | "BACKEND"
  | "DATABASE" | "SECURITY" | "INTEGRATOR" | "QA" | "BROWSER" | "DEVOPS" | "VERIFICATION";
type ModelTier = "fast" | "balanced" | "reasoning" | "coding" | "vision" | "long-context" | "local";

type TeamMember = {
  key: string;
  title: string;
  role: Role;
  agentDefinitionId?: string;
  objectiveTemplate: string;
  modelTier: ModelTier;
  tools: string[];
  skills: string[];
  dependencies: string[];
  priority: number;
};

type Budgets = {
  maxAgents: number;
  maxParallelAgents: number;
  maxToolCalls: number;
  maxTokens: number;
  maxCostUsd: number;
  maxDurationMinutes: number;
  maxRetries: number;
};

type TeamDefinition = {
  name: string;
  description: string;
  members: TeamMember[];
  budgets: Budgets;
  coordinatorPolicy: {
    handoffMode: "DIRECT_DEPENDENCIES";
    requireIndependentVerification: boolean;
    maxHandoffsPerTask: number;
  };
};

type Team = TeamDefinition & {
  id: string;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  createdAt: string;
  updatedAt: string;
};

type Agent = {
  id: string;
  name: string;
  tools: string[];
  skills: string[];
  version: number;
};

type Skill = { id: string; name: string; enabled: boolean; isBuiltin: boolean };
type ToolState = { id: string; available: boolean };
type Version = { version: number; createdAt: string };
type ApiError = { error?: { message?: string } };

const ROLES: readonly Role[] = [
  "PRODUCT", "RESEARCH", "ARCHITECT", "UI_UX", "FRONTEND", "BACKEND",
  "DATABASE", "SECURITY", "INTEGRATOR", "QA", "BROWSER", "DEVOPS", "VERIFICATION",
];
const TIERS: readonly ModelTier[] = ["fast", "balanced", "reasoning", "coding", "vision", "long-context", "local"];

const DEFAULT_BUDGETS: Budgets = {
  maxAgents: 12,
  maxParallelAgents: 4,
  maxToolCalls: 160,
  maxTokens: 500_000,
  maxCostUsd: 20,
  maxDurationMinutes: 180,
  maxRetries: 2,
};

function member(input: Partial<TeamMember> & Pick<TeamMember, "key" | "title" | "role" | "objectiveTemplate">): TeamMember {
  return {
    key: input.key,
    title: input.title,
    role: input.role,
    objectiveTemplate: input.objectiveTemplate,
    modelTier: input.modelTier ?? "reasoning",
    tools: input.tools ?? [],
    skills: input.skills ?? [],
    dependencies: input.dependencies ?? [],
    priority: input.priority ?? 50,
    ...(input.agentDefinitionId ? { agentDefinitionId: input.agentDefinitionId } : {}),
  };
}

function researchTemplate(): TeamDefinition {
  return {
    name: "Research & Strategy Team",
    description: "Parallel evidence gathering and independent analysis with coordinator synthesis and verification.",
    budgets: { ...DEFAULT_BUDGETS, maxAgents: 8, maxParallelAgents: 3, maxCostUsd: 12 },
    coordinatorPolicy: { handoffMode: "DIRECT_DEPENDENCIES", requireIndependentVerification: true, maxHandoffsPerTask: 8 },
    members: [
      member({ key: "brief", title: "Research brief", role: "PRODUCT", modelTier: "reasoning", tools: ["files", "web", "memory"], priority: 100, objectiveTemplate: "Define scope, decision criteria and evidence requirements for: {{objective}}" }),
      member({ key: "research", title: "Primary evidence research", role: "RESEARCH", modelTier: "long-context", tools: ["web", "files"], skills: ["research"], dependencies: ["brief"], priority: 90, objectiveTemplate: "Collect authoritative evidence and source-backed findings for: {{objective}}" }),
      member({ key: "analysis", title: "Independent analysis", role: "ARCHITECT", modelTier: "reasoning", tools: ["web", "files"], skills: ["research"], dependencies: ["brief"], priority: 86, objectiveTemplate: "Independently challenge assumptions, compare trade-offs and produce a second perspective for: {{objective}}" }),
      member({ key: "synthesis", title: "Coordinator synthesis", role: "ARCHITECT", modelTier: "reasoning", tools: ["files"], dependencies: ["research", "analysis"], priority: 70, objectiveTemplate: "Reconcile direct specialist handoffs and build the requested deliverable for: {{objective}}" }),
      member({ key: "verification", title: "Independent verification", role: "VERIFICATION", modelTier: "reasoning", tools: ["files", "web"], dependencies: ["synthesis"], priority: 50, objectiveTemplate: "Verify the final deliverable against scope and direct evidence for: {{objective}}" }),
    ],
  };
}

function securityTemplate(): TeamDefinition {
  return {
    name: "Security Audit Team",
    description: "Evidence-led threat modeling, independent security analysis, remediation synthesis and verification.",
    budgets: { ...DEFAULT_BUDGETS, maxAgents: 8, maxParallelAgents: 3, maxCostUsd: 15 },
    coordinatorPolicy: { handoffMode: "DIRECT_DEPENDENCIES", requireIndependentVerification: true, maxHandoffsPerTask: 8 },
    members: [
      member({ key: "scope", title: "Security scope & assets", role: "PRODUCT", tools: ["files", "memory"], priority: 100, objectiveTemplate: "Define assets, trust boundaries, attacker goals and verification criteria for: {{objective}}" }),
      member({ key: "evidence", title: "Architecture evidence", role: "RESEARCH", modelTier: "long-context", tools: ["web", "files"], skills: ["research"], dependencies: ["scope"], priority: 90, objectiveTemplate: "Collect implementation and architecture evidence relevant to: {{objective}}" }),
      member({ key: "threats", title: "Threat model & exploit analysis", role: "SECURITY", tools: ["files", "terminal"], skills: ["security-audit"], dependencies: ["scope"], priority: 92, objectiveTemplate: "Threat-model and test concrete authorization, injection, secret, SSRF and tool-escalation risks for: {{objective}}" }),
      member({ key: "remediation", title: "Remediation synthesis", role: "ARCHITECT", tools: ["files"], dependencies: ["evidence", "threats"], priority: 70, objectiveTemplate: "Reconcile evidence and security findings into prioritized remediations for: {{objective}}" }),
      member({ key: "verification", title: "Security verification", role: "VERIFICATION", tools: ["files", "terminal"], skills: ["security-audit"], dependencies: ["remediation"], priority: 50, objectiveTemplate: "Independently verify supported findings and remediation evidence for: {{objective}}" }),
    ],
  };
}

function softwareTemplate(): TeamDefinition {
  return {
    name: "Software Delivery Team",
    description: "Reusable product-to-verification engineering team with explicit cross-specialist handoffs.",
    budgets: { ...DEFAULT_BUDGETS, maxAgents: 14, maxParallelAgents: 4, maxCostUsd: 30, maxDurationMinutes: 240 },
    coordinatorPolicy: { handoffMode: "DIRECT_DEPENDENCIES", requireIndependentVerification: true, maxHandoffsPerTask: 12 },
    members: [
      member({ key: "requirements", title: "Requirements & acceptance", role: "PRODUCT", tools: ["files", "web", "memory"], priority: 100, objectiveTemplate: "Define functional requirements, constraints and proof-of-work criteria for: {{objective}}" }),
      member({ key: "research", title: "Technical research", role: "RESEARCH", modelTier: "long-context", tools: ["web", "files"], skills: ["research"], priority: 92, objectiveTemplate: "Research implementation patterns, dependencies and risks for: {{objective}}" }),
      member({ key: "architecture", title: "Architecture & contracts", role: "ARCHITECT", tools: ["files", "git", "memory"], dependencies: ["requirements", "research"], priority: 90, objectiveTemplate: "Define safe architecture, interfaces and integration contracts for: {{objective}}" }),
      member({ key: "database", title: "Database implementation", role: "DATABASE", modelTier: "coding", tools: ["files", "git", "terminal", "supabase"], skills: ["backend-architecture"], dependencies: ["architecture"], priority: 80, objectiveTemplate: "Implement additive data changes and authorization boundaries required for: {{objective}}" }),
      member({ key: "backend", title: "Backend implementation", role: "BACKEND", modelTier: "coding", tools: ["files", "git", "terminal", "supabase"], skills: ["backend-architecture"], dependencies: ["architecture"], priority: 78, objectiveTemplate: "Implement backend/runtime contracts for: {{objective}}" }),
      member({ key: "frontend", title: "Frontend implementation", role: "FRONTEND", modelTier: "coding", tools: ["files", "git", "terminal", "browser"], skills: ["frontend-design"], dependencies: ["architecture"], priority: 76, objectiveTemplate: "Implement real connected product UI for: {{objective}}" }),
      member({ key: "security", title: "Security review", role: "SECURITY", tools: ["files", "git", "terminal", "browser"], skills: ["security-audit"], dependencies: ["database", "backend"], priority: 70, objectiveTemplate: "Threat-model and repair concrete security defects in: {{objective}}" }),
      member({ key: "integration", title: "Integration", role: "INTEGRATOR", modelTier: "coding", tools: ["files", "git", "terminal"], dependencies: ["database", "backend", "frontend"], priority: 65, objectiveTemplate: "Integrate all implementation branches and prove contracts for: {{objective}}" }),
      member({ key: "qa", title: "Functional QA", role: "QA", tools: ["files", "terminal", "browser"], skills: ["qa-testing"], dependencies: ["integration", "security"], priority: 58, objectiveTemplate: "Exercise critical workflows and regression-sensitive behavior for: {{objective}}" }),
      member({ key: "verification", title: "Final verification", role: "VERIFICATION", tools: ["files", "terminal", "browser"], dependencies: ["qa"], priority: 45, objectiveTemplate: "Independently verify acceptance evidence and unresolved blockers for: {{objective}}" }),
    ],
  };
}

function blankTeam(): TeamDefinition {
  return {
    name: "New Agent Team",
    description: "",
    budgets: { ...DEFAULT_BUDGETS, maxAgents: 4 },
    coordinatorPolicy: { handoffMode: "DIRECT_DEPENDENCIES", requireIndependentVerification: true, maxHandoffsPerTask: 8 },
    members: [
      member({ key: "specialist", title: "Primary specialist", role: "RESEARCH", tools: ["web", "files"], priority: 90, objectiveTemplate: "Complete the primary specialist work for: {{objective}}" }),
      member({ key: "verification", title: "Independent verification", role: "VERIFICATION", tools: ["files", "web"], dependencies: ["specialist"], priority: 50, objectiveTemplate: "Verify the specialist evidence and final result for: {{objective}}" }),
    ],
  };
}

function cloneDefinition(value: TeamDefinition): TeamDefinition {
  return JSON.parse(JSON.stringify(value)) as TeamDefinition;
}
const csv = (value: string) => value.split(",").map((entry) => entry.trim()).filter(Boolean);
async function readError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function TeamsWorkspace() {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<ToolState[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TeamDefinition>(blankTeam());
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => teams.find((team) => team.id === selectedId) ?? null, [selectedId, teams]);

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      const [teamsResponse, agentsResponse, skillsResponse, toolsResponse] = await Promise.all([
        fetch("/api/agent-platform/teams", { cache: "no-store" }),
        fetch("/api/agent-platform/user-agents", { cache: "no-store" }),
        fetch("/api/agent-platform/skills", { cache: "no-store" }),
        fetch("/api/agent-platform/tools", { cache: "no-store" }),
      ]);
      if (!teamsResponse.ok) throw await readError(teamsResponse);
      if (!agentsResponse.ok) throw await readError(agentsResponse);
      if (!skillsResponse.ok) throw await readError(skillsResponse);
      if (!toolsResponse.ok) throw await readError(toolsResponse);
      const teamBody = (await teamsResponse.json()) as { teams: Team[] };
      const agentBody = (await agentsResponse.json()) as { agents: Agent[] };
      const skillBody = (await skillsResponse.json()) as { skills: Skill[] };
      const toolBody = (await toolsResponse.json()) as { tools: ToolState[] };
      setTeams(teamBody.teams);
      setAgents(agentBody.agents);
      setSkills(skillBody.skills.filter((skill) => skill.enabled));
      setTools(toolBody.tools);
      setSelectedId((current) => current && teamBody.teams.some((team) => team.id === current)
        ? current
        : teamBody.teams.find((team) => team.status === "ACTIVE")?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent Teams could not be loaded.");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) {
      setVersions([]);
      return;
    }
    setDraft(cloneDefinition(selected));
    void fetch(`/api/agent-platform/teams/${encodeURIComponent(selected.id)}/versions`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ versions: Version[] }> : { versions: [] })
      .then((body) => setVersions(body.versions))
      .catch(() => setVersions([]));
  }, [selected]);

  function startNew(definition = blankTeam()) {
    setSelectedId(null);
    setDraft(cloneDefinition(definition));
    setVersions([]);
    setObjective("");
    setError(null);
  }

  function patchMember(index: number, patch: Partial<TeamMember>) {
    setDraft((current) => ({
      ...current,
      members: current.members.map((entry, memberIndex) => memberIndex === index ? { ...entry, ...patch } : entry),
    }));
  }

  function addMember() {
    const key = `member-${draft.members.length + 1}`;
    setDraft((current) => ({
      ...current,
      members: [...current.members, member({
        key,
        title: "New specialist",
        role: "RESEARCH",
        tools: ["files"],
        objectiveTemplate: "Complete assigned specialist work for: {{objective}}",
        priority: 50,
      })],
      budgets: { ...current.budgets, maxAgents: Math.max(current.budgets.maxAgents, current.members.length + 1) },
    }));
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const response = await fetch(selected ? `/api/agent-platform/teams/${encodeURIComponent(selected.id)}` : "/api/agent-platform/teams", {
        method: selected ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw await readError(response);
      const body = (await response.json()) as { team: Team };
      await load();
      setSelectedId(body.team.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent Team could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    if (!selected || !window.confirm(`Archive "${selected.name}"? Existing run snapshots remain unchanged.`)) return;
    setBusy("archive");
    setError(null);
    try {
      const response = await fetch(`/api/agent-platform/teams/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      if (!response.ok) throw await readError(response);
      setSelectedId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent Team could not be archived.");
    } finally {
      setBusy(null);
    }
  }

  function prepareLaunch() {
    if (!selected || selected.status !== "ACTIVE" || objective.trim().length < 3) return;
    router.push(`/work?intent=team&teamId=${encodeURIComponent(selected.id)}&objective=${encodeURIComponent(objective.trim())}`);
  }

  const activeTeams = teams.filter((team) => team.status === "ACTIVE");
  const availableTools = tools.filter((tool) => tool.available).length;

  return (
    <main className="min-h-[calc(100dvh-72px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">AIRA Command</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] md:text-3xl">Reusable Agent Teams</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">
              Save versioned specialist DAGs that bind durable agents, tools, skills and mission budgets. Every launch snapshots the selected version before execution.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.1)] bg-white px-3.5 py-2.5 text-sm font-semibold shadow-xs hover:bg-[#FAF9F6] disabled:opacity-50">
              <RefreshCw className="size-4" /> Refresh
            </button>
            <button type="button" onClick={() => startNew()} className="inline-flex items-center gap-2 rounded-xl bg-[#111115] px-3.5 py-2.5 text-sm font-semibold text-white">
              <Plus className="size-4" /> New team
            </button>
          </div>
        </header>

        {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

        <section className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs"><p className="text-xs text-[#6B6A75]">Active teams</p><p className="mt-2 text-2xl font-semibold">{activeTeams.length}</p></div>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs"><p className="text-xs text-[#6B6A75]">Durable agents</p><p className="mt-2 text-2xl font-semibold">{agents.length}</p></div>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs"><p className="text-xs text-[#6B6A75]">Enabled skills</p><p className="mt-2 text-2xl font-semibold">{skills.length}</p></div>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs"><p className="text-xs text-[#6B6A75]">Tools available now</p><p className="mt-2 text-2xl font-semibold text-emerald-700">{availableTools}/{tools.length}</p></div>
        </section>

        <section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2"><CopyPlus className="size-4 text-[#3A0CA3]" /><h2 className="text-sm font-semibold">Start from a functional team pattern</h2></div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {[
              ["Research & Strategy", "Evidence + independent analysis + synthesis + verification", researchTemplate],
              ["Security Audit", "Threat model + evidence + remediation + verification", securityTemplate],
              ["Software Delivery", "Product → architecture → implementation → security → QA → verification", softwareTemplate],
            ].map(([title, description, factory]) => (
              <button key={String(title)} type="button" onClick={() => startNew((factory as () => TeamDefinition)())} className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FCFBF9] p-4 text-left transition hover:border-[#3A0CA3]/25 hover:bg-white">
                <p className="text-sm font-semibold">{String(title)}</p>
                <p className="mt-1 text-xs leading-5 text-[#6B6A75]">{String(description)}</p>
              </button>
            ))}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-3 shadow-xs">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8F8E98]">Saved teams</p>
            <div className="max-h-[620px] space-y-1 overflow-y-auto">
              {teams.map((team) => (
                <button key={team.id} type="button" onClick={() => setSelectedId(team.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedId === team.id ? "border-[#3A0CA3]/30 bg-[#3A0CA3]/[0.05]" : "border-transparent hover:bg-[#FAF9F6]"}`}>
                  <div className="flex items-center gap-2"><UsersRound className="size-3.5 text-[#3A0CA3]" /><span className="truncate text-sm font-semibold">{team.name}</span></div>
                  <p className="mt-1 text-[10px] text-[#8F8E98]">v{team.version} · {team.members.length} members · {team.status}</p>
                </button>
              ))}
              {!teams.length && busy !== "load" ? <p className="px-3 py-8 text-center text-xs text-[#8F8E98]">No saved teams yet.</p> : null}
              {busy === "load" ? <div className="grid place-items-center py-10"><Loader2 className="size-4 animate-spin text-[#3A0CA3]" /></div> : null}
            </div>
          </aside>

          <div className="space-y-5">
            <section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">{selected ? `Edit ${selected.name}` : "Unsaved team"}</h2>
                  <p className="mt-1 text-xs text-[#6B6A75]">{selected ? `Version ${selected.version} · ${versions.length} recorded versions` : "Save to create a durable team definition."}</p>
                </div>
                <div className="flex gap-2">
                  {selected ? <button type="button" onClick={() => void archive()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"><Archive className="size-3.5" />Archive</button> : null}
                  <button type="button" onClick={() => void save()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3A0CA3] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}{selected ? "Save new version" : "Create team"}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={100} placeholder="Team name" className="rounded-xl border border-[rgba(17,17,21,0.1)] px-3 py-2.5 text-sm outline-none focus:border-[#3A0CA3]" />
                <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={500} placeholder="What this team is for" className="rounded-xl border border-[rgba(17,17,21,0.1)] px-3 py-2.5 text-sm outline-none focus:border-[#3A0CA3]" />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-[10px] font-semibold text-[#6B6A75]">Max agents<input type="number" min={2} max={24} value={draft.budgets.maxAgents} onChange={(e) => setDraft((d) => ({ ...d, budgets: { ...d.budgets, maxAgents: Number(e.target.value) } }))} className="mt-1 w-full rounded-lg border border-[rgba(17,17,21,0.1)] px-3 py-2 text-sm text-[#111115]" /></label>
                <label className="text-[10px] font-semibold text-[#6B6A75]">Parallel agents<input type="number" min={1} max={6} value={draft.budgets.maxParallelAgents} onChange={(e) => setDraft((d) => ({ ...d, budgets: { ...d.budgets, maxParallelAgents: Number(e.target.value) } }))} className="mt-1 w-full rounded-lg border border-[rgba(17,17,21,0.1)] px-3 py-2 text-sm text-[#111115]" /></label>
                <label className="text-[10px] font-semibold text-[#6B6A75]">Cost ceiling USD<input type="number" min={0} max={250} step={0.5} value={draft.budgets.maxCostUsd} onChange={(e) => setDraft((d) => ({ ...d, budgets: { ...d.budgets, maxCostUsd: Number(e.target.value) } }))} className="mt-1 w-full rounded-lg border border-[rgba(17,17,21,0.1)] px-3 py-2 text-sm text-[#111115]" /></label>
                <label className="text-[10px] font-semibold text-[#6B6A75]">Duration minutes<input type="number" min={10} max={1440} value={draft.budgets.maxDurationMinutes} onChange={(e) => setDraft((d) => ({ ...d, budgets: { ...d.budgets, maxDurationMinutes: Number(e.target.value) } }))} className="mt-1 w-full rounded-lg border border-[rgba(17,17,21,0.1)] px-3 py-2 text-sm text-[#111115]" /></label>
                <label className="text-[10px] font-semibold text-[#6B6A75]">Tool calls<input type="number" min={10} max={500} value={draft.budgets.maxToolCalls} onChange={(e) => setDraft((d) => ({ ...d, budgets: { ...d.budgets, maxToolCalls: Number(e.target.value) } }))} className="mt-1 w-full rounded-lg border border-[rgba(17,17,21,0.1)] px-3 py-2 text-sm text-[#111115]" /></label>
                <label className="text-[10px] font-semibold text-[#6B6A75]">Tokens<input type="number" min={10000} max={2000000} step={10000} value={draft.budgets.maxTokens} onChange={(e) => setDraft((d) => ({ ...d, budgets: { ...d.budgets, maxTokens: Number(e.target.value) } }))} className="mt-1 w-full rounded-lg border border-[rgba(17,17,21,0.1)] px-3 py-2 text-sm text-[#111115]" /></label>
                <label className="text-[10px] font-semibold text-[#6B6A75]">Retries<input type="number" min={0} max={5} value={draft.budgets.maxRetries} onChange={(e) => setDraft((d) => ({ ...d, budgets: { ...d.budgets, maxRetries: Number(e.target.value) } }))} className="mt-1 w-full rounded-lg border border-[rgba(17,17,21,0.1)] px-3 py-2 text-sm text-[#111115]" /></label>
                <label className="flex items-end gap-2 rounded-lg border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-3 py-2 text-[10px] font-semibold text-[#6B6A75]"><input type="checkbox" checked={draft.coordinatorPolicy.requireIndependentVerification} onChange={(e) => setDraft((d) => ({ ...d, coordinatorPolicy: { ...d.coordinatorPolicy, requireIndependentVerification: e.target.checked } }))} />Require verification</label>
              </div>
            </section>

            <section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Team members & DAG</h2><p className="mt-1 text-xs text-[#6B6A75]">Dependencies are member keys. Server validation rejects missing keys, cycles, inaccessible agents, tools or skills.</p></div><button type="button" onClick={addMember} className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(17,17,21,0.1)] px-3 py-2 text-xs font-semibold"><Plus className="size-3.5" />Add member</button></div>
              <div className="mt-4 space-y-3">
                {draft.members.map((entry, index) => {
                  const agent = agents.find((candidate) => candidate.id === entry.agentDefinitionId);
                  return (
                    <article key={`${entry.key}-${index}`} className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-[#FCFBF9] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-xl bg-[#3A0CA3]/[0.06] text-[#3A0CA3]"><Bot className="size-3.5" /></span><div><p className="text-xs font-semibold">{entry.title || "Untitled member"}</p><p className="mt-0.5 text-[9px] text-[#8F8E98]">{entry.key || "missing-key"} · {entry.role}</p></div></div>
                        <button type="button" onClick={() => setDraft((current) => ({ ...current, members: current.members.filter((_, memberIndex) => memberIndex !== index) }))} disabled={draft.members.length <= 2} aria-label={`Remove ${entry.title}`} className="grid size-8 place-items-center rounded-lg border border-red-200 text-red-700 disabled:opacity-30"><Trash2 className="size-3.5" /></button>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                        <input value={entry.key} onChange={(e) => patchMember(index, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-") })} placeholder="member-key" className="rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs" />
                        <input value={entry.title} onChange={(e) => patchMember(index, { title: e.target.value })} placeholder="Member title" className="rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs" />
                        <select value={entry.role} onChange={(e) => patchMember(index, { role: e.target.value as Role })} className="rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs">{ROLES.map((role) => <option key={role}>{role}</option>)}</select>
                        <select value={entry.modelTier} onChange={(e) => patchMember(index, { modelTier: e.target.value as ModelTier })} className="rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs">{TIERS.map((tier) => <option key={tier}>{tier}</option>)}</select>
                        <select value={entry.agentDefinitionId ?? ""} onChange={(e) => patchMember(index, { agentDefinitionId: e.target.value || undefined })} className="md:col-span-2 rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs">
                          <option value="">Role policy only — no custom UserAgent</option>
                          {agents.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
                        </select>
                        <input value={entry.dependencies.join(", ")} onChange={(e) => patchMember(index, { dependencies: csv(e.target.value) })} placeholder="Dependencies: brief, research" className="rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs" />
                        <input type="number" min={0} max={100} value={entry.priority} onChange={(e) => patchMember(index, { priority: Number(e.target.value) })} aria-label={`${entry.title} priority`} className="rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs" />
                        <textarea value={entry.objectiveTemplate} onChange={(e) => patchMember(index, { objectiveTemplate: e.target.value })} rows={3} placeholder="Use {{objective}} to insert the mission objective." className="md:col-span-2 lg:col-span-4 rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs leading-5" />
                        <input value={entry.tools.join(", ")} onChange={(e) => patchMember(index, { tools: csv(e.target.value) })} placeholder="Tools: web, files, browser" className="md:col-span-2 rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs" />
                        <input value={entry.skills.join(", ")} onChange={(e) => patchMember(index, { skills: csv(e.target.value) })} placeholder="Skills: research, security-audit" className="md:col-span-2 rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2 text-xs" />
                      </div>
                      {agent ? <div className="mt-3 rounded-xl border border-[#3A0CA3]/10 bg-white px-3 py-2 text-[10px] text-[#6B6A75]"><strong className="text-[#3A0CA3]">{agent.name}</strong> contributes its versioned instructions plus {agent.tools.length} configured tools and {agent.skills.length} skills. Explicit member tools/skills are merged and snapshotted at launch.</div> : null}
                    </article>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-[9px] text-[#8F8E98]">
                <span className="inline-flex items-center gap-1"><Wrench className="size-3" />Registered tools: {tools.map((tool) => tool.id).join(", ") || "loading"}</span>
                <span>·</span><span>Enabled skills: {skills.map((skill) => skill.id).join(", ") || "none"}</span>
              </div>
            </section>

            <section className="rounded-2xl border border-[#3A0CA3]/15 bg-[#3A0CA3]/[0.025] p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#3A0CA3]" /><h2 className="text-sm font-semibold">Prepare a reviewed launch</h2></div>
              <p className="mt-1 text-xs leading-5 text-[#6B6A75]">A saved team never executes from this screen. AIRA opens Work with the selected immutable team version, exact DAG preview and explicit Launch Agent Team control.</p>
              <div className="mt-4 flex flex-col gap-2 md:flex-row">
                <textarea value={objective} onChange={(e) => setObjective(e.target.value.slice(0, 8000))} rows={3} placeholder={selected ? `What should ${selected.name} accomplish?` : "Save or select a team first…"} className="min-h-20 flex-1 rounded-xl border border-[rgba(17,17,21,0.1)] bg-white px-3 py-2.5 text-sm leading-5 outline-none focus:border-[#3A0CA3]" />
                <button type="button" onClick={prepareLaunch} disabled={!selected || selected.status !== "ACTIVE" || objective.trim().length < 3} className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-[#3A0CA3] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">
                  Review in Work <ChevronRight className="size-4" />
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
