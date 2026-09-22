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
		<div className={cn("flex flex-col gap-2.5 rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-3 shadow-xs", className)}>
			<div className="flex items-center justify-between gap-2.5">
				<div className="flex items-center gap-2">
					<div className={cn(
						"flex size-7 items-center justify-center rounded-lg",
						isLimitExceeded ? "bg-red-50 text-red-600 border border-red-200" : "bg-[#3A0CA3]/[0.08] text-[#3A0CA3]"
					)}>
						{isLimitExceeded ? <AlertCircle className="size-3.5" /> : <Zap className="size-3.5" />}
					</div>
					<div>
						<p className="text-[12px] font-semibold text-[#111115]">{isFree ? "Free Plan" : `${status.billingPlan} Plan`}</p>
						<p className="text-[10px] text-[#6B6A75]">{status.searchesRemaining} searches left</p>
					</div>
				</div>
				{isFree ? (
					<a href="/upgrade" className="inline-flex h-7 items-center justify-center rounded-lg bg-[#3A0CA3] px-2.5 text-[10px] font-semibold text-white shadow-xs transition hover:bg-[#2D0A82]">
						Upgrade
					</a>
				) : null}
			</div>

			<div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[#F2F0E8]">
				<div
					className={cn(
						"h-full rounded-full transition-all duration-500",
						isLimitExceeded ? "bg-red-500" : isLimitLow ? "bg-[#FF6B6B]" : "bg-[#3A0CA3]"
					)}
					style={{ width: `${progress}%` }}
				/>
			</div>
		</div>
	);
}
