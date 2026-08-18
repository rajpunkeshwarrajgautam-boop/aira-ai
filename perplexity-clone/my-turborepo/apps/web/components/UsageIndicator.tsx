"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Zap } from "lucide-react";
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
				if (res.ok) {
					const data = await res.json();
					setStatus(data);
				}
			} catch (e) {
				console.error("Failed to fetch billing status", e);
			} finally {
				setLoading(false);
			}
		}
		fetchStatus();
	}, []);

	if (loading || !status) return null;

	const isFree = status.billingPlan === "FREE";
	const isLimitLow = status.searchesRemaining <= 5;
	const isLimitExceeded = status.searchesRemaining === 0;
	const progress = Math.min(100, Math.max(0, (status.searchesUsed / Math.max(1, status.monthlySearchLimit)) * 100));

	return (
		<div className={cn("aira-glass flex flex-col gap-3 rounded-2xl p-4", className)}>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2.5">
					<div className={cn("flex size-8 items-center justify-center rounded-xl shadow-sm", isLimitExceeded ? "bg-red-500/15 text-red-500" : "aira-icon-pop")}>
						{isLimitExceeded ? <AlertCircle className="size-4" aria-hidden /> : <Zap className="size-4" aria-hidden />}
					</div>
					<div>
						<p className="text-[13px] font-semibold text-content-primary">{isFree ? "Free Plan" : `${status.billingPlan} Plan`}</p>
						<p className="text-[11px] text-content-tertiary">{status.searchesRemaining} searches left this month</p>
						{status.monthlyAgentRunLimit > 0 ? <p className="text-[11px] text-content-tertiary">{status.agentRunsRemaining} agent tasks left</p> : null}
					</div>
				</div>
				{isFree ? (
					<a href="/upgrade" className="aira-shine-button inline-flex h-8 items-center justify-center rounded-lg bg-accent px-3 text-[11px] font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-accent/90 active:scale-95">Upgrade</a>
				) : null}
			</div>

			<div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
				<div className={cn("h-full rounded-full transition-all duration-500", isLimitExceeded ? "bg-red-500" : isLimitLow ? "bg-gradient-to-r from-orange-400 to-amber-500" : "bg-gradient-to-r from-accent to-violet-500")} style={{ width: `${progress}%` }} />
			</div>
		</div>
	);
}
