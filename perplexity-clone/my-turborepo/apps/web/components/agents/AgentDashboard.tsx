"use client";

import { AlertTriangle, Bot, CheckCircle2, Clock3, LoaderCircle, Play, RotateCw, Sparkles, Square, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type AgentRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "REVIEW";
type AgentProvider = "DEERFLOW" | "AUTOGPT";

interface AgentRun {
	readonly id: string;
	readonly provider: string;
	readonly objective: string;
	readonly status: AgentRunStatus;
	readonly result: unknown | null;
	readonly errorMessage: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly completedAt: string | null;
}

interface AgentUsage {
	readonly billingPlan: string;
	readonly monthlyAgentRunLimit: number;
	readonly agentRunsUsed: number;
	readonly agentRunsRemaining: number;
}

interface ProviderState {
	readonly enabled: boolean;
	readonly configured: boolean;
	readonly healthy: boolean | null;
	readonly ready: boolean;
}

interface AgentFeature {
	readonly enabled: boolean;
	readonly configured: boolean;
	readonly ready: boolean;
	readonly preferredProvider: AgentProvider | null;
	readonly providers: {
		readonly DEERFLOW: ProviderState;
		readonly AUTOGPT: ProviderState;
	};
}

interface DashboardPayload {
	readonly runs: readonly AgentRun[];
	readonly feature: AgentFeature;
	readonly usage: AgentUsage;
}

interface ApiErrorPayload {
	readonly error?: { readonly code?: string; readonly message?: string; readonly retryable?: boolean };
}

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const ACTIVE_STATUSES = new Set<AgentRunStatus>(["QUEUED", "RUNNING", "REVIEW"]);
function isActive(status: AgentRunStatus): boolean { return ACTIVE_STATUSES.has(status); }

function statusMeta(status: AgentRunStatus): { readonly label: string; readonly className: string; readonly icon: typeof Clock3 } {
	switch (status) {
		case "COMPLETED": return { label: "Completed", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700", icon: CheckCircle2 };
		case "FAILED":
		case "TERMINATED": return { label: status === "FAILED" ? "Failed" : "Stopped", className: "border-red-500/25 bg-red-500/10 text-red-700", icon: AlertTriangle };
		case "REVIEW": return { label: "Needs review", className: "border-amber-500/30 bg-amber-500/10 text-amber-700", icon: Clock3 };
		case "RUNNING": return { label: "Running", className: "border-accent/25 bg-accent/10 text-accent", icon: LoaderCircle };
		default: return { label: "Queued", className: "border-border bg-surface-inset text-content-secondary", icon: Clock3 };
	}
}

function RunStatusBadge({ status, compact = false }: { readonly status: AgentRunStatus; readonly compact?: boolean }) {
	const meta = statusMeta(status);
	const Icon = meta.icon;
	return <span className={cn("inline-flex shrink-0 items-center rounded-full border font-semibold shadow-sm", compact ? "gap-1 px-2 py-0.5 text-[10px]" : "gap-1.5 px-2.5 py-1 text-xs", meta.className)}><Icon className={cn(compact ? "size-3" : "size-3.5", status === "RUNNING" && "animate-spin")} aria-hidden />{meta.label}</span>;
}

function providerLabel(provider: string): string {
	return provider === "DEERFLOW" ? "DeerFlow 2.0" : provider === "AUTOGPT" ? "AutoGPT" : provider;
}

function displayResult(result: unknown): string {
	if (typeof result === "string") return result;
	if (result && typeof result === "object" && !Array.isArray(result)) {
		const output = (result as Record<string, unknown>).output;
		if (typeof output === "string" && output.trim()) return output;
	}
	if (Array.isArray(result)) {
		const strings = result.flatMap((item) => {
			if (typeof item === "string") return [item];
			if (typeof item !== "object" || item === null) return [];
			return Object.values(item).filter((value): value is string => typeof value === "string");
		});
		if (strings.length > 0) return strings.join("\n\n");
	}
	try { return JSON.stringify(result, null, 2); } catch { return "The agent returned a result that cannot be displayed."; }
}

async function readApiError(response: Response): Promise<Error> {
	const body = (await response.json().catch(() => null)) as ApiErrorPayload | null;
	return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function AgentDashboard() {
	const router = useRouter();
	const { status: sessionStatus } = useSession();
	const [objective, setObjective] = useState("");
	const [runs, setRuns] = useState<readonly AgentRun[]>([]);
	const [usage, setUsage] = useState<AgentUsage | null>(null);
	const [feature, setFeature] = useState<AgentFeature | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [syncWarning, setSyncWarning] = useState<string | null>(null);

	const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? null, [runs, selectedRunId]);
	const activeRunIds = useMemo(() => runs.filter((run) => isActive(run.status)).slice(0, 5).map((run) => run.id), [runs]);

	const loadDashboard = useCallback(async () => {
		const response = await fetch("/api/agents/runs?limit=30", { credentials: "include", cache: "no-store" });
		if (!response.ok) throw await readApiError(response);
		const data = (await response.json()) as DashboardPayload;
		setRuns(data.runs);
		setUsage(data.usage);
		setFeature(data.feature);
		setSelectedRunId((current) => current && data.runs.some((run) => run.id === current) ? current : (data.runs[0]?.id ?? null));
	}, []);

	useEffect(() => {
		if (sessionStatus === "unauthenticated") { router.replace(`/signin?callbackUrl=${encodeURIComponent("/agents")}`); return; }
		if (sessionStatus !== "authenticated") return;
		void loadDashboard().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Agent tasks could not be loaded.")).finally(() => setLoading(false));
	}, [loadDashboard, router, sessionStatus]);

	const syncRun = useCallback(async (runId: string) => {
		const response = await fetch(`/api/agents/runs/${encodeURIComponent(runId)}`, { credentials: "include", cache: "no-store" });
		if (!response.ok) throw await readApiError(response);
		const data = (await response.json()) as { readonly run: AgentRun; readonly syncWarning?: string };
		setRuns((current) => current.map((run) => run.id === data.run.id ? data.run : run));
		setSyncWarning(data.syncWarning ?? null);
	}, []);

	useEffect(() => {
		if (activeRunIds.length === 0) return;
		const timer = window.setInterval(() => { void Promise.allSettled(activeRunIds.map((runId) => syncRun(runId))); }, 4_000);
		return () => window.clearInterval(timer);
	}, [activeRunIds, syncRun]);

	const startTask = useCallback(async () => {
		const trimmed = objective.trim();
		if (trimmed.length < 3 || submitting) return;
		setSubmitting(true); setError(null); setSyncWarning(null);
		try {
			const response = await fetch("/api/agents/runs", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientRequestId: crypto.randomUUID(), objective: trimmed }) });
			if (!response.ok) throw await readApiError(response);
			const data = (await response.json()) as { readonly run: AgentRun; readonly agentRunsRemaining: number };
			setRuns((current) => [data.run, ...current.filter((run) => run.id !== data.run.id)]);
			setSelectedRunId(data.run.id);
			setObjective("");
			setUsage((current) => current ? { ...current, agentRunsRemaining: data.agentRunsRemaining, agentRunsUsed: Math.max(current.agentRunsUsed, current.monthlyAgentRunLimit - data.agentRunsRemaining) } : current);
		} catch (submitError) {
			setError(submitError instanceof Error ? submitError.message : "The agent task could not be started.");
			await loadDashboard().catch(() => undefined);
		} finally { setSubmitting(false); }
	}, [loadDashboard, objective, submitting]);

	const stopTask = useCallback(async (run: AgentRun) => {
		if (run.provider !== "DEERFLOW" || !isActive(run.status) || cancellingRunId) return;
		setCancellingRunId(run.id); setError(null);
		try {
			const response = await fetch(`/api/agents/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST", credentials: "include" });
			if (!response.ok) throw await readApiError(response);
			const data = (await response.json()) as { readonly run: AgentRun };
			setRuns((current) => current.map((item) => item.id === data.run.id ? data.run : item));
			window.setTimeout(() => { void syncRun(run.id).catch(() => undefined); }, 750);
		} catch (cancelError) {
			setError(cancelError instanceof Error ? cancelError.message : "The agent task could not be stopped.");
		} finally { setCancellingRunId(null); }
	}, [cancellingRunId, syncRun]);

	if (sessionStatus !== "authenticated" || loading) {
		return <div className="aira-shell flex min-h-dvh flex-col items-center justify-center gap-3 text-content-secondary"><span className="aira-orbit-loader" aria-hidden /><span>Loading agent workspace…</span></div>;
	}

	const planAllowsAgents = Boolean(usage && usage.monthlyAgentRunLimit > 0);
	const canSubmit = Boolean(feature?.ready && planAllowsAgents && usage && usage.agentRunsRemaining > 0);
	const usagePercent = usage?.monthlyAgentRunLimit ? Math.min(100, (usage.agentRunsUsed / usage.monthlyAgentRunLimit) * 100) : 0;
	const runtimeName = feature?.preferredProvider === "DEERFLOW" ? "DeerFlow 2.0 SuperAgent" : feature?.preferredProvider === "AUTOGPT" ? "AutoGPT fallback" : "Agent runtime";
	const deerFlowConfiguredButDown = Boolean(feature?.providers.DEERFLOW.configured && !feature.providers.DEERFLOW.healthy);

	return (
		<main className="aira-shell min-h-dvh text-content-primary">
			<WorkspaceHeader />
			<div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-12">
				<div className="aira-enter mx-auto mb-8 max-w-3xl text-center">
					<span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-violet-500 text-white shadow-[0_14px_34px_hsl(var(--accent)/0.22)]"><Bot className="size-5" aria-hidden /></span>
					<h1 className="aira-display mt-5 text-4xl sm:text-5xl">Give Aira an outcome.</h1>
					<p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-content-tertiary sm:text-base">Run long-horizon work through AIRA&apos;s controlled SuperAgent layer. DeerFlow can plan, delegate to subagents, use tools and skills, work in sandboxes, retain its runtime memory, and return the final output here.</p>
				</div>

				<div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
					<section className="space-y-4" aria-labelledby="new-agent-task-heading">
						<div className="aira-card aira-agent-objective aira-fun-card rounded-3xl p-5 sm:p-6">
							<div className="relative z-[1] flex items-center justify-between gap-3">
								<div><h2 id="new-agent-task-heading" className="text-base font-semibold">New SuperAgent task</h2><p className="mt-1 text-xs text-content-tertiary">Be specific about the deliverable, constraints, and success criteria.</p></div>
								<span className={cn("aira-status-pill rounded-full py-1 pl-5 pr-2.5 text-[11px] font-semibold", feature?.ready ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-800")}>{feature?.ready ? runtimeName : "Runtime offline"}</span>
							</div>
							<textarea id="agent-objective" value={objective} onChange={(event) => setObjective(event.target.value.slice(0, 4_000))} rows={8} maxLength={4_000} placeholder="Example: Research the five strongest AI workflow opportunities for Indian real-estate firms and return a prioritized launch brief with evidence." className="relative z-[1] mt-5 w-full resize-y rounded-2xl border border-border-subtle bg-white/72 px-4 py-3 text-sm leading-6 text-content-primary outline-none transition placeholder:text-content-tertiary focus:border-accent/35 focus:bg-white focus:ring-4 focus:ring-accent/[0.06]" disabled={!canSubmit || submitting} />
							<div className="relative z-[1] mt-2 flex items-center justify-between text-xs text-content-tertiary"><span>{canSubmit ? `${runtimeName} will execute this task under AIRA's safety and quota controls.` : "Complete the runtime and plan requirements below to enable tasks."}</span><span>{objective.length.toLocaleString()}/4,000</span></div>
							{error ? <p className="relative z-[1] mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
							{syncWarning ? <p className="relative z-[1] mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">{syncWarning}</p> : null}
							<div className="relative z-[1] mt-5 flex flex-wrap gap-2.5">
								<Button type="button" size="lg" className="aira-shine-button h-11 rounded-xl px-5" disabled={!canSubmit || submitting || objective.trim().length < 3} onClick={() => void startTask()}>{submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}{submitting ? "Starting…" : "Start task"}</Button>
								{!planAllowsAgents ? <Button asChild variant="outline" size="lg" className="aira-provider-button h-11 rounded-xl"><Link href="/upgrade"><Sparkles aria-hidden />Unlock agents</Link></Button> : null}
							</div>
						</div>

						{feature && !feature.ready ? (
							<div className="aira-glass rounded-3xl border-amber-200/80 p-4 text-sm text-amber-900"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /><div><p className="font-semibold">{deerFlowConfiguredButDown ? "DeerFlow runtime is unreachable" : "Agent runtime is not connected yet"}</p><p className="mt-1 text-xs leading-5">{deerFlowConfiguredButDown ? "AIRA can see the DeerFlow configuration, but its live health check is failing. New tasks stay disabled until the Gateway is healthy or the AutoGPT fallback is available." : "Tasks remain safely disabled until a DeerFlow SuperAgent Gateway or the controlled AutoGPT fallback is configured."}</p></div></div></div>
						) : null}

						<div className="aira-card aira-fun-card rounded-3xl p-5">
							<div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent/15 to-violet-500/10 text-accent"><Zap className="size-4" /></span><div><p className="text-sm font-semibold">{usage?.billingPlan ?? "Free"} plan</p><p className="text-xs text-content-tertiary">{usage?.monthlyAgentRunLimit ? `${usage.agentRunsRemaining} of ${usage.monthlyAgentRunLimit} agent tasks remaining` : "Agent tasks are available on Pro and Team"}</p></div></div>{usage?.billingPlan === "FREE" ? <Link href="/upgrade" className="text-xs font-semibold text-accent">View plans →</Link> : null}</div>
							<div className="aira-progress-track mt-4 h-1.5 overflow-hidden rounded-full bg-surface-inset"><div className="h-full rounded-full bg-gradient-to-r from-accent to-violet-500 transition-[width]" style={{ width: `${usagePercent}%` }} /></div>
						</div>
					</section>

					<section className="aira-card min-h-[560px] overflow-hidden rounded-3xl" aria-labelledby="agent-runs-heading">
						<div className="flex items-center justify-between border-b border-border-subtle px-5 py-4"><div><h2 id="agent-runs-heading" className="text-sm font-semibold">Task history</h2><p className="mt-0.5 text-xs text-content-tertiary">Private and tied to your account</p></div><Button variant="ghost" size="icon" className="aira-provider-button size-9 rounded-xl" aria-label="Refresh tasks" onClick={() => void loadDashboard().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Agent tasks could not be refreshed."))}><RotateCw className="size-4" /></Button></div>
						{runs.length === 0 ? (
							<div className="flex min-h-[470px] flex-col items-center justify-center px-8 text-center"><span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/10 to-violet-500/10 text-accent ring-1 ring-accent/10"><Bot className="size-5" /></span><p className="mt-4 text-sm font-semibold">No agent tasks yet</p><p className="mt-1 max-w-sm text-xs leading-5 text-content-tertiary">When the runtime is ready, submitted SuperAgent tasks and their outputs will appear here.</p></div>
						) : (
							<div className="grid min-h-[500px] md:grid-cols-[210px_minmax(0,1fr)]">
								<div className="max-h-[620px] overflow-y-auto border-b border-border-subtle p-2 md:border-b-0 md:border-r">{runs.map((run) => <button key={run.id} type="button" onClick={() => { setSelectedRunId(run.id); if (isActive(run.status)) void syncRun(run.id); }} className={cn("mb-1 w-full rounded-xl px-3 py-3 text-left transition-all duration-200", selectedRunId === run.id ? "bg-gradient-to-r from-accent/[0.08] to-violet-500/[0.04] shadow-sm ring-1 ring-accent/10" : "hover:translate-x-0.5 hover:bg-surface-inset/60")}><p className="line-clamp-2 text-xs font-medium leading-5 text-content-primary">{run.objective}</p><div className="mt-2 flex flex-wrap items-center gap-1.5"><RunStatusBadge status={run.status} compact /><span className="rounded-full bg-surface-inset px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-content-tertiary">{providerLabel(run.provider)}</span></div></button>)}</div>
								<div className="min-w-0 p-5 md:p-6" aria-live="polite">{selectedRun ? <div><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-content-tertiary">Objective</p><span className="rounded-full bg-surface-inset px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-content-tertiary">{providerLabel(selectedRun.provider)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-content-primary">{selectedRun.objective}</p></div><RunStatusBadge status={selectedRun.status} /></div><div className="my-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border-subtle py-3 text-xs text-content-tertiary"><span>Started {DATE_FORMATTER.format(new Date(selectedRun.createdAt))}</span>{selectedRun.completedAt ? <span>Finished {DATE_FORMATTER.format(new Date(selectedRun.completedAt))}</span> : null}{selectedRun.provider === "DEERFLOW" && isActive(selectedRun.status) ? <Button type="button" variant="outline" size="sm" className="ml-auto h-8 rounded-lg text-xs" disabled={cancellingRunId === selectedRun.id} onClick={() => void stopTask(selectedRun)}>{cancellingRunId === selectedRun.id ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Square className="size-3" aria-hidden />}{cancellingRunId === selectedRun.id ? "Stopping…" : "Stop task"}</Button> : null}</div>{selectedRun.status === "COMPLETED" ? <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-content-tertiary">Result</p><pre className="max-h-[430px] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-surface-inset p-4 font-sans text-sm leading-6 text-content-secondary ring-1 ring-border-subtle/70">{displayResult(selectedRun.result)}</pre></div> : selectedRun.errorMessage ? <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">{selectedRun.errorMessage}</p> : <div className="aira-glass rounded-2xl p-5"><div className="flex items-center gap-3"><span className="aira-orbit-loader shrink-0" aria-hidden /><div><p className="text-sm font-semibold">Aira is working on this task</p><p className="mt-1 text-xs leading-5 text-content-tertiary">Progress refreshes automatically. DeerFlow tasks continue server-side even if you leave this page.</p></div></div></div>}</div> : null}</div>
							</div>
						)}
					</section>
				</div>
			</div>
		</main>
	);
}
