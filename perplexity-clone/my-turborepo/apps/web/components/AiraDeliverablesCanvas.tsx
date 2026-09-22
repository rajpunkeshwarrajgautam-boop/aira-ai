"use client";

import {
	Check,
	Code,
	Copy,
	Download,
	ExternalLink,
	FileText,
	Globe2,
	Layers,
	ListTree,
	Maximize2,
	Minimize2,
	Share2,
	ShieldCheck,
	Sparkles,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { type CitationItem, hostnameFromUrl } from "./CitationCards";
import { cn } from "../lib/cn";

export interface SwarmExecutionStep {
	readonly id: string;
	readonly title: string;
	readonly status: "completed" | "in_progress" | "pending";
	readonly detail?: string;
	readonly timestamp?: string;
	readonly sourceCount?: number;
}

export interface AiraDeliverablesCanvasProps {
	readonly isOpen: boolean;
	readonly onClose: () => void;
	readonly title?: string;
	readonly content?: string;
	readonly citations?: readonly CitationItem[];
	readonly steps?: readonly SwarmExecutionStep[];
	readonly isBusy?: boolean;
	readonly className?: string;
}



export function AiraDeliverablesCanvas({
	isOpen,
	onClose,
	title = "AIRA Intelligence Dossier",
	content = "",
	citations = [],
	steps = [],
	isBusy = false,
	className,
}: AiraDeliverablesCanvasProps) {
	const [activeTab, setActiveTab] = useState<"deliverable" | "timeline" | "citations">("deliverable");
	const [copied, setCopied] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);

	const handleCopy = async () => {
		if (!content) return;
		try {
			await navigator.clipboard.writeText(content);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// ignore clipboard error
		}
	};

	const handleDownload = () => {
		if (!content) return;
		const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "aira-dossier"}.md`;
		link.click();
		URL.revokeObjectURL(url);
	};

	if (!isOpen) return null;

	return (
		<aside
			className={cn(
				"aira-deliverables-canvas fixed bottom-0 right-0 top-[52px] z-40 flex flex-col border-l border-white/[0.08] bg-[#0D0F16]/95 backdrop-blur-2xl transition-all duration-300",
				isExpanded ? "w-full md:w-[720px] lg:w-[860px]" : "w-full md:w-[480px] lg:w-[560px]",
				className,
			)}
			aria-label="AIRA Deliverables Canvas"
		>
			{/* Canvas Top Bar */}
			<div className="flex h-13 flex-none items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
				<div className="flex items-center gap-2 min-w-0">
					<div className="flex size-7 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
						<Layers className="size-4" />
					</div>
					<div className="min-w-0">
						<h2 className="truncate text-xs font-semibold text-[#F8FAFC]">{title}</h2>
						<span className="flex items-center gap-1.5 text-[10px] font-mono text-sky-400">
							<span className="size-1.5 rounded-full bg-sky-400 animate-pulse" />
							AIRA Deliverables Stage
						</span>
					</div>
				</div>

				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => setIsExpanded((exp) => !exp)}
						className="hidden sm:grid size-8 place-items-center rounded-lg border border-white/[0.06] text-[#94A3B8] transition hover:bg-white/[0.05] hover:text-[#F8FAFC]"
						aria-label={isExpanded ? "Collapse stage" : "Expand stage"}
					>
						{isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
					</button>
					<button
						type="button"
						onClick={handleCopy}
						className="grid size-8 place-items-center rounded-lg border border-white/[0.06] text-[#94A3B8] transition hover:bg-white/[0.05] hover:text-[#F8FAFC]"
						aria-label="Copy dossier markdown"
					>
						{copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
					</button>
					<button
						type="button"
						onClick={handleDownload}
						className="grid size-8 place-items-center rounded-lg border border-white/[0.06] text-[#94A3B8] transition hover:bg-white/[0.05] hover:text-[#F8FAFC]"
						aria-label="Download deliverable"
					>
						<Download className="size-3.5" />
					</button>
					<button
						type="button"
						onClick={onClose}
						className="grid size-8 place-items-center rounded-lg border border-white/[0.06] text-[#94A3B8] transition hover:bg-white/[0.05] hover:text-[#F8FAFC]"
						aria-label="Close canvas stage"
					>
						<X className="size-4" />
					</button>
				</div>
			</div>

			{/* Tab Selector */}
			<div className="flex flex-none items-center gap-1 border-b border-white/[0.06] bg-black/20 px-4 py-1.5">
				<button
					type="button"
					onClick={() => setActiveTab("deliverable")}
					className={cn(
						"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition",
						activeTab === "deliverable"
							? "bg-white/[0.08] text-[#F8FAFC] shadow-sm"
							: "text-[#94A3B8] hover:text-[#F8FAFC]",
					)}
				>
					<FileText className="size-3 text-sky-400" />
					<span>Deliverable</span>
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("timeline")}
					className={cn(
						"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition",
						activeTab === "timeline"
							? "bg-white/[0.08] text-[#F8FAFC] shadow-sm"
							: "text-[#94A3B8] hover:text-[#F8FAFC]",
					)}
				>
					<ListTree className="size-3 text-sky-400" />
					<span>Swarm Execution</span>
					<span className="rounded-full bg-sky-500/20 px-1.5 py-0.2 text-[9px] font-mono text-sky-300">
						{steps.length}
					</span>
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("citations")}
					className={cn(
						"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition",
						activeTab === "citations"
							? "bg-white/[0.08] text-[#F8FAFC] shadow-sm"
							: "text-[#94A3B8] hover:text-[#F8FAFC]",
					)}
				>
					<Globe2 className="size-3 text-sky-400" />
					<span>Verified Sources</span>
					{citations.length > 0 ? (
						<span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-mono text-emerald-300">
							{citations.length}
						</span>
					) : null}
				</button>
			</div>

			{/* Canvas Body */}
			<div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
				{activeTab === "deliverable" ? (
					<div className="prose prose-invert prose-sm max-w-none space-y-3 text-[#CBD5E1] text-[13px] leading-relaxed">
						{content ? (
							<ReactMarkdown remarkPlugins={[remarkGfm]}>
								{content}
							</ReactMarkdown>
						) : (
							<div className="flex flex-col items-center justify-center py-16 text-center text-[#94A3B8]">
								<Sparkles className="size-8 text-sky-400/60 animate-pulse mb-3" />
								<p className="text-xs font-semibold text-[#F8FAFC]">Ready to Compile Deliverable</p>
								<p className="mt-1 max-w-xs text-[11px]">
									Execute a research prompt or launch an autonomous mission to generate verified deliverables.
								</p>
							</div>
						)}
					</div>
				) : null}

				{activeTab === "timeline" ? (
					<div className="space-y-3">
						<div className="flex items-center justify-between text-[11px] font-mono text-[#94A3B8] border-b border-white/[0.06] pb-2">
							<span>Autonomous Agent Swarm Plan</span>
							<span className={steps.length > 0 ? "text-sky-400" : "text-[#64748B]"}>
								{steps.length > 0 ? "Deterministic · Fail-Closed" : "No Telemetry"}
							</span>
						</div>
						{steps.length > 0 ? (
							<div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1.5px] before:bg-white/[0.08]">
								{steps.map((step) => (
									<div key={step.id} className="relative space-y-1">
										<div
											className={cn(
												"absolute -left-6 top-0.5 size-4 rounded-full border grid place-items-center text-[9px]",
												step.status === "completed"
													? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
													: step.status === "in_progress"
														? "border-sky-500/40 bg-sky-500/20 text-sky-400 animate-pulse"
														: "border-white/[0.1] bg-white/[0.04] text-[#64748B]",
											)}
										>
											{step.status === "completed" ? "✓" : "•"}
										</div>
										<div className="flex items-center justify-between gap-2">
											<p
												className={cn(
													"text-xs font-medium",
													step.status === "completed"
														? "text-[#F8FAFC]"
														: step.status === "in_progress"
															? "text-sky-300"
															: "text-[#64748B]",
												)}
											>
												{step.title}
											</p>
											{step.timestamp ? (
												<span className="font-mono text-[10px] text-[#64748B]">{step.timestamp}</span>
											) : null}
										</div>
										{step.detail ? (
											<p className="text-[11px] leading-relaxed text-[#94A3B8]">{step.detail}</p>
										) : null}
									</div>
								))}
							</div>
						) : (
							<div className="py-12 text-center text-[11.5px] text-[#94A3B8]">
								No execution trace recorded. Execution activity will appear here when an agent swarm or research task executes with live telemetry.
							</div>
						)}
					</div>
				) : null}

				{activeTab === "citations" ? (
					<div className="space-y-3">
						<div className="flex items-center justify-between text-[11px] font-mono text-[#94A3B8] border-b border-white/[0.06] pb-2">
							<span>Triangulated Source Evidence</span>
							<span className="text-[#94A3B8]">{citations.length > 0 ? "Retrieved Sources" : "No Citations"}</span>
						</div>
						{citations.length > 0 ? (
							<div className="grid gap-2.5">
								{citations.map((c, idx) => (
									<a
										key={`${c.url}-${idx}`}
										href={c.url}
										target="_blank"
										rel="noopener noreferrer"
										className="group flex flex-col justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 transition hover:border-sky-500/40 hover:bg-sky-500/[0.04]"
									>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0">
												<span className="inline-block font-mono text-[9.5px] uppercase tracking-wider text-sky-400">
													[{idx + 1}] {hostnameFromUrl(c.url)}
												</span>
												<h4 className="mt-0.5 text-xs font-medium text-[#E2E8F0] group-hover:text-white line-clamp-2">
													{c.title || c.url}
												</h4>
											</div>
											<ExternalLink className="size-3 text-[#64748B] transition group-hover:text-sky-400 shrink-0 mt-1" />
										</div>
										{c.excerpt ? (
											<p className="mt-2 text-[10.5px] leading-4 text-[#94A3B8] line-clamp-2 italic">
												“{c.excerpt}”
											</p>
										) : null}
									</a>
								))}
							</div>
						) : (
							<div className="py-12 text-center text-[11.5px] text-[#94A3B8]">
								No external sources cited for this deliverable.
							</div>
						)}
					</div>
				) : null}
			</div>

			{/* Canvas Footer Status */}
			<div className="flex flex-none items-center justify-between border-t border-white/[0.06] bg-black/30 px-4 py-2 text-[10.5px] font-mono text-[#64748B]">
				<span className="flex items-center gap-1.5">
					<ShieldCheck className="size-3 text-emerald-400" />
					Zero-Leak Sovereign Context
				</span>
				<span>AIRA Intelligence OS v5.1</span>
			</div>
		</aside>
	);
}
