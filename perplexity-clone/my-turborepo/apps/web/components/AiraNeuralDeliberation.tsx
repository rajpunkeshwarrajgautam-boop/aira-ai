"use client";

import { ChevronDown, ChevronRight, Cpu, Globe2, ShieldCheck, Sparkles } from "lucide-react";
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
	readonly steps?: readonly DeliberationStep[];
	readonly className?: string;
	readonly onCancel?: () => void;
}

const DEFAULT_DELIBERATION_STEPS: readonly DeliberationStep[] = [
	{
		id: "step-1",
		title: "Intent Vectorization & Constraint Boundary Mapping",
		detail: "Decomposing query across technical criteria, SLA boundaries, and verification targets.",
		status: "completed",
		duration: "0.2s",
	},
	{
		id: "step-2",
		title: "Sovereign Multi-Hop Retrieval & Source Ingestion",
		detail: "Crawling and indexing authoritative docs, RFC specs, and live indices with zero-leak isolation.",
		status: "completed",
		duration: "0.6s",
	},
	{
		id: "step-3",
		title: "Cross-Reference Validation & Citation Fencing",
		detail: "Synthesizing evidence claims with deterministic source grounding.",
		status: "active",
		duration: "0.4s",
	},
	{
		id: "step-4",
		title: "Executive Synthesis & Verified Output Compilation",
		detail: "Formatting high-precision response with structured deliverables.",
		status: "pending",
	},
] as const;

export function AiraNeuralDeliberation({
	isDeliberating,
	elapsedMs = 0,
	sourceCount = 0,
	steps = DEFAULT_DELIBERATION_STEPS,
	className,
	onCancel,
}: AiraNeuralDeliberationProps) {
	const [isOpen, setIsOpen] = useState(false);

	const elapsedSec = (elapsedMs / 1000).toFixed(1);

	return (
		<div
			className={cn(
				"my-2.5 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0D0F16]/80 text-left backdrop-blur-md transition-all",
				isOpen && "border-sky-500/30 bg-[#10131C]",
				className,
			)}
		>
			<div className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs">
				<button
					type="button"
					onClick={() => setIsOpen((prev) => !prev)}
					className="flex flex-1 items-center justify-between transition hover:opacity-90"
					aria-expanded={isOpen}
				>
					<div className="flex items-center gap-2.5">
						<div
							className={cn(
								"grid size-5 place-items-center rounded-md border",
								isDeliberating
									? "border-sky-500/40 bg-sky-500/20 text-sky-400"
									: "border-emerald-500/40 bg-emerald-500/20 text-emerald-400",
							)}
						>
							<Cpu className="size-3" />
						</div>
						<div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
							<span className="font-semibold text-[#F8FAFC]">
								{isDeliberating ? "Neural Deliberation in progress…" : "Deliberation complete"}
							</span>
							<span className="text-[#64748B]">·</span>
							<span className="text-[#94A3B8]">{elapsedSec}s elapsed</span>
							{sourceCount > 0 ? (
								<>
									<span className="text-[#64748B]">·</span>
									<span className="text-sky-400">{sourceCount} sources verified</span>
								</>
							) : null}
						</div>
					</div>

					<div className="flex items-center gap-2 text-[#64748B]">
						<span className="text-[10px] uppercase tracking-wider font-mono">
							{isOpen ? "Hide Steps" : "Inspect Steps"}
						</span>
						{isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
					</div>
				</button>
				{isDeliberating && onCancel ? (
					<button
						type="button"
						onClick={onCancel}
						className="ml-3 inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/20 px-2 py-1 text-[11px] font-medium text-red-300 transition hover:bg-red-500/30"
						aria-label="Stop research"
					>
						Stop
					</button>
				) : null}
			</div>

			{isOpen ? (
				<div className="border-t border-white/[0.06] bg-black/25 px-4 py-3 text-xs space-y-3">
					<div className="relative pl-5 space-y-3 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-[1.5px] before:bg-white/[0.08]">
						{steps.map((step) => (
							<div key={step.id} className="relative space-y-0.5">
								<div
									className={cn(
										"absolute -left-5 top-0.5 size-3.5 rounded-full border grid place-items-center text-[8px]",
										step.status === "completed"
											? "border-emerald-500/50 bg-emerald-500/20 text-emerald-400"
											: step.status === "active"
												? "border-sky-500/50 bg-sky-500/20 text-sky-400 animate-pulse"
												: "border-white/[0.1] bg-white/[0.04] text-[#64748B]",
									)}
								>
									{step.status === "completed" ? "✓" : "•"}
								</div>
								<div className="flex items-center justify-between gap-2">
									<p
										className={cn(
											"text-[11.5px] font-medium",
											step.status === "completed"
												? "text-[#E2E8F0]"
												: step.status === "active"
													? "text-sky-300 font-semibold"
													: "text-[#64748B]",
										)}
									>
										{step.title}
									</p>
									{step.duration ? (
										<span className="font-mono text-[9.5px] text-[#64748B]">{step.duration}</span>
									) : null}
								</div>
								{step.detail ? (
									<p className="text-[10.5px] leading-relaxed text-[#94A3B8]">{step.detail}</p>
								) : null}
							</div>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
