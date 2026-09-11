"use client";

import { Bot, Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Provider = "AUTO" | "OMNIROUTE" | "NVIDIA" | "OPENAI" | "DEERFLOW" | "AUTOGPT";
type Agent = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  modelPolicy: { provider: Provider; modelId?: string; temperature: number; maxTokens: number };
  tools: string[];
  skills: string[];
  connectors: string[];
  memoryPolicy: { enabled: boolean; scope: "GLOBAL" | "PROJECT" | "SESSION" };
  budget: { maxCostUsd: number; maxDurationMinutes: number };
  riskPolicy: { requireApprovalAbove: "LOW" | "MEDIUM" | "HIGH" | "PROTECTED" };
  version: number;
  isPublic: boolean;
};
type Version = { version: number; createdAt: string };
type ApiError = { error?: { message?: string } };

const emptyAgent = (): Omit<Agent, "id" | "version"> => ({
  name: "", description: "", instructions: "", modelPolicy: { provider: "AUTO", temperature: 0.7, maxTokens: 4096 },
  tools: [], skills: [], connectors: [], memoryPolicy: { enabled: true, scope: "PROJECT" },
  budget: { maxCostUsd: 10, maxDurationMinutes: 30 }, riskPolicy: { requireApprovalAbove: "MEDIUM" }, isPublic: false,
});
const csv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const asCsv = (value: readonly string[]) => value.join(", ");
async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function UserAgentManager() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyAgent());
  const [toolsText, setToolsText] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [connectorsText, setConnectorsText] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => agents.find((agent) => agent.id === selectedId) ?? null, [agents, selectedId]);
  const load = useCallback(async () => {
    const response = await fetch("/api/agent-platform/user-agents", { cache: "no-store" });
    if (!response.ok) throw await readError(response);
    const body = (await response.json()) as { agents: Agent[] };
    setAgents(body.agents);
    setSelectedId((current) => current && body.agents.some((agent) => agent.id === current) ? current : body.agents[0]?.id ?? null);
  }, []);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Agents could not be loaded.")); }, [load]);
  useEffect(() => {
    if (!selected) { setVersions([]); return; }
    setDraft({ ...selected, modelPolicy: { ...selected.modelPolicy }, memoryPolicy: { ...selected.memoryPolicy }, budget: { ...selected.budget }, riskPolicy: { ...selected.riskPolicy } });
    setToolsText(asCsv(selected.tools)); setSkillsText(asCsv(selected.skills)); setConnectorsText(asCsv(selected.connectors));
    void fetch(`/api/agent-platform/user-agents/${encodeURIComponent(selected.id)}/versions`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ versions: Version[] }> : { versions: [] })
      .then((body) => setVersions(body.versions)).catch(() => setVersions([]));
  }, [selected]);

  function payload() {
    return { ...draft, tools: csv(toolsText), skills: csv(skillsText), connectors: csv(connectorsText) };
  }
  async function create() {
    setBusy("create"); setError(null);
    try {
      const body = payload();
      if (body.name.trim().length < 2 || body.instructions.trim().length < 5) throw new Error("Name and instructions are required.");
      const response = await fetch("/api/agent-platform/user-agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw await readError(response);
      const result = (await response.json()) as { agent: Agent };
      await load(); setSelectedId(result.agent.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent could not be created."); }
    finally { setBusy(null); }
  }
  async function save() {
    if (!selected) return;
    setBusy("save"); setError(null);
    try {
      const response = await fetch(`/api/agent-platform/user-agents/${encodeURIComponent(selected.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      if (!response.ok) throw await readError(response);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent could not be saved."); }
    finally { setBusy(null); }
  }
  async function remove() {
    if (!selected) return;
    setBusy("delete"); setError(null);
    try {
      const response = await fetch(`/api/agent-platform/user-agents/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      if (!response.ok) throw await readError(response);
      setSelectedId(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent could not be deleted."); }
    finally { setBusy(null); }
  }

  return (
    <section className="border-b border-white/[0.07] bg-[#0a0c0f] px-4 py-6 text-[#ecece8] md:px-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b89a51]">My agents</p><h1 className="mt-1 text-2xl font-semibold">Durable agent definitions</h1><p className="mt-1 text-sm text-[#858b94]">Instructions, model policy, tools, skills, connectors, memory, budget and risk policy persist through authenticated server APIs.</p></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs"><RefreshCw className="size-3.5" />Refresh</button></div>
        {error ? <div role="alert" className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200">{error}</div> : null}
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-3"><button type="button" onClick={() => { setSelectedId(null); setDraft(emptyAgent()); setToolsText(""); setSkillsText(""); setConnectorsText(""); }} className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d0ae55] px-3 py-2 text-sm font-semibold text-[#111214]"><Plus className="size-4" />New agent</button><div className="max-h-[460px] space-y-1 overflow-auto">{agents.map((agent) => <button key={agent.id} type="button" onClick={() => setSelectedId(agent.id)} className={`w-full rounded-xl p-3 text-left ${selectedId === agent.id ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}><div className="flex items-center gap-2"><Bot className="size-3.5 text-[#d0ae55]" /><span className="truncate text-sm font-medium">{agent.name}</span></div><p className="mt-1 text-[10px] text-[#747a82]">v{agent.version} · {agent.modelPolicy.provider}</p></button>)}</div></aside>
          <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><div className="grid gap-2 sm:grid-cols-2"><input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Agent name" className="rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" /><input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Description" className="rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" /></div><textarea value={draft.instructions} onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))} rows={5} placeholder="Agent instructions" className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" />
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><select value={draft.modelPolicy.provider} onChange={(e) => setDraft((d) => ({ ...d, modelPolicy: { ...d.modelPolicy, provider: e.target.value as Provider } }))} className="rounded-lg border border-white/[0.08] bg-[#14181d] px-3 py-2 text-sm"><option>AUTO</option><option>OMNIROUTE</option><option>NVIDIA</option><option>OPENAI</option><option>DEERFLOW</option><option>AUTOGPT</option></select><input value={draft.modelPolicy.modelId ?? ""} onChange={(e) => setDraft((d) => ({ ...d, modelPolicy: { ...d.modelPolicy, modelId: e.target.value || undefined } }))} placeholder="Model ID (optional)" className="rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" /><input type="number" step="0.1" min="0" max="2" value={draft.modelPolicy.temperature} onChange={(e) => setDraft((d) => ({ ...d, modelPolicy: { ...d.modelPolicy, temperature: Number(e.target.value) } }))} aria-label="Temperature" className="rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" /><input type="number" min="1" value={draft.modelPolicy.maxTokens} onChange={(e) => setDraft((d) => ({ ...d, modelPolicy: { ...d.modelPolicy, maxTokens: Number(e.target.value) } }))} aria-label="Max tokens" className="rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" /></div>
            <input value={toolsText} onChange={(e) => setToolsText(e.target.value)} placeholder="Tools (comma separated)" className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" /><input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder="Skills (comma separated)" className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" /><input value={connectorsText} onChange={(e) => setConnectorsText(e.target.value)} placeholder="Connectors (comma separated)" className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" />
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><select value={draft.memoryPolicy.scope} onChange={(e) => setDraft((d) => ({ ...d, memoryPolicy: { ...d.memoryPolicy, scope: e.target.value as Agent["memoryPolicy"]["scope"] } }))} className="rounded-lg border border-white/[0.08] bg-[#14181d] px-3 py-2 text-sm"><option>GLOBAL</option><option>PROJECT</option><option>SESSION</option></select><input type="number" min="0" value={draft.budget.maxCostUsd} onChange={(e) => setDraft((d) => ({ ...d, budget: { ...d.budget, maxCostUsd: Number(e.target.value) } }))} aria-label="Maximum cost USD" className="rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" /><input type="number" min="1" value={draft.budget.maxDurationMinutes} onChange={(e) => setDraft((d) => ({ ...d, budget: { ...d.budget, maxDurationMinutes: Number(e.target.value) } }))} aria-label="Maximum duration minutes" className="rounded-lg border border-white/[0.08] bg-[#090c10] px-3 py-2 text-sm" /><select value={draft.riskPolicy.requireApprovalAbove} onChange={(e) => setDraft((d) => ({ ...d, riskPolicy: { requireApprovalAbove: e.target.value as Agent["riskPolicy"]["requireApprovalAbove"] } }))} className="rounded-lg border border-white/[0.08] bg-[#14181d] px-3 py-2 text-sm"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>PROTECTED</option></select></div>
            <div className="mt-3 flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.memoryPolicy.enabled} onChange={(e) => setDraft((d) => ({ ...d, memoryPolicy: { ...d.memoryPolicy, enabled: e.target.checked } }))} />Memory enabled</label><label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.isPublic} onChange={(e) => setDraft((d) => ({ ...d, isPublic: e.target.checked }))} />Public</label><span className="text-xs text-[#747a82]">{selected ? `Current version ${selected.version} · ${versions.length} recorded versions` : "Unsaved agent"}</span></div>
            <div className="mt-4 flex gap-2">{selected ? <><button type="button" onClick={() => void save()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-[#d0ae55] px-3 py-2 text-sm font-semibold text-[#111214]"><Save className="size-4" />Save new version</button><button type="button" onClick={() => void remove()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-red-400/20 px-3 py-2 text-sm text-red-200"><Trash2 className="size-4" />Delete</button></> : <button type="button" onClick={() => void create()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-[#d0ae55] px-3 py-2 text-sm font-semibold text-[#111214]">{busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}Create agent</button>}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
