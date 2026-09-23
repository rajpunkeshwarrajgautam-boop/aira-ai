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
			return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-600/20" };
		case "RUNNING":
		case "PLANNING":
			return { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-600/20" };
		case "APPROVAL_REQUIRED":
		case "WAITING":
			return { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-600/20" };
		case "FAILED":
			return { bg: "bg-red-50", text: "text-red-700", border: "border-red-600/20" };
		case "CANCELLED":
			return { bg: "bg-zinc-100", text: "text-zinc-700", border: "border-zinc-300" };
		case "BLOCKED":
			return { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-600/20" };
		default:
			return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-600/20" };
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
			<main className="flex min-h-[calc(100dvh-58px)] items-center justify-center bg-[var(--aira-canvas,#F9F8F6)] text-[#111115]">
				<div className="flex items-center gap-3 text-sm text-[#6B6A75]">
					<Loader2 className="size-5 animate-spin text-[#3A0CA3]" />
					<span>Loading Work Mission Control…</span>
				</div>
			</main>
		);
	}

	if (error && !data) {
		return (
			<main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-8 text-[#111115] md:px-8">
				<div className="mx-auto max-w-4xl space-y-4">
					<Link href="/work" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B6A75] hover:text-[#3A0CA3]">
						<ArrowLeft className="size-3.5" /> Back to Work
					</Link>
					<div role="alert" className="rounded-2xl border border-red-500/20 bg-red-50 p-6">
						<div className="flex items-start gap-3">
							<AlertCircle className="size-5 text-red-600 mt-0.5" />
							<div>
								<h1 className="text-base font-semibold text-red-900">Execution Error</h1>
								<p className="mt-1 text-sm text-red-700">{error}</p>
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
		<main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-8">
			<div className="mx-auto max-w-6xl space-y-6">
				{/* Navigation & Header */}
				<header className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Link href="/work" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B6A75] hover:text-[#3A0CA3]">
							<ArrowLeft className="size-3.5" /> Back to Work
						</Link>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => void fetchData(false)}
								className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-1.5 text-xs font-medium text-[#111115] hover:bg-[#FAF9F6] shadow-xs"
							>
								<RefreshCw className="size-3" /> Refresh
							</button>
							{isActive && (
								<button
									type="button"
									onClick={() => void handleCancel()}
									disabled={actionPending === "cancel"}
									className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40 shadow-xs"
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
								<span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3A0CA3]">Work Mission</span>
								<span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${colors.bg} ${colors.text} ${colors.border}`}>
									{run.status}
								</span>
							</div>
							<h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] md:text-2xl text-[#111115]">
								{project?.name ?? `Run · ${run.id.slice(0, 8)}`}
							</h1>
							<p className="mt-1 text-xs text-[#6B6A75] font-mono break-all">ID: {run.id}</p>
						</div>
					</div>

					{project?.objective && (
						<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-4 text-xs leading-5 text-[#4A4954] shadow-xs">
							<span className="font-semibold text-[#111115]">Objective: </span>
							{project.objective}
						</div>
					)}
				</header>

				{/* Top Metrics Cards */}
				<section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
						<div className="flex items-center gap-2 text-xs text-[#6B6A75]">
							<DollarSign className="size-3.5 text-[#3A0CA3]" />
							<span>Cost / Budget</span>
						</div>
						<p className="mt-1 text-base font-semibold text-[#111115]">
							${totalCost.toFixed(3)}{" "}
							<span className="text-xs font-normal text-[#6B6A75]">/ ${maxCost.toFixed(2)}</span>
						</p>
					</div>

					<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
						<div className="flex items-center gap-2 text-xs text-[#6B6A75]">
							<FileCheck className="size-3.5 text-[#3A0CA3]" />
							<span>Tasks Completed</span>
						</div>
						<p className="mt-1 text-base font-semibold text-[#111115]">
							{completedCount}{" "}
							<span className="text-xs font-normal text-[#6B6A75]">/ {tasks.length}</span>
						</p>
					</div>

					<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
						<div className="flex items-center gap-2 text-xs text-[#6B6A75]">
							<Clock className="size-3.5 text-[#3A0CA3]" />
							<span>Started</span>
						</div>
						<p className="mt-1 text-xs font-medium text-[#111115] truncate">
							{run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "Pending"}
						</p>
					</div>

					<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
						<div className="flex items-center gap-2 text-xs text-[#6B6A75]">
							<Shield className="size-3.5 text-[#3A0CA3]" />
							<span>Runtime</span>
						</div>
						<p className="mt-1 text-xs font-medium text-[#111115]">
							{run.runtime ?? "AIRA_AGENT"}
						</p>
					</div>
				</section>

				{/* Pending Approvals (Gate 19, 20) */}
				{pendingApprovals.length > 0 && (
					<section className="rounded-2xl border border-purple-500/30 bg-purple-50/50 p-5 space-y-4">
						<div className="flex items-center gap-2">
							<ShieldAlert className="size-5 text-purple-600" />
							<h2 className="text-sm font-semibold text-purple-900">Human Approval Required</h2>
						</div>
						<p className="text-xs leading-5 text-[#4A4954]">
							Consequential or elevated-risk operations require explicit user approval before managed execution proceeds.
						</p>
						<div className="space-y-3">
							{pendingApprovals.map((approval) => (
								<div key={approval.id} className="flex flex-col gap-3 rounded-xl border border-purple-500/20 bg-white p-4 md:flex-row md:items-center md:justify-between shadow-xs">
									<div>
										<p className="text-xs font-semibold text-[#111115]">{approval.action}</p>
										<p className="mt-0.5 text-[11px] text-[#6B6A75]">Risk Level: <span className="text-purple-700 font-medium">{approval.risk}</span></p>
									</div>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => void handleApproval(approval.id, "reject")}
											disabled={actionPending === approval.id}
											className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
										>
											<XCircle className="size-3.5" /> Reject
										</button>
										<button
											type="button"
											onClick={() => void handleApproval(approval.id, "approve")}
											disabled={actionPending === approval.id}
											className="inline-flex items-center gap-1.5 rounded-lg bg-[#3A0CA3] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2D0A82] shadow-xs"
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
						<section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
							<h2 className="text-sm font-semibold text-[#111115]">Persisted Deliverables</h2>
							<p className="mt-1 text-xs text-[#6B6A75]">Durable outputs and evidence created by completed tasks.</p>
							{artifacts.length === 0 ? (
								<p className="mt-4 text-xs italic text-[#8F8E98]">
									{isActive ? "Deliverables will appear here as tasks finish." : "No durable deliverables recorded for this run."}
								</p>
							) : (
								<div className="mt-4 space-y-2">
									{artifacts.map((artifact) => (
										<div key={artifact.id} className="flex items-center justify-between rounded-xl border border-[rgba(17,17,21,0.06)] bg-[#FAF9F6] px-3.5 py-2.5">
											<div className="flex items-center gap-2 min-w-0">
												<FileCheck className="size-4 text-[#3A0CA3] shrink-0" />
												<div className="min-w-0">
													<p className="text-xs font-medium text-[#111115] truncate">{artifact.name}</p>
													<p className="text-[10px] text-[#6B6A75]">{artifact.kind} · {new Date(artifact.createdAt).toLocaleTimeString()}</p>
												</div>
											</div>
											<span className="shrink-0 text-[10px] font-mono text-[#6B6A75]">{artifact.uri}</span>
										</div>
									))}
								</div>
							)}
						</section>

						{/* Task Graph */}
						<section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
							<h2 className="text-sm font-semibold text-[#111115]">Managed Task Graph</h2>
							<p className="mt-1 text-xs text-[#6B6A75]">Sequential and parallel tasks executed by specialist agents.</p>
							<div className="mt-4 space-y-3">
								{tasks.map((task) => {
									const taskColors = statusColor(task.status);
									return (
										<div key={task.id} className="rounded-xl border border-[rgba(17,17,21,0.06)] bg-[#FAF9F6] p-4 space-y-2">
											<div className="flex items-start justify-between gap-2">
												<div>
													<p className="text-xs font-semibold text-[#111115]">{task.title}</p>
													<p className="mt-0.5 text-[11px] text-[#6B6A75]">
														Role: <span className="text-[#111115] font-medium">{task.agentRole}</span> · Tier: {task.modelTier} · Priority: {task.priority}
													</p>
												</div>
												<span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold border ${taskColors.bg} ${taskColors.text} ${taskColors.border}`}>
													{task.status}
												</span>
											</div>

											{task.dependencies.length > 0 && (
												<p className="text-[11px] text-[#6B6A75]">
													Depends on: {task.dependencies.join(", ")}
												</p>
											)}

											{task.lastError && (
												<div className="rounded-lg border border-red-500/20 bg-red-50 p-2 text-[11px] text-red-700">
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
						<section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
							<div className="flex items-center justify-between">
								<h2 className="text-sm font-semibold text-[#111115]">Execution Evidence Stream</h2>
								{isActive && (
									<span className="flex items-center gap-1.5 text-[11px] text-amber-700 font-medium">
										<span className="size-1.5 rounded-full bg-amber-600 animate-pulse" />
										Live
									</span>
								)}
							</div>
							<p className="mt-1 text-xs text-[#6B6A75]">Immutable log of state transitions, claims, and tool interactions.</p>

							<div className="mt-4 max-h-[520px] overflow-y-auto space-y-2.5 pr-1">
								{events.length === 0 ? (
									<p className="text-xs italic text-[#8F8E98]">No events recorded yet.</p>
								) : (
									events.map((event) => (
										<div key={event.id} className="rounded-xl border border-[rgba(17,17,21,0.06)] bg-[#FAF9F6] p-3 text-xs">
											<div className="flex items-center justify-between text-[11px]">
												<span className="font-semibold text-[#3A0CA3]">{event.type}</span>
												<span className="text-[#6B6A75]">{new Date(event.createdAt).toLocaleTimeString()}</span>
											</div>
											{event.payload && Object.keys(event.payload).length > 0 && (
												<pre className="mt-1.5 max-h-24 overflow-x-auto rounded bg-white border border-[rgba(17,17,21,0.08)] p-2 text-[10px] text-[#4A4954] font-mono">
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
