"use client";

import { CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApprovalStatus = "PENDING" | "APPROVED" | "DENIED" | "CANCELLED" | "EXPIRED";

type ToolApproval = {
	id: string;
	runId: string;
	toolId: string;
	permission: string;
	mode: string;
	summary: string;
	status: ApprovalStatus;
	requestedAt: string;
	resolvedAt: string | null;
};

type ApiError = { error?: { message?: string } };

function statusClass(status: ApprovalStatus): string {
	if (status === "APPROVED") return "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200";
	if (status === "DENIED" || status === "CANCELLED" || status === "EXPIRED") {
		return "border-red-400/20 bg-red-400/[0.07] text-red-200";
	}
	return "border-amber-300/20 bg-amber-300/[0.07] text-amber-100";
}

export function ToolApprovalPanel({ runId, active }: { runId: string; active: boolean }) {
	const [approvals, setApprovals] = useState<ToolApproval[]>([]);
	const [loading, setLoading] = useState(true);
	const [mutatingId, setMutatingId] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const pendingCount = useMemo(
		() => approvals.filter((approval) => approval.status === "PENDING").length,
		[approvals],
	);

	const load = useCallback(async () => {
		try {
			const response = await fetch(
				`/api/agents/runs/${encodeURIComponent(runId)}/approvals?limit=50`,
				{ cache: "no-store" },
			);
			const body = (await response.json()) as { approvals?: ToolApproval[] } & ApiError;
			if (!response.ok) throw new Error(body.error?.message ?? "Could not load tool approvals.");
			setApprovals(body.approvals ?? []);
			setMessage(null);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Could not load tool approvals.");
		} finally {
			setLoading(false);
		}
	}, [runId]);

	useEffect(() => {
		setLoading(true);
		setApprovals([]);
		void load();
	}, [load]);

	useEffect(() => {
		if (!active && pendingCount === 0) return;
		const timer = window.setInterval(() => void load(), 4_000);
		return () => window.clearInterval(timer);
	}, [active, load, pendingCount]);

	async function resolve(approvalId: string, decision: "APPROVE" | "DENY") {
		setMutatingId(approvalId);
		setMessage(null);
		try {
			const response = await fetch(
				`/api/agents/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ decision }),
				},
			);
			const body = (await response.json()) as { approval?: ToolApproval } & ApiError;
			if (!response.ok) throw new Error(body.error?.message ?? "Approval decision could not be saved.");
			await load();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Approval decision could not be saved.");
		} finally {
			setMutatingId(null);
		}
	}

	if (loading && approvals.length === 0) {
		return (
			<section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4" aria-label="Tool approvals">
				<div className="flex items-center gap-2 text-xs text-[#7c8189]">
					<Loader2 className="size-3.5 animate-spin" aria-hidden />
					Loading tool approvals…
				</div>
			</section>
		);
	}

	return (
		<section className="mb-6 rounded-xl border border-white/[0.07] bg-white/[0.018] p-4" aria-labelledby="tool-approvals-heading">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p id="tool-approvals-heading" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#666c74]">
						Tool approvals
					</p>
					<p className="mt-1 text-xs leading-5 text-[#777c84]">
						Privileged actions run only after a persisted approval for this exact run and tool.
					</p>
				</div>
				{pendingCount > 0 ? (
					<span className="rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2.5 py-1 text-[10px] font-medium text-amber-100">
						{pendingCount} pending
					</span>
				) : null}
			</div>

			{message ? (
				<div className="mt-3 flex gap-2 rounded-lg border border-red-400/15 bg-red-400/[0.05] px-3 py-2 text-xs leading-5 text-red-200" role="alert">
					<ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
					<span>{message}</span>
				</div>
			) : null}

			{approvals.length === 0 ? (
				<p className="mt-3 text-xs leading-5 text-[#666c74]">
					No privileged tool action has requested approval for this run.
				</p>
			) : (
				<ul className="mt-4 space-y-3">
					{approvals.map((approval) => (
						<li key={approval.id} className="rounded-xl border border-white/[0.07] bg-[#0b0d10] p-4">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-xs font-semibold text-[#e5e6e3]">{approval.toolId}</span>
										<span className={`rounded-full border px-2 py-0.5 text-[9px] ${statusClass(approval.status)}`}>
											{approval.status}
										</span>
									</div>
									<p className="mt-2 text-xs leading-5 text-[#9ba0a7]">{approval.summary}</p>
									<p className="mt-2 text-[10px] text-[#5f646c]">
										{approval.permission} · mode {approval.mode} · requested {new Date(approval.requestedAt).toLocaleString()}
									</p>
								</div>

								{approval.status === "PENDING" ? (
									<div className="flex shrink-0 gap-2">
										<button
											type="button"
											onClick={() => void resolve(approval.id, "DENY")}
											disabled={mutatingId === approval.id}
											className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-[#14171c] px-3 py-2 text-[11px] font-medium text-[#b8bcc2] disabled:opacity-40"
										>
											<XCircle className="size-3.5" aria-hidden />
											Deny
										</button>
										<button
											type="button"
											onClick={() => void resolve(approval.id, "APPROVE")}
											disabled={mutatingId === approval.id}
											className="inline-flex items-center gap-1.5 rounded-lg bg-[#d0ae55] px-3 py-2 text-[11px] font-semibold text-[#111214] disabled:opacity-40"
										>
											{mutatingId === approval.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
											Approve
										</button>
									</div>
								) : null}
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
