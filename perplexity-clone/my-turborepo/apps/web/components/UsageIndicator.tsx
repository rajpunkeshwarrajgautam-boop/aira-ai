"use client";

import { AlertCircle, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../lib/cn";

interface BillingStatus {
	billingPlan: string;
	searchesUsed: number;
	searchesRemaining: number;
	monthlySearchLimit: number;
	agentRunsRemaining: number;
	monthlyAgentRunLimit: number;
}

export function UsageIndicator({ className }: { className?: string }) {
	const [status, setStatus] = useState<BillingStatus | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function fetchStatus() {
			try {
				const res = await fetch("/api/billing/status", { credentials: "include" });
				if (res.ok) setStatus((await res.json()) as BillingStatus);
			} catch (error) {
				console.error("Failed to fetch billing status", error);
			} finally {
				setLoading(false);
			}
		}
		void fetchStatus();
	}, []);

	if (loading || !status) return null;

	const isFree = status.billingPlan === "FREE";
	const isLimitLow = status.searchesRemaining <= 5;
	const isLimitExceeded = status.searchesRemaining === 0;
	const progress = Math.min(100, Math.max(0, (status.searchesUsed / Math.max(1, status.monthlySearchLimit)) * 100));

	return (
		<div className={cn("flex flex-col gap-2.5", className)}>
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 items-start gap-2">
					<span className={cn(
						"mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border",
						isLimitExceeded
							? "border-red-400/20 bg-red-400/[0.06] text-red-300"
							: "border-border-subtle bg-surface-elevated text-accent",
					)}>
						{isLimitExceeded ? <AlertCircle className="size-3.5" /> : <Zap className="size-3.5" />}
					</span>
					<div className="min-w-0">
						<p className="truncate text-[10px] font-semibold text-content-primary">{isFree ? "Free plan" : `${status.billingPlan} plan`}</p>
						<p className="mt-0.5 text-[8.5px] leading-4 text-content-tertiary">{status.searchesRemaining} searches left</p>
						{status.monthlyAgentRunLimit > 0 ? <p className="text-[8.5px] leading-4 text-content-tertiary">{status.agentRunsRemaining} agent runs left</p> : null}
					</div>
				</div>
				{isFree ? (
					<a href="/upgrade" className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/10 px-2 text-[9px] font-semibold text-accent transition hover:bg-accent/15">Upgrade</a>
				) : null}
			</div>

			<div className="h-1 w-full overflow-hidden rounded-full bg-surface-inset" aria-label={`${Math.round(progress)}% of monthly searches used`}>
				<div
					className={cn("h-full rounded-full transition-[width] duration-300", isLimitExceeded ? "bg-red-400" : isLimitLow ? "bg-amber-400" : "bg-accent")}
					style={{ width: `${progress}%` }}
				/>
			</div>
		</div>
	);
}
