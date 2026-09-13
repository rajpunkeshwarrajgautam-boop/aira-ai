"use client";

import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Clock,
	DollarSign,
	ExternalLink,
	FileCheck,
	Loader2,
	RefreshCw,
	Shield,
	ShieldAlert,
	StopCircle,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

interface PlatformRun {
	id: string;
	projectId: string;
	status: string;
	runtime?: string | null;
	summary?: string | null;
	knownCostUsd?: number | null;
	inputTokensUsed?: number | null;
	outputTokensUsed?: number | null;
	cachedTokensUsed?: number | null;
	budgets?: {
		maxAgents?: number;
		maxParallelAgents?: number;
		maxCostUsd?: number;
		maxTokens?: number;
		maxDurationMinutes?: number;
		maxRetries?: number;
	};
	startedAt?: string | null;
	completedAt?: string | null;
	createdAt: string;
}

interface PlatformProject {
	id: string;
	name: string;
	objective: string;
}

interface PlatformTask {
	id: string;
	key: string;
	title: string;
	agentRole: string;
	modelTier: string;
	priority: number;
	status: string;
	attempt: number;
	maxAttempts: number;
	dependencies: string[];
	outputArtifacts: string[];
	lastError?: string | null;
	completedAt?: string | null;
}

interface PlatformEvent {
	id: string;
	type: string;
	payload: Record<string, unknown>;
	createdAt: string;
}

interface PlatformApproval {
	id: string;
	action: string;
	risk: string;
	status: string;
	context?: Record<string, unknown>;
	createdAt: string;
}

interface PlatformArtifact {
	id: string;
	name: string;
	kind: string;
	uri: string;
	createdAt: string;
}

interface RunDetailsResponse {
	run: PlatformRun;
	project?: PlatformProject | null;
	tasks: PlatformTask[];
	events: PlatformEvent[];
	approvals: PlatformApproval[];
	artifacts: PlatformArtifact[];
}

function statusColor(status: string): { bg: string; text: string; border: string } {
	switch (status) {
		case "COMPLETED":
		case "SUCCEEDED":
			return { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" };
		case "RUNNING":
		case "PLANNING":
			return { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" };
		case "APPROVAL_REQUIRED":
		case "WAITING":
			return { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" };
		case "FAILED":
			return { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" };
		case "CANCELLED":
			return { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/30" };
		case "BLOCKED":
			return { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/30" };
		default:
			return { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" };
	}
}

export function WorkRunMissionControl() {
	const params = useParams();
	const router = useRouter();
	const { status: authStatus } = useSession();
	const runId = typeof params?.runId === "string" ? params.runId : "";

	const [data, setData] = useState<RunDetailsResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionPending, setActionPending] = useState<string | null>(null);

	const fetchData = useCallback(async (quiet = false) => {
		if (!runId) return;
		if (!quiet) setLoading(true);
		try {
			const res = await fetch(`/api/agent-platform/runs/${encodeURIComponent(runId)}`, {
				cache: "no-store",
			});
			if (!res.ok) {
				if (res.status === 401) {
					router.push(`/signin?callbackUrl=${encodeURIComponent(`/work/runs/${runId}`)}`);
					return;
				}
				if (res.status === 404) {
					setError("Managed run not found or you do not have permission to view it.");
					return;
				}
				throw new Error(`Failed to load run details (${res.status}).`);
			}
			const json = (await res.json()) as RunDetailsResponse;
			setData(json);
			setError(null);
		} catch (err) {
			if (!quiet) {
				setError(err instanceof Error ? err.message : "Error loading run details.");
			}
		} finally {
			if (!quiet) setLoading(false);
		}
	}, [runId, router]);

	useEffect(() => {
		if (authStatus === "loading") return;
		if (authStatus !== "authenticated") {
			router.push(`/signin?callbackUrl=${encodeURIComponent(`/work/runs/${runId}`)}`);
			return;
		}
		void fetchData();
	}, [authStatus, fetchData, runId, router]);

	// Auto-poll while run is actively processing
	useEffect(() => {
		if (!data) return;
		const activeStatuses = ["QUEUED", "PLANNING", "RUNNING", "WAITING", "APPROVAL_REQUIRED"];
		if (!activeStatuses.includes(data.run.status)) return;

		const interval = setInterval(() => {
			void fetchData(true);
		}, 3000);

		return () => clearInterval(interval);
	}, [data, fetchData]);

	async function handleCancel() {
		if (!runId || actionPending) return;
		setActionPending("cancel");
		try {
			const res = await fetch(`/api/agent-platform/runs/${encodeURIComponent(runId)}/cancel`, {
				method: "POST",
			});
			if (!res.ok) {
				throw new Error(`Cancel request failed (${res.status}).`);
			}
			await fetchData(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Cancel request failed.");
		} finally {
			setActionPending(null);
		}
	}

	async function handleApproval(approvalId: string, decision: "approve" | "reject") {
		if (actionPending) return;
		setActionPending(approvalId);
		try {
			const res = await fetch(`/api/agent-platform/approvals/${encodeURIComponent(approvalId)}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ decision }),
			});
			if (!res.ok) {
				throw new Error(`Approval decision failed (${res.status}).`);
			}
			await fetchData(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Approval request failed.");
		} finally {
			setActionPending(null);
		}
	}

	if (loading && !data) {
		return (
			<main className="flex min-h-[calc(100dvh-58px)] items-center justify-center bg-[#090b0e] text-[#ecece8]">
				<div className="flex items-center gap-3 text-sm text-[#858b94]">
					<Loader2 className="size-5 animate-spin text-[#d0ae55]" />
					<span>Loading Work Mission Control…</span>
				</div>
			</main>
		);
	}

	if (error && !data) {
		return (
			<main className="min-h-[calc(100dvh-58px)] bg-[#090b0e] px-4 py-8 text-[#ecece8] md:px-8">
				<div className="mx-auto max-w-4xl space-y-4">
					<Link href="/work" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#858b94] hover:text-[#d0ae55]">
						<ArrowLeft className="size-3.5" /> Back to Work
					</Link>
					<div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-6">
						<div className="flex items-start gap-3">
							<AlertCircle className="size-5 text-red-400 mt-0.5" />
							<div>
								<h1 className="text-base font-semibold text-red-200">Execution Error</h1>
								<p className="mt-1 text-sm text-[#858b94]">{error}</p>
							</div>
						</div>
					</div>
				</div>
			</main>
		);
	}

	if (!data) return null;

	const { run, project, tasks, events, approvals, artifacts } = data;
	const colors = statusColor(run.status);
	const isActive = ["QUEUED", "PLANNING", "RUNNING", "WAITING", "APPROVAL_REQUIRED"].includes(run.status);
	const pendingApprovals = approvals.filter((a) => a.status === "PENDING");
	const completedCount = tasks.filter((t) => t.status === "COMPLETED").length;
	const totalCost = Number(run.knownCostUsd ?? 0);
	const maxCost = Number(run.budgets?.maxCostUsd ?? 5);

	return (
		<main className="min-h-[calc(100dvh-58px)] bg-[#090b0e] px-4 py-6 text-[#ecece8] md:px-8">
			<div className="mx-auto max-w-6xl space-y-6">
				{/* Navigation & Header */}
				<header className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Link href="/work" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#858b94] hover:text-[#d0ae55]">
							<ArrowLeft className="size-3.5" /> Back to Work
						</Link>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => void fetchData(false)}
								className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#14181d] px-3 py-1.5 text-xs font-medium text-[#d8d8d4] hover:bg-[#1a2026]"
							>
								<RefreshCw className="size-3" /> Refresh
							</button>
							{isActive && (
								<button
									type="button"
									onClick={() => void handleCancel()}
									disabled={actionPending === "cancel"}
									className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-40"
								>
									{actionPending === "cancel" ? <Loader2 className="size-3 animate-spin" /> : <StopCircle className="size-3" />}
									Cancel Run
								</button>
							)}
						</div>
					</div>

					<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
						<div>
							<div className="flex items-center gap-2.5">
								<span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b89a51]">Work Mission</span>
								<span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${colors.bg} ${colors.text} ${colors.border}`}>
									{run.status}
								</span>
							</div>
							<h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] md:text-2xl text-[#f3f3ee]">
								{project?.name ?? `Run · ${run.id.slice(0, 8)}`}
							</h1>
							<p className="mt-1 text-xs text-[#747a82] font-mono break-all">ID: {run.id}</p>
						</div>
					</div>

					{project?.objective && (
						<div className="rounded-xl border border-white/[0.06] bg-[#0c0f13] p-4 text-xs leading-5 text-[#c4c7cc]">
							<span className="font-semibold text-[#deded9]">Objective: </span>
							{project.objective}
						</div>
					)}
				</header>

				{/* Top Metrics Cards */}
				<section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div className="rounded-xl border border-white/[0.08] bg-[#0f1216] p-4">
						<div className="flex items-center gap-2 text-xs text-[#858b94]">
							<DollarSign className="size-3.5 text-[#d0ae55]" />
							<span>Cost / Budget</span>
						</div>
						<p className="mt-1 text-base font-semibold text-[#f0f0eb]">
							${totalCost.toFixed(3)}{" "}
							<span className="text-xs font-normal text-[#747a82]">/ ${maxCost.toFixed(2)}</span>
						</p>
					</div>

					<div className="rounded-xl border border-white/[0.08] bg-[#0f1216] p-4">
						<div className="flex items-center gap-2 text-xs text-[#858b94]">
							<FileCheck className="size-3.5 text-[#d0ae55]" />
							<span>Tasks Completed</span>
						</div>
						<p className="mt-1 text-base font-semibold text-[#f0f0eb]">
							{completedCount}{" "}
							<span className="text-xs font-normal text-[#747a82]">/ {tasks.length}</span>
						</p>
					</div>

					<div className="rounded-xl border border-white/[0.08] bg-[#0f1216] p-4">
						<div className="flex items-center gap-2 text-xs text-[#858b94]">
							<Clock className="size-3.5 text-[#d0ae55]" />
							<span>Started</span>
						</div>
						<p className="mt-1 text-xs font-medium text-[#c4c7cc] truncate">
							{run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "Pending"}
						</p>
					</div>

					<div className="rounded-xl border border-white/[0.08] bg-[#0f1216] p-4">
						<div className="flex items-center gap-2 text-xs text-[#858b94]">
							<Shield className="size-3.5 text-[#d0ae55]" />
							<span>Runtime</span>
						</div>
						<p className="mt-1 text-xs font-medium text-[#c4c7cc]">
							{run.runtime ?? "AIRA_AGENT"}
						</p>
					</div>
				</section>

				{/* Pending Approvals (Gate 19, 20) */}
				{pendingApprovals.length > 0 && (
					<section className="rounded-2xl border border-purple-500/30 bg-purple-500/[0.07] p-5 space-y-4">
						<div className="flex items-center gap-2">
							<ShieldAlert className="size-5 text-purple-400" />
							<h2 className="text-sm font-semibold text-purple-200">Human Approval Required</h2>
						</div>
						<p className="text-xs leading-5 text-[#b0b4ba]">
							Consequential or elevated-risk operations require explicit user approval before managed execution proceeds.
						</p>
						<div className="space-y-3">
							{pendingApprovals.map((approval) => (
								<div key={approval.id} className="flex flex-col gap-3 rounded-xl border border-purple-500/20 bg-[#120f18] p-4 md:flex-row md:items-center md:justify-between">
									<div>
										<p className="text-xs font-semibold text-[#f0f0eb]">{approval.action}</p>
										<p className="mt-0.5 text-[11px] text-[#8d929b]">Risk Level: <span className="text-purple-300 font-medium">{approval.risk}</span></p>
									</div>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => void handleApproval(approval.id, "reject")}
											disabled={actionPending === approval.id}
											className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20"
										>
											<XCircle className="size-3.5" /> Reject
										</button>
										<button
											type="button"
											onClick={() => void handleApproval(approval.id, "approve")}
											disabled={actionPending === approval.id}
											className="inline-flex items-center gap-1.5 rounded-lg bg-[#d0ae55] px-3 py-1.5 text-xs font-semibold text-[#111214] hover:bg-[#d8b65e]"
										>
											{actionPending === approval.id ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
											Approve & Proceed
										</button>
									</div>
								</div>
							))}
						</div>
					</section>
				)}

				{/* Two Column Layout: Tasks & Timeline */}
				<div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
					{/* Left: Task Graph & Deliverables */}
					<div className="space-y-6">
						{/* Persisted Deliverables (Gate 27) */}
						<section className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5">
							<h2 className="text-sm font-semibold text-[#f0f0eb]">Persisted Deliverables</h2>
							<p className="mt-1 text-xs text-[#747a82]">Durable outputs and evidence created by completed tasks.</p>
							{artifacts.length === 0 ? (
								<p className="mt-4 text-xs italic text-[#5f656d]">
									{isActive ? "Deliverables will appear here as tasks finish." : "No durable deliverables recorded for this run."}
								</p>
							) : (
								<div className="mt-4 space-y-2">
									{artifacts.map((artifact) => (
										<div key={artifact.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#0c0f13] px-3.5 py-2.5">
											<div className="flex items-center gap-2 min-w-0">
												<FileCheck className="size-4 text-[#d0ae55] shrink-0" />
												<div className="min-w-0">
													<p className="text-xs font-medium text-[#e4e4df] truncate">{artifact.name}</p>
													<p className="text-[10px] text-[#747a82]">{artifact.kind} · {new Date(artifact.createdAt).toLocaleTimeString()}</p>
												</div>
											</div>
											<span className="shrink-0 text-[10px] font-mono text-[#858b94]">{artifact.uri}</span>
										</div>
									))}
								</div>
							)}
						</section>

						{/* Task Graph */}
						<section className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5">
							<h2 className="text-sm font-semibold text-[#f0f0eb]">Managed Task Graph</h2>
							<p className="mt-1 text-xs text-[#747a82]">Sequential and parallel tasks executed by specialist agents.</p>
							<div className="mt-4 space-y-3">
								{tasks.map((task) => {
									const taskColors = statusColor(task.status);
									return (
										<div key={task.id} className="rounded-xl border border-white/[0.06] bg-[#0c0f13] p-4 space-y-2">
											<div className="flex items-start justify-between gap-2">
												<div>
													<p className="text-xs font-semibold text-[#deded9]">{task.title}</p>
													<p className="mt-0.5 text-[11px] text-[#747a82]">
														Role: <span className="text-[#a4a9b2]">{task.agentRole}</span> · Tier: {task.modelTier} · Priority: {task.priority}
													</p>
												</div>
												<span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold border ${taskColors.bg} ${taskColors.text} ${taskColors.border}`}>
													{task.status}
												</span>
											</div>

											{task.dependencies.length > 0 && (
												<p className="text-[11px] text-[#6b7280]">
													Depends on: {task.dependencies.join(", ")}
												</p>
											)}

											{task.lastError && (
												<div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] p-2 text-[11px] text-red-300">
													{task.lastError}
												</div>
											)}
										</div>
									);
								})}
							</div>
						</section>
					</div>

					{/* Right: Execution Evidence & Timeline (Gate 29) */}
					<div className="space-y-6">
						<section className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5">
							<div className="flex items-center justify-between">
								<h2 className="text-sm font-semibold text-[#f0f0eb]">Execution Evidence Stream</h2>
								{isActive && (
									<span className="flex items-center gap-1.5 text-[11px] text-amber-400">
										<span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
										Live
									</span>
								)}
							</div>
							<p className="mt-1 text-xs text-[#747a82]">Immutable log of state transitions, claims, and tool interactions.</p>

							<div className="mt-4 max-h-[520px] overflow-y-auto space-y-2.5 pr-1">
								{events.length === 0 ? (
									<p className="text-xs italic text-[#5f656d]">No events recorded yet.</p>
								) : (
									events.map((event) => (
										<div key={event.id} className="rounded-xl border border-white/[0.04] bg-[#0c0f13] p-3 text-xs">
											<div className="flex items-center justify-between text-[11px]">
												<span className="font-semibold text-[#b89a51]">{event.type}</span>
												<span className="text-[#626871]">{new Date(event.createdAt).toLocaleTimeString()}</span>
											</div>
											{event.payload && Object.keys(event.payload).length > 0 && (
												<pre className="mt-1.5 max-h-24 overflow-x-auto rounded bg-[#07090c] p-2 text-[10px] text-[#9ba0a8] font-mono">
													{JSON.stringify(event.payload, null, 2)}
												</pre>
											)}
										</div>
									))
								)}
							</div>
						</section>
					</div>
				</div>
			</div>
		</main>
	);
}
