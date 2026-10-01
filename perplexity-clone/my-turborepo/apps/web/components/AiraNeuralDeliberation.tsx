"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";

export interface DeliberationStep {
	readonly id: string;
	readonly title: string;
	readonly detail?: string;
	readonly status: "completed" | "active" | "pending";
	readonly duration?: string;
}

export interface AiraNeuralDeliberationProps {
	readonly isDeliberating: boolean;
	readonly elapsedMs?: number;
	readonly sourceCount?: number;
	readonly statusText?: string;
	readonly steps?: readonly DeliberationStep[];
	readonly className?: string;
	readonly onCancel?: () => void;
}

const DEFAULT_DELIBERATION_STEPS: readonly DeliberationStep[] = [
	{
		id: "step-1",
		title: "Understanding your request",
		detail: "Mapping intent, constraints, and the evidence needed for a useful answer.",
		status: "completed",
		duration: "0.2s",
	},
	{
		id: "step-2",
		title: "Searching relevant sources",
		detail: "Finding current, high-signal material that matches your request.",
		status: "completed",
		duration: "0.6s",
	},
	{
		id: "step-3",
		title: "Checking evidence",
		detail: "Cross-checking claims and source quality before composing the response.",
		status: "active",
		duration: "0.4s",
	},
	{
		id: "step-4",
		title: "Preparing the answer",
		detail: "Synthesizing the strongest evidence into a clear response.",
		status: "pending",
	},
] as const;

const WAVE_BARS = [10, 18, 24, 16, 9] as const;

export function AiraNeuralDeliberation({
	isDeliberating,
	elapsedMs = 0,
	sourceCount = 0,
	statusText,
	steps = DEFAULT_DELIBERATION_STEPS,
	className,
	onCancel,
}: AiraNeuralDeliberationProps) {
	const [isOpen, setIsOpen] = useState(false);

	const elapsedSec = (elapsedMs / 1000).toFixed(1);
	const activeLabel = statusText?.trim() || "Searching the web...";
	const secondaryLabel = isDeliberating
		? sourceCount > 0
			? `Verifying ${sourceCount} source${sourceCount === 1 ? "" : "s"}...`
			: "Working through the problem..."
		: sourceCount > 0
			? `${sourceCount} source${sourceCount === 1 ? "" : "s"} verified`
			: "Response ready";

	return (
		<div
			className={cn(
				"my-2.5 overflow-hidden rounded-2xl border border-violet-200/70 bg-white/95 text-left shadow-[0_12px_34px_rgba(76,61,166,0.08)] backdrop-blur-xl transition-all dark:border-white/[0.08] dark:bg-[#11131A]/95",
				isOpen && "border-violet-300/80 shadow-[0_16px_42px_rgba(76,61,166,0.11)] dark:border-violet-400/25",
				className,
			)}
		>
			<div className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
				<button
					type="button"
					onClick={() => setIsOpen((prev) => !prev)}
					className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
					aria-expanded={isOpen}
				>
					<div className="grid size-10 shrink-0 place-items-center rounded-xl border border-violet-200/70 bg-gradient-to-br from-violet-50 via-white to-indigo-50 shadow-[0_6px_18px_rgba(99,80,220,0.10)] dark:border-violet-400/20 dark:from-violet-500/15 dark:via-white/[0.04] dark:to-indigo-500/10">
						<div className="flex h-6 items-center gap-[2px]" aria-hidden="true">
							{WAVE_BARS.map((height, index) => (
								<span
									key={`${height}-${index}`}
									className={cn(
										"w-[2.5px] rounded-full bg-gradient-to-b from-violet-500 to-indigo-500",
										isDeliberating && "animate-pulse",
									)}
									style={{ height, animationDelay: `${index * 110}ms` }}
								/>
							))}
						</div>
					</div>

					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<p className="truncate text-[13px] font-medium tracking-[-0.01em] text-[#171A24] dark:text-[#F5F7FB]">
								{isDeliberating ? activeLabel : "Search complete"}
							</p>
							{isOpen ? (
								<ChevronDown className="size-3.5 shrink-0 text-[#8A90A1]" aria-hidden="true" />
							) : (
								<ChevronRight className="size-3.5 shrink-0 text-[#8A90A1]" aria-hidden="true" />
							)}
						</div>
						<div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#8A90A1] dark:text-[#9DA4B5]">
							<span>{secondaryLabel}</span>
							<span aria-hidden="true">·</span>
							<span className="tabular-nums">{elapsedSec}s</span>
						</div>
					</div>
				</button>

				{isDeliberating && onCancel ? (
					<button
						type="button"
						onClick={onCancel}
						className="shrink-0 rounded-lg border border-red-200/80 bg-red-50/80 px-2.5 py-1.5 text-[11px] font-medium text-red-600 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15"
						aria-label="Stop research"
					>
						Stop
					</button>
				) : null}
			</div>

			{isOpen ? (
				<div className="border-t border-violet-100/80 bg-violet-50/30 px-4 py-3 text-xs dark:border-white/[0.06] dark:bg-black/20">
					<div className="relative space-y-3 pl-5 before:absolute before:bottom-2 before:left-1.5 before:top-2 before:w-px before:bg-violet-200/70 dark:before:bg-white/[0.08]">
						{steps.map((step) => (
							<div key={step.id} className="relative space-y-0.5">
								<div
									className={cn(
										"absolute -left-5 top-0.5 grid size-3.5 place-items-center rounded-full border text-[8px]",
										step.status === "completed"
											? "border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300"
											: step.status === "active"
												? "animate-pulse border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-300"
												: "border-slate-200 bg-white text-slate-400 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-[#64748B]",
									)}
								>
									{step.status === "completed" ? "✓" : "•"}
								</div>
								<div className="flex items-center justify-between gap-2">
									<p
										className={cn(
											"text-[11.5px] font-medium",
											step.status === "active"
												? "text-violet-700 dark:text-violet-300"
												: step.status === "completed"
													? "text-[#303440] dark:text-[#E2E8F0]"
													: "text-[#9AA0AE] dark:text-[#64748B]",
										)}
									>
										{step.title}
									</p>
									{step.duration ? (
										<span className="text-[9.5px] tabular-nums text-[#9AA0AE] dark:text-[#64748B]">{step.duration}</span>
									) : null}
								</div>
								{step.detail ? (
									<p className="text-[10.5px] leading-relaxed text-[#7A8090] dark:text-[#94A3B8]">{step.detail}</p>
								) : null}
							</div>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
