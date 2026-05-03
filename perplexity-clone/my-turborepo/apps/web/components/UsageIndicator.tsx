"use client";

import { useEffect, useState } from "react";
import { Zap, AlertCircle } from "lucide-react";
import { cn } from "../lib/cn";

interface BillingStatus {
	billingPlan: string;
	searchesUsed: number;
	searchesRemaining: number;
	monthlySearchLimit: number;
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

	return (
		<div className={cn("flex flex-col gap-2 rounded-2xl border border-border-subtle bg-surface-elevated/40 p-4 backdrop-blur-md", className)}>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<div className={cn(
						"flex size-8 items-center justify-center rounded-lg shadow-sm",
						isLimitExceeded ? "bg-red-500/20 text-red-400" : "bg-accent/10 text-accent"
					)}>
						{isLimitExceeded ? <AlertCircle className="size-4" /> : <Zap className="size-4" />}
					</div>
					<div>
						<p className="text-[13px] font-semibold text-content-primary">
							{isFree ? "Free Plan" : `${status.billingPlan} Plan`}
						</p>
						<p className="text-[11px] text-content-tertiary">
							{status.searchesRemaining} searches left this month
						</p>
					</div>
				</div>
				{isFree && (
					<a
						href="/upgrade"
						className="inline-flex h-8 items-center justify-center rounded-lg bg-accent px-3 text-[11px] font-bold text-white transition hover:bg-accent/80 active:scale-95"
					>
						Upgrade
					</a>
				)}
			</div>
			
			<div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface">
				<div 
					className={cn(
						"h-full transition-all duration-500",
						isLimitExceeded ? "bg-red-500" : isLimitLow ? "bg-orange-500" : "bg-accent"
					)}
					style={{ width: `${(status.searchesUsed / status.monthlySearchLimit) * 100}%` }}
				/>
			</div>
		</div>
	);
}
