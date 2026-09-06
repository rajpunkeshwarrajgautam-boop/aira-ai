"use client";

import {
	Activity,
	Bot,
	CheckCircle2,
	CircleDot,
	GitBranch,
	Loader2,
	Play,
	RefreshCw,
	Send,
	ShieldAlert,
	Square,
	Workflow,
	XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";

type Project = {
	id: string;
	name: string;
	objective: string;
	status: string;
	createdAt: string;
	updatedAt: string;
};

type ManagedRun = {
	id: string;
	projectId: string;
	clientRequestId: string;
	status: string;
	runtime: string | null;
	managerRole: string;
	budgets: {
		maxAgents: number;
		maxParallelAgents: number;
		maxDurationMinutes: number;
		maxCostUsd: number;
	};
	summary: string | null;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	completedAt: string | null;
};

type Task = {
	id: string;
	title: string;
	objective: string;
	status: string;
	priority: number;
	agentRole: string;
	modelTier: string;
	dependencies: string[];
	outputArtifacts: string[];
	attempt: number;
	maxAttempts: number;
	lastError: string | null;
};

type Approval = {
	id: string;
	taskId: string | null;
	action: string;
	risk: string;
	status: string;
	context?: Record<string, unknown>;
};

type EventRecord = {
	id: string;
	type: string;
	createdAt: string;
	payload: Record<string, unknown>;
};

type RunDetail = {
	run: ManagedRun;
	tasks: Task[];
	events: EventRecord[];
	approvals: Approval[];
};

const ACTIVE = new Set(["PLANNING", "RUNNING", "WAITING", "BLOCKED", "APPROVAL_REQUIRED"]);
const EVENT_TYPES = [
	"run.started",
	"run.completed",
	"run.failed",
	"run.cancelled",
	"task.started",
	"task.completed",
	"task.failed",
	"task.requeued",
	"task.blocked",
	"agent.spawned",
	"agent.message",
] as const;

function statusClass(status: string): string {
	if (status === "COMPLETED") return "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200";
	if (status === "FAILED" || status === "CANCELLED") return "border-red-400/20 bg-red-400/[0.07] text-red-200";
	if (status === "APPROVAL_REQUIRED" || status === "BLOCKED") return "border-amber-300/20 bg-amber-300/[0.07] text-amber-100";
	if (status === "RUNNING" || status === "CLAIMED") return "border-[#d0ae55]/25 bg-[#d0ae55]/[0.08] text-[#e4c875]";
	return "border-white/[0.08] bg-white/[0.03] text-[#9ba0a8]";
}

async function readError(response: Response): Promise<Error> {
	const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
	return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function BuildWorkspace() {
	const router = useRouter();
	const { status: sessionStatus } = useSession();
	const [projects, setProjects] = useState<Project[]>([]);
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
	const [runs, setRuns] = useState<ManagedRun[]>([]);
	const [detail, setDetail] = useState<RunDetail | null>(null);
	const [projectName, setProjectName] = useState("");
	const [objective, setObjective] = useState("");
	const [provider, setProvider] = useState<"AUTO" | "DEERFLOW" | "AUTOGPT" | "AGENT_SWARM">("AUTO");
	const [parallel, setParallel] = useState(4);
	const [steerText, setSteerText] = useState("");
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const selectedProject = useMemo(
		() => projects.find((project) => project.id === selectedProjectId) ?? null,
		[projects, selectedProjectId],
	);
	const activeRun = detail?.run && ACTIVE.has(detail.run.status) ? detail.run : null;
	const selectedTask = detail?.tasks.find((task) => task.id === selectedTaskId) ?? null;
	const completedCount = detail?.tasks.filter((task) => task.status === "COMPLETED").length ?? 0;
	const progress = detail?.tasks.length ? Math.round((completedCount / detail.tasks.length) * 100) : 0;

	const loadProjects = useCallback(async () => {
		const response = await fetch("/api/agent-platform/projects", { cache: "no-store" });
		if (!response.ok) throw await readError(response);
		const body = (await response.json()) as { projects: Project[] };
		setProjects(body.projects);
		setSelectedProjectId((current) => current && body.projects.some((item) => item.id === current) ? current : body.projects[0]?.id ?? null);
	}, []);

	const loadProjectRuns = useCallback(async (projectId: string) => {
		const response = await fetch(`/api/agent-platform/projects/${encodeURIComponent(projectId)}/runs`, { cache: "no-store" });
		if (!response.ok) throw await readError(response);
		const body = (await response.json()) as { runs: ManagedRun[] };
		setRuns(body.runs);
		if (!detail && body.runs[0]) {
			const detailResponse = await fetch(`/api/agent-platform/runs/${encodeURIComponent(body.runs[0].id)}`, { cache: "no-store" });
			if (detailResponse.ok) setDetail((await detailResponse.json()) as RunDetail);
		}
	}, [detail]);

	const loadDetail = useCallback(async (runId: string) => {
		const response = await fetch(`/api/agent-platform/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
		if (!response.ok) throw await readError(response);
		const body = (await response.json()) as RunDetail;
		setDetail(body);
		setSelectedTaskId((current) => current && body.tasks.some((task) => task.id === current) ? current : body.tasks[0]?.id ?? null);
		return body;
	}, []);

	useEffect(() => {
		if (sessionStatus === "unauthenticated") {
			router.replace(`/signin?callbackUrl=${encodeURIComponent("/build")}`);
			return;
		}
		if (sessionStatus !== "authenticated") return;
		void loadProjects().catch((e: unknown) => setError(e instanceof Error ? e.message : "Projects could not be loaded.")).finally(() => setLoading(false));
	}, [loadProjects, router, sessionStatus]);

	useEffect(() => {
		if (!selectedProjectId) { setRuns([]); return; }
		void loadProjectRuns(selectedProjectId).catch((e: unknown) => setError(e instanceof Error ? e.message : "Runs could not be loaded."));
	}, [loadProjectRuns, selectedProjectId]);

	useEffect(() => {
		if (!activeRun) return;
		let cancelled = false;
		const advance = async () => {
			try {
				const response = await fetch(`/api/agent-platform/runs/${encodeURIComponent(activeRun.id)}/tick`, { method: "POST" });
				if (!response.ok) throw await readError(response);
				if (!cancelled) await loadDetail(activeRun.id);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Managed mission could not advance.");
			}
		};
		const timer = window.setInterval(() => void advance(), 5_000);
		return () => { cancelled = true; window.clearInterval(timer); };
	}, [activeRun, loadDetail]);

	useEffect(() => {
		if (!activeRun) return;
		const source = new EventSource(`/api/agent-platform/runs/${encodeURIComponent(activeRun.id)}/events`);
		const refresh = () => void loadDetail(activeRun.id).catch(() => undefined);
		for (const type of EVENT_TYPES) source.addEventListener(type, refresh);
		source.addEventListener("stream.end", refresh);
		return () => source.close();
	}, [activeRun, loadDetail]);

	async function createProject() {
		const name = projectName.trim();
		const goal = objective.trim();
		if (name.length < 2 || goal.length < 3) return;
		setBusy("create-project"); setError(null);
		try {
			const response = await fetch("/api/agent-platform/projects", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, objective: goal }),
			});
			if (!response.ok) throw await readError(response);
			const body = (await response.json()) as { project: Project };
			setProjects((current) => [body.project, ...current]);
			setSelectedProjectId(body.project.id);
			setProjectName("");
		} catch (e) { setError(e instanceof Error ? e.message : "Project could not be created."); }
		finally { setBusy(null); }
	}

	async function startMission() {
		if (!selectedProject) return;
		setBusy("start"); setError(null);
		try {
			const response = await fetch(`/api/agent-platform/projects/${encodeURIComponent(selectedProject.id)}/runs`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					clientRequestId: crypto.randomUUID(),
					objective: objective.trim() || selectedProject.objective,
					...(provider === "AUTO" ? {} : { provider }),
					budgets: { maxAgents: 16, maxParallelAgents: parallel },
				}),
			});
			if (!response.ok) throw await readError(response);
			const body = (await response.json()) as { run: ManagedRun; tasks: Task[] };
			setDetail({ run: body.run, tasks: body.tasks, events: [], approvals: [] });
			setSelectedTaskId(body.tasks[0]?.id ?? null);
			await loadProjectRuns(selectedProject.id);
			await loadDetail(body.run.id);
		} catch (e) { setError(e instanceof Error ? e.message : "Mission could not be started."); }
		finally { setBusy(null); }
	}

	async function cancelMission() {
		if (!detail?.run) return;
		setBusy("cancel");
		try {
			const response = await fetch(`/api/agent-platform/runs/${encodeURIComponent(detail.run.id)}/cancel`, { method: "POST" });
			if (!response.ok) throw await readError(response);
			await loadDetail(detail.run.id);
		} catch (e) { setError(e instanceof Error ? e.message : "Mission could not be cancelled."); }
		finally { setBusy(null); }
	}

	async function resolveApproval(approval: Approval, decision: "approve" | "reject") {
		setBusy(`approval-${approval.id}`);
		try {
			const response = await fetch(`/api/agent-platform/approvals/${encodeURIComponent(approval.id)}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ decision }),
			});
			if (!response.ok) throw await readError(response);
			if (detail) await loadDetail(detail.run.id);
		} catch (e) { setError(e instanceof Error ? e.message : "Approval could not be resolved."); }
		finally { setBusy(null); }
	}

	async function steerTask() {
		if (!detail || !selectedTask || steerText.trim().length < 2) return;
		setBusy("steer");
		try {
			const response = await fetch(`/api/agent-platform/runs/${encodeURIComponent(detail.run.id)}/tasks/${encodeURIComponent(selectedTask.id)}/steer`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ instruction: steerText.trim() }),
			});
			if (!response.ok) throw await readError(response);
			setSteerText("");
			await loadDetail(detail.run.id);
		} catch (e) { setError(e instanceof Error ? e.message : "Task could not be steered."); }
		finally { setBusy(null); }
	}

	if (sessionStatus !== "authenticated" || loading) {
		return <div className="grid min-h-[calc(100dvh-58px)] place-items-center bg-[#090b0e] text-[#8f949c]"><Loader2 className="size-5 animate-spin" /></div>;
	}

	return (
		<main className="min-h-[calc(100dvh-58px)] bg-[#090b0e] px-4 py-5 text-[#ecece8] md:px-6">
			<div className="mx-auto max-w-[1580px]">
				<div className="mb-5 flex flex-wrap items-end justify-between gap-4">
					<div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b89a51]">AIRA Build</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Autonomous mission control</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#858b94]">Give AIRA an outcome. The Manager creates a dependency graph, delegates specialist work in parallel, gates consequential actions, and records evidence.</p></div>
					{detail?.run ? <div className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", statusClass(detail.run.status))}>{detail.run.status.replaceAll("_", " ")}</div> : null}
				</div>
				{error ? <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200">{error}</div> : null}

				<div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
					<aside className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4">
						<div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Projects</h2><span className="text-[11px] text-[#666c75]">{projects.length}</span></div>
						<div className="mt-3 space-y-2">{projects.map((project) => <button key={project.id} type="button" onClick={() => { setSelectedProjectId(project.id); setDetail(null); setObjective(project.objective); }} className={cn("w-full rounded-xl border px-3 py-3 text-left transition", selectedProjectId === project.id ? "border-[#c5a34e]/30 bg-[#c5a34e]/[0.07]" : "border-white/[0.06] bg-[#0b0d10] hover:border-white/[0.12]")}><strong className="block truncate text-sm font-medium">{project.name}</strong><span className="mt-1 line-clamp-2 text-xs leading-5 text-[#777d86]">{project.objective}</span></button>)}</div>
						<div className="mt-4 border-t border-white/[0.06] pt-4"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#717780]">New project</p><input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" className="w-full rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-sm outline-none focus:border-[#c5a34e]/40"/><textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={4} placeholder="Outcome, constraints, stack, done condition…" className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-sm leading-5 outline-none focus:border-[#c5a34e]/40"/><button type="button" onClick={() => void createProject()} disabled={busy !== null || projectName.trim().length < 2 || objective.trim().length < 3} className="mt-2 w-full rounded-lg bg-[#d0ae55] px-3 py-2 text-sm font-semibold text-[#101114] disabled:opacity-40">Create project</button></div>
					</aside>

					<section className="min-w-0 space-y-4">
						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4 md:p-5">
							<div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-sm font-semibold">Mission objective</h2><p className="mt-1 text-xs text-[#707680]">One mission charge. Internal specialist workers do not consume additional monthly run quota.</p></div><div className="flex gap-2"><select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className="rounded-lg border border-white/[0.08] bg-[#0a0d11] px-2.5 py-2 text-xs"><option value="AUTO">Auto runtime</option><option value="AGENT_SWARM">Agent Swarm</option><option value="DEERFLOW">DeerFlow</option><option value="AUTOGPT">AutoGPT</option></select><select value={parallel} onChange={(e) => setParallel(Number(e.target.value))} className="rounded-lg border border-white/[0.08] bg-[#0a0d11] px-2.5 py-2 text-xs">{[1,2,3,4,5,6].map((value) => <option key={value} value={value}>{value} parallel</option>)}</select></div></div>
							<textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={4} placeholder={selectedProject?.objective ?? "Select or create a project…"} className="mt-4 w-full rounded-xl border border-white/[0.08] bg-[#090b0e] px-4 py-3 text-sm leading-6 outline-none focus:border-[#d0ae55]/40"/>
							<div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void startMission()} disabled={!selectedProject || busy !== null} className="inline-flex items-center gap-2 rounded-xl bg-[#d0ae55] px-4 py-2.5 text-sm font-semibold text-[#111214] disabled:opacity-40">{busy === "start" ? <Loader2 className="size-4 animate-spin"/> : <Play className="size-4"/>}Start mission</button>{activeRun ? <button type="button" onClick={() => void cancelMission()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/[0.05] px-4 py-2.5 text-sm text-red-200"><Square className="size-4"/>Stop</button> : null}{detail ? <button type="button" onClick={() => void loadDetail(detail.run.id)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-3 py-2.5 text-sm text-[#a4a9b0]"><RefreshCw className="size-4"/>Refresh</button> : null}</div>
						</div>

						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216]">
							<div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3"><div className="flex items-center gap-2"><Workflow className="size-4 text-[#b89a51]"/><h2 className="text-sm font-semibold">Execution graph</h2></div>{detail ? <span className="text-xs text-[#747a83]">{completedCount}/{detail.tasks.length} complete · {progress}%</span> : null}</div>
							{detail ? <div className="p-3"><div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full bg-[#c3a24f] transition-all" style={{ width: `${progress}%` }}/></div><div className="space-y-2">{detail.tasks.map((task) => <button key={task.id} type="button" onClick={() => setSelectedTaskId(task.id)} className={cn("flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left", selectedTaskId === task.id ? "border-[#c5a34e]/25 bg-[#c5a34e]/[0.05]" : "border-white/[0.055] bg-[#0a0d11]")}><span className="mt-0.5">{task.status === "COMPLETED" ? <CheckCircle2 className="size-4 text-emerald-300"/> : task.status === "FAILED" ? <XCircle className="size-4 text-red-300"/> : task.status === "RUNNING" ? <Loader2 className="size-4 animate-spin text-[#d0ae55]"/> : task.status === "APPROVAL_REQUIRED" ? <ShieldAlert className="size-4 text-amber-200"/> : <CircleDot className="size-4 text-[#707680]"/>}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="text-sm font-medium">{task.title}</strong><span className={cn("rounded-full border px-2 py-0.5 text-[10px]", statusClass(task.status))}>{task.status.replaceAll("_", " ")}</span></span><span className="mt-1 block text-xs text-[#727882]">{task.agentRole} · {task.modelTier} · attempt {task.attempt}/{task.maxAttempts}</span>{task.lastError ? <span className="mt-1 block text-xs text-red-300">{task.lastError}</span> : null}</span></button>)}</div></div> : <div className="px-6 py-16 text-center text-sm text-[#686e77]">Start a mission to materialize the Manager DAG.</div>}
						</div>
					</section>

					<aside className="space-y-4">
						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4"><div className="flex items-center gap-2"><Bot className="size-4 text-[#b89a51]"/><h2 className="text-sm font-semibold">Manager</h2></div>{detail ? <div className="mt-4 space-y-3 text-xs"><div className="flex justify-between"><span className="text-[#717780]">Runtime</span><span>{detail.run.runtime ?? "—"}</span></div><div className="flex justify-between"><span className="text-[#717780]">Parallelism</span><span>{detail.run.budgets.maxParallelAgents}</span></div><div className="flex justify-between"><span className="text-[#717780]">Mission ceiling</span><span>{detail.run.budgets.maxAgents} agents</span></div><div className="flex justify-between"><span className="text-[#717780]">Duration</span><span>{detail.run.budgets.maxDurationMinutes} min</span></div><div className="flex justify-between"><span className="text-[#717780]">Cost guard</span><span>${detail.run.budgets.maxCostUsd}</span></div></div> : <p className="mt-3 text-xs leading-5 text-[#717780]">The Manager owns task decomposition, dependencies, retries, approvals and final verification.</p>}</div>

						{detail?.approvals.length ? <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] p-4"><div className="flex items-center gap-2 text-amber-100"><ShieldAlert className="size-4"/><h2 className="text-sm font-semibold">Approval required</h2></div><div className="mt-3 space-y-3">{detail.approvals.map((approval) => <div key={approval.id} className="rounded-xl border border-amber-200/10 bg-black/10 p-3"><p className="text-sm font-medium">{approval.action}</p><p className="mt-1 text-xs text-[#9c9585]">Risk: {approval.risk}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => void resolveApproval(approval, "approve")} disabled={busy !== null} className="rounded-lg bg-emerald-300 px-3 py-1.5 text-xs font-semibold text-[#0d1511]">Approve</button><button type="button" onClick={() => void resolveApproval(approval, "reject")} disabled={busy !== null} className="rounded-lg border border-red-300/20 px-3 py-1.5 text-xs text-red-200">Reject</button></div></div>)}</div></div> : null}

						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4"><div className="flex items-center gap-2"><Send className="size-4 text-[#b89a51]"/><h2 className="text-sm font-semibold">Steer active agent</h2></div>{selectedTask ? <><p className="mt-2 text-xs leading-5 text-[#717780]">{selectedTask.title}</p><textarea value={steerText} onChange={(e) => setSteerText(e.target.value)} rows={3} placeholder="Redirect this specialist without restarting the mission…" className="mt-3 w-full rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-xs leading-5 outline-none"/><button type="button" onClick={() => void steerTask()} disabled={busy !== null || selectedTask.status !== "RUNNING" || steerText.trim().length < 2} className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/[0.09] px-3 py-2 text-xs disabled:opacity-35"><Send className="size-3.5"/>Send instruction</button></> : <p className="mt-3 text-xs text-[#717780]">Select a task to inspect or redirect it.</p>}</div>

						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4"><div className="flex items-center gap-2"><Activity className="size-4 text-[#b89a51]"/><h2 className="text-sm font-semibold">Evidence stream</h2></div><div className="mt-3 max-h-72 space-y-2 overflow-auto">{detail?.events.slice(-30).reverse().map((event) => <div key={event.id} className="border-l border-white/[0.08] pl-3"><p className="text-xs font-medium text-[#b8bcc2]">{event.type}</p><p className="mt-0.5 text-[10px] text-[#666c75]">{new Date(event.createdAt).toLocaleTimeString()}</p></div>) ?? <p className="text-xs text-[#717780]">No run events yet.</p>}</div></div>

						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4"><div className="flex items-center gap-2"><GitBranch className="size-4 text-[#b89a51]"/><h2 className="text-sm font-semibold">Recent missions</h2></div><div className="mt-3 space-y-2">{runs.slice(0, 6).map((run) => <button key={run.id} type="button" onClick={() => void loadDetail(run.id)} className="w-full rounded-lg border border-white/[0.06] bg-[#0a0d11] px-3 py-2 text-left"><span className="flex items-center justify-between gap-2"><span className="truncate text-xs">{run.runtime ?? "Runtime"}</span><span className={cn("rounded-full border px-1.5 py-0.5 text-[9px]", statusClass(run.status))}>{run.status}</span></span><span className="mt-1 block text-[10px] text-[#626872]">{new Date(run.createdAt).toLocaleString()}</span></button>)}</div></div>
					</aside>
				</div>
			</div>
		</main>
	);
}