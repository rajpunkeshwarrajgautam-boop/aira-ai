"use client";

import {
	AlertTriangle,
	ArrowLeft,
	Bot,
	CheckCircle2,
	Clock3,
	LoaderCircle,
	Play,
	RotateCw,
	Sparkles,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type AgentRunStatus =
	| "QUEUED"
	| "RUNNING"
	| "COMPLETED"
	| "FAILED"
	| "TERMINATED"
	| "REVIEW";

interface AgentRun {
	readonly id: string;
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

interface DashboardPayload {
	readonly runs: readonly AgentRun[];
	readonly feature: { readonly enabled: boolean; readonly configured: boolean };
	readonly usage: AgentUsage;
}

interface ApiErrorPayload {
	readonly error?: {
		readonly code?: string;
		readonly message?: string;
		readonly retryable?: boolean;
	};
}

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

const ACTIVE_STATUSES = new Set<AgentRunStatus>(["QUEUED", "RUNNING", "REVIEW"]);

function isActive(status: AgentRunStatus): boolean {
	return ACTIVE_STATUSES.has(status);
}

function statusMeta(status: AgentRunStatus): {
	readonly label: string;
	readonly className: string;
	readonly icon: typeof Clock3;
} {
	switch (status) {
		case "COMPLETED":
			return {
				label: "Completed",
				className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700",
				icon: CheckCircle2,
			};
		case "FAILED":
		case "TERMINATED":
			return {
				label: status === "FAILED" ? "Failed" : "Terminated",
				className: "border-red-500/25 bg-red-500/10 text-red-700",
				icon: AlertTriangle,
			};
		case "REVIEW":
			return {
				label: "Needs review",
				className: "border-amber-500/30 bg-amber-500/10 text-amber-700",
				icon: Clock3,
			};
		case "RUNNING":
			return {
				label: "Running",
				className: "border-accent/25 bg-accent/10 text-accent",
				icon: LoaderCircle,
			};
		case "QUEUED":
		default:
			return {
				label: "Queued",
				className: "border-border bg-surface-inset text-content-secondary",
				icon: Clock3,
			};
	}
}

function RunStatusBadge({
	status,
	compact = false,
}: {
	readonly status: AgentRunStatus;
	readonly compact?: boolean;
}) {
	const meta = statusMeta(status);
	const StatusIcon = meta.icon;

	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center rounded-full border font-semibold",
				compact ? "gap-1 px-2 py-0.5 text-[10px]" : "gap-1.5 px-2.5 py-1 text-xs",
				meta.className,
			)}
		>
			<StatusIcon className={cn(compact ? "size-3" : "size-3.5", status === "RUNNING" && "animate-spin")} aria-hidden />
			{meta.label}
		</span>
	);
}

function displayResult(result: unknown): string {
	if (typeof result === "string") return result;
	if (Array.isArray(result)) {
		const strings = result.flatMap((item) => {
			if (typeof item === "string") return [item];
			if (typeof item !== "object" || item === null) return [];
			return Object.values(item).filter((value): value is string => typeof value === "string");
		});
		if (strings.length > 0) return strings.join("\n\n");
	}
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return "The agent returned a result that cannot be displayed.";
	}
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
	const [feature, setFeature] = useState<DashboardPayload["feature"] | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [syncWarning, setSyncWarning] = useState<string | null>(null);

	const selectedRun = useMemo(
		() => runs.find((run) => run.id === selectedRunId) ?? null,
		[runs, selectedRunId],
	);
	const activeRunIds = useMemo(
		() => runs.filter((run) => isActive(run.status)).slice(0, 5).map((run) => run.id),
		[runs],
	);

	const loadDashboard = useCallback(async () => {
		const response = await fetch("/api/agents/runs?limit=30", {
			credentials: "include",
			cache: "no-store",
		});
		if (!response.ok) throw await readApiError(response);
		const data = (await response.json()) as DashboardPayload;
		setRuns(data.runs);
		setUsage(data.usage);
		setFeature(data.feature);
		setSelectedRunId((current) =>
			current && data.runs.some((run) => run.id === current)
				? current
				: (data.runs[0]?.id ?? null),
		);
	}, []);

	useEffect(() => {
		if (sessionStatus === "unauthenticated") {
			router.replace(`/signin?callbackUrl=${encodeURIComponent("/agents")}`);
			return;
		}
		if (sessionStatus !== "authenticated") return;
		void loadDashboard()
			.catch((loadError: unknown) => {
				setError(loadError instanceof Error ? loadError.message : "Agent tasks could not be loaded.");
			})
			.finally(() => setLoading(false));
	}, [loadDashboard, router, sessionStatus]);

	const syncRun = useCallback(async (runId: string) => {
		const response = await fetch(`/api/agents/runs/${encodeURIComponent(runId)}`, {
			credentials: "include",
			cache: "no-store",
		});
		if (!response.ok) throw await readApiError(response);
		const data = (await response.json()) as {
			readonly run: AgentRun;
			readonly syncWarning?: string;
		};
		setRuns((current) => current.map((run) => (run.id === data.run.id ? data.run : run)));
		setSyncWarning(data.syncWarning ?? null);
	}, []);

	useEffect(() => {
		if (activeRunIds.length === 0) return;
		const poll = () => {
			void Promise.allSettled(activeRunIds.map((runId) => syncRun(runId)));
		};
		const timer = window.setInterval(poll, 4_000);
		return () => window.clearInterval(timer);
	}, [activeRunIds, syncRun]);

	const startTask = useCallback(async () => {
		const trimmed = objective.trim();
		if (trimmed.length < 3 || submitting) return;
		setSubmitting(true);
		setError(null);
		setSyncWarning(null);
		try {
			const response = await fetch("/api/agents/runs", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					clientRequestId: crypto.randomUUID(),
					objective: trimmed,
				}),
			});
			if (!response.ok) throw await readApiError(response);
			const data = (await response.json()) as {
				readonly run: AgentRun;
				readonly agentRunsRemaining: number;
			};
			setRuns((current) => [data.run, ...current.filter((run) => run.id !== data.run.id)]);
			setSelectedRunId(data.run.id);
			setObjective("");
			setUsage((current) =>
				current
					? {
							...current,
							agentRunsRemaining: data.agentRunsRemaining,
							agentRunsUsed: Math.max(
								current.agentRunsUsed,
								current.monthlyAgentRunLimit - data.agentRunsRemaining,
							),
						}
					: current,
			);
		} catch (submitError) {
			setError(submitError instanceof Error ? submitError.message : "The agent task could not be started.");
			await loadDashboard().catch(() => undefined);
		} finally {
			setSubmitting(false);
		}
	}, [loadDashboard, objective, submitting]);

	if (sessionStatus !== "authenticated" || loading) {
		return (
			<div className="flex min-h-dvh items-center justify-center bg-surface text-content-secondary">
				<LoaderCircle className="mr-2 size-5 animate-spin" aria-hidden />
				Loading agent workspace…
			</div>
		);
	}

	const planAllowsAgents = Boolean(usage && usage.monthlyAgentRunLimit > 0);
	const canSubmit = Boolean(
		feature?.enabled &&
			feature.configured &&
			planAllowsAgents &&
			usage &&
			usage.agentRunsRemaining > 0,
	);
	const usagePercent = usage?.monthlyAgentRunLimit
		? Math.min(100, (usage.agentRunsUsed / usage.monthlyAgentRunLimit) * 100)
		: 0;

	return (
		<main className="min-h-dvh bg-surface px-4 py-5 md:px-6 md:py-6">
			<div className="mx-auto max-w-7xl">
				<header className="mb-6 flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-3">
						<Button asChild variant="ghost" size="sm" className="rounded-xl">
							<Link href="/">
								<ArrowLeft aria-hidden />
								Research
							</Link>
						</Button>
						<div className="h-6 w-px bg-border-subtle" aria-hidden />
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
								Aira Agent Workspace
							</p>
							<h1 className="text-lg font-semibold text-content-primary">Autonomous tasks</h1>
						</div>
					</div>
					<UserMenu />
				</header>

				<div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
					<section className="space-y-5" aria-labelledby="new-agent-task-heading">
						<div className="overflow-hidden rounded-3xl border border-border-subtle bg-surface-elevated/85 shadow-panel backdrop-blur-md">
							<div className="border-b border-border-subtle bg-[radial-gradient(circle_at_top_right,hsl(var(--accent)/0.18),transparent_52%)] p-6">
								<div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-accent text-white shadow-float">
									<Bot className="size-5" aria-hidden />
								</div>
								<h2 id="new-agent-task-heading" className="text-xl font-semibold text-content-primary">
									Give Aira an outcome
								</h2>
								<p className="mt-2 max-w-xl text-sm leading-6 text-content-secondary">
									Aira sends this objective to your controlled AutoGPT graph, tracks the run, and brings the final output back here.
								</p>
							</div>
							<div className="p-6">
								<label htmlFor="agent-objective" className="mb-2 block text-sm font-semibold text-content-primary">
									Task objective
								</label>
								<textarea
									id="agent-objective"
									value={objective}
									onChange={(event) => setObjective(event.target.value.slice(0, 4_000))}
									rows={7}
									maxLength={4_000}
									placeholder="Example: Research the five strongest AI workflow opportunities for Indian real-estate firms and return a prioritized launch brief with evidence."
									className="w-full resize-y rounded-2xl border border-border-subtle bg-surface-inset/70 px-4 py-3 text-sm leading-6 text-content-primary outline-none transition placeholder:text-content-tertiary focus:border-accent/50 focus:ring-2 focus:ring-accent/15"
									disabled={!canSubmit || submitting}
								/>
								<div className="mt-2 flex items-center justify-between gap-3 text-xs text-content-tertiary">
									<span>Be specific about the deliverable, constraints, and success criteria.</span>
									<span>{objective.length.toLocaleString()}/4,000</span>
								</div>

								{error ? (
									<p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700" role="alert">
										{error}
									</p>
								) : null}
								{syncWarning ? (
									<p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-800" role="status">
										{syncWarning}
									</p>
								) : null}

								<div className="mt-5 flex flex-wrap items-center gap-3">
									<Button
										type="button"
										size="lg"
										className="h-11 rounded-xl px-5"
										disabled={!canSubmit || submitting || objective.trim().length < 3}
										onClick={() => void startTask()}
									>
										{submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}
										{submitting ? "Starting…" : "Start agent task"}
									</Button>
									{!planAllowsAgents ? (
										<Button asChild variant="outline" size="lg" className="h-11 rounded-xl">
											<Link href="/upgrade">
												<Sparkles aria-hidden />
												Unlock agents
											</Link>
										</Button>
									) : null}
								</div>
							</div>
						</div>

						{feature && (!feature.enabled || !feature.configured) ? (
							<div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-900">
								<div className="flex items-start gap-3">
									<AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
									<div>
										<p className="font-semibold">Agent runtime setup is incomplete</p>
									<p className="mt-1 leading-6">Tasks stay disabled until Aira&apos;s AutoGPT graph and restricted API key are configured.</p>
									</div>
								</div>
							</div>
						) : null}

						<div className="rounded-2xl border border-border-subtle bg-surface-elevated/70 p-5">
							<div className="flex items-center justify-between gap-4">
								<div className="flex items-center gap-3">
									<span className="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
										<Zap className="size-4" aria-hidden />
									</span>
									<div>
										<p className="text-sm font-semibold text-content-primary">{usage?.billingPlan ?? "Free"} plan</p>
										<p className="text-xs text-content-tertiary">
											{usage?.monthlyAgentRunLimit
												? `${usage.agentRunsRemaining} of ${usage.monthlyAgentRunLimit} agent tasks remaining`
												: "Agent tasks are available on Pro and Team"}
										</p>
									</div>
								</div>
								{usage?.billingPlan === "FREE" ? (
									<Link href="/upgrade" className="text-xs font-semibold text-accent hover:underline">View plans</Link>
								) : null}
							</div>
							<div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-inset" aria-hidden>
								<div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${usagePercent}%` }} />
							</div>
						</div>
					</section>

					<section className="min-h-[620px] overflow-hidden rounded-3xl border border-border-subtle bg-surface-elevated/80 shadow-panel" aria-labelledby="agent-runs-heading">
						<div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
							<div>
								<h2 id="agent-runs-heading" className="font-semibold text-content-primary">Task history</h2>
								<p className="text-xs text-content-tertiary">Persistent, private, and tied to your account</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Refresh tasks"
								onClick={() =>
									void loadDashboard().catch((loadError: unknown) => {
										setError(loadError instanceof Error ? loadError.message : "Agent tasks could not be refreshed.");
									})
								}
							>
								<RotateCw aria-hidden />
							</Button>
						</div>

						{runs.length === 0 ? (
							<div className="flex min-h-[520px] flex-col items-center justify-center px-8 text-center">
								<span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-inset text-content-tertiary">
									<Bot className="size-6" aria-hidden />
								</span>
								<p className="font-semibold text-content-primary">No agent tasks yet</p>
								<p className="mt-2 max-w-sm text-sm leading-6 text-content-secondary">Your submitted tasks and final outputs appear here.</p>
							</div>
						) : (
							<div className="grid min-h-[560px] md:grid-cols-[220px_minmax(0,1fr)]">
								<div className="max-h-[640px] overflow-y-auto border-b border-border-subtle p-2 md:border-b-0 md:border-r">
									{runs.map((run) => {
										return (
											<button
												key={run.id}
												type="button"
												onClick={() => {
													setSelectedRunId(run.id);
													if (isActive(run.status)) void syncRun(run.id);
												}}
												className={cn(
													"mb-1 w-full rounded-xl border px-3 py-3 text-left transition",
													selectedRunId === run.id
														? "border-accent/30 bg-accent/10"
														: "border-transparent hover:border-border-subtle hover:bg-surface-inset/70",
												)}
											>
												<p className="line-clamp-2 text-xs font-medium leading-5 text-content-primary">{run.objective}</p>
												<span className="mt-2 block">
													<RunStatusBadge status={run.status} compact />
												</span>
											</button>
										);
									})}
								</div>

								<div className="min-w-0 p-5 md:p-6" aria-live="polite">
									{selectedRun ? (
										<div>
											<div className="flex flex-wrap items-start justify-between gap-3">
												<div>
													<p className="text-xs font-semibold uppercase tracking-[0.14em] text-content-tertiary">Objective</p>
													<p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-content-primary">{selectedRun.objective}</p>
												</div>
												<RunStatusBadge status={selectedRun.status} />
											</div>

											<div className="my-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-border-subtle py-3 text-xs text-content-tertiary">
												<span>Started {DATE_FORMATTER.format(new Date(selectedRun.createdAt))}</span>
												{selectedRun.completedAt ? <span>Finished {DATE_FORMATTER.format(new Date(selectedRun.completedAt))}</span> : null}
											</div>

											{selectedRun.status === "COMPLETED" ? (
												<div>
													<p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-content-tertiary">Result</p>
													<pre className="max-h-[430px] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-border-subtle bg-surface-inset p-4 font-sans text-sm leading-6 text-content-secondary">{displayResult(selectedRun.result)}</pre>
												</div>
											) : selectedRun.errorMessage ? (
												<p className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-700">{selectedRun.errorMessage}</p>
											) : (
												<div className="rounded-2xl border border-accent/20 bg-accent/5 p-5">
													<div className="flex items-center gap-3">
														<LoaderCircle className="size-5 animate-spin text-accent" aria-hidden />
														<div>
															<p className="text-sm font-semibold text-content-primary">AutoGPT is working on this task</p>
															<p className="mt-1 text-xs leading-5 text-content-secondary">This page checks for progress automatically. You can leave and return later.</p>
														</div>
													</div>
												</div>
											)}
										</div>
									) : null}
								</div>
							</div>
						)}
					</section>
				</div>
			</div>
		</main>
	);
}
