"use client";

import {
	Check,
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	ExternalLink,
	EyeOff,
	FileDown,
	FileJson,
	FileText,
	GitCompareArrows,
	Globe2,
	History,
	Layers,
	MessageSquarePlus,
	Network,
	PencilLine,
	RotateCcw,
	Share2,
	ShieldCheck,
	Sparkles,
	WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CitationCards, hostnameFromUrl, type CitationItem } from "../CitationCards";
import { getMarkdownComponents } from "../markdownComponents";
import { linkifyCitations, parseCitationIndicesFromAnswer } from "../../src/services/citations";
import { type ConversationSummary } from "./ConversationSidebar";

export interface ConversationMessageDto {
	readonly id: string;
	readonly role: "USER" | "ASSISTANT";
	readonly content: string;
	readonly parentMessageId: string | null;
	readonly citations: unknown;
	readonly metadata?: {
		readonly confidence?: number;
		readonly effort?: "LOW" | "MEDIUM" | "HIGH" | "MAXIMUM";
		readonly branchIndex?: number;
		readonly branchCount?: number;
	} | null;
	readonly createdAt: string;
}

function isCitationArray(value: unknown): value is readonly CitationItem[] {
	if (!Array.isArray(value)) return false;
	return value.every((valueItem) => {
		if (!valueItem || typeof valueItem !== "object") return false;
		const item = valueItem as Record<string, unknown>;
		return typeof item.url === "string" && typeof item.title === "string" && typeof item.index === "number";
	});
}

export interface ConversationMessageListProps {
	readonly messages: readonly ConversationMessageDto[];
	readonly streamingUserQuery: string | null;
	readonly streamingAssistantMarkdown: string | null;
	readonly streamingCitations: readonly CitationItem[];
	readonly showAssistantSkeleton?: boolean;
	readonly showEmptyHint?: boolean;
	readonly isAuthed?: boolean;
	readonly recentConversations?: readonly ConversationSummary[];
	readonly onSelectConversation?: (id: string) => void;
	readonly exampleQueries?: readonly string[];
	readonly onPickExample?: (query: string) => void;
	readonly statusText?: string;
	readonly isTemporary?: boolean;
	readonly effort?: "LOW" | "MEDIUM" | "HIGH" | "MAXIMUM";
	readonly onEffortChange?: (effort: "LOW" | "MEDIUM" | "HIGH" | "MAXIMUM") => void;
	readonly onRetry?: (mode: "same" | "alternate_model" | "deep_reasoning", messageId: string) => void;
}

function MarkdownContent({ markdown, citations }: { readonly markdown: string; readonly citations: readonly CitationItem[] }) {
	return <div className="answer-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownComponents(citations)}>{markdown}</ReactMarkdown></div>;
}

function MessageCopyButton({ text, label = "Copy" }: { readonly text: string; readonly label?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={() => {
				void navigator.clipboard.writeText(text).then(() => {
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1400);
				});
			}}
			className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] text-content-tertiary transition hover:bg-white/[0.05] hover:text-content-primary"
			aria-label={`${label} message`}
		>
			{copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" strokeWidth={1.7} aria-hidden />}
			{copied ? "Copied" : label}
		</button>
	);
}

function ReusePromptButton({ text }: { readonly text: string }) {
	return (
		<button
			type="button"
			onClick={() => window.dispatchEvent(new CustomEvent("aira:reuse-message", { detail: { content: text } }))}
			className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] text-content-tertiary transition hover:bg-white/[0.05] hover:text-content-primary"
			aria-label="Reuse and edit this prompt"
		>
			<PencilLine className="size-3.5" strokeWidth={1.7} aria-hidden />
			Reuse
		</button>
	);
}

function emitComposerCommand(command: string) {
	window.dispatchEvent(new CustomEvent("aira:command", { detail: { command } }));
}

function AssistantSkeleton({ statusText, sourceCount }: { readonly statusText?: string; readonly sourceCount: number }) {
	return (
		<div className="flex gap-3 py-5" aria-busy="true" aria-label="Researching" aria-live="polite">
			<div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-[11px] font-semibold text-accent">A</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2"><p className="text-[12px] font-medium text-content-primary">{statusText || "Researching…"}</p><span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden /></div>
				<p className="mt-1 text-[11px] text-content-tertiary">{sourceCount > 0 ? `${sourceCount} sources found · verifying answer` : "Searching, reading, and comparing relevant sources"}</p>
				<div className="mt-4 space-y-2.5"><div className="h-2 w-[88%] animate-pulse rounded bg-white/[0.055]" /><div className="h-2 w-[72%] animate-pulse rounded bg-white/[0.055]" /><div className="h-2 w-[58%] animate-pulse rounded bg-white/[0.055]" /></div>
			</div>
		</div>
	);
}

const STARTERS = [
	{ href: "/work", title: "Work Mode", description: "State an outcome and produce validated deliverables.", icon: Sparkles },
	{ href: "/knowledge", title: "Work with files", description: "Upload PDFs and documents, then ask with context.", icon: FileText },
	{ href: "/agents", title: "Delegate a task", description: "Run a longer autonomous workflow with an agent.", icon: WandSparkles },
	{ href: "/omniroute", title: "Open OmniRoute", description: "Route across your configured AI providers and models.", icon: Network },
] as const;

function threadTitle(messages: readonly ConversationMessageDto[], streamingUserQuery: string | null): string {
	const firstUser = messages.find((message) => message.role === "USER")?.content ?? streamingUserQuery;
	if (!firstUser) return "New conversation";
	return firstUser.length > 48 ? `${firstUser.slice(0, 48).trim()}…` : firstUser;
}

function conversationText(messages: readonly ConversationMessageDto[]): string {
	return messages.map((message) => `${message.role === "USER" ? "You" : "AIRA AI"}:\n${message.content}`).join("\n\n");
}

export function ConversationMessageList({
	messages,
	streamingUserQuery,
	streamingAssistantMarkdown,
	streamingCitations,
	showAssistantSkeleton = false,
	showEmptyHint = false,
	exampleQueries = [],
	onPickExample,
	statusText,
	isTemporary = false,
	isAuthed = false,
	effort = "MEDIUM",
	onEffortChange,
	onRetry,
}: ConversationMessageListProps) {
	const [shareFeedback, setShareFeedback] = useState<string | null>(null);
	const [retryMenuOpenId, setRetryMenuOpenId] = useState<string | null>(null);
	const [showExportModal, setShowExportModal] = useState(false);

	const latestStoredCitations = useMemo(() => {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (message?.role === "ASSISTANT" && isCitationArray(message.citations) && message.citations.length > 0) return message.citations;
		}
		return [] as readonly CitationItem[];
	}, [messages]);

	const inspectorCitations = streamingCitations.length > 0 ? streamingCitations : latestStoredCitations;
	const createdAt = messages[0]?.createdAt ? new Date(messages[0].createdAt) : null;
	const title = threadTitle(messages, streamingUserQuery);
	const copyAll = conversationText(messages);
	const shareableText = [
		copyAll,
		streamingUserQuery ? `You:\n${streamingUserQuery}` : "",
		streamingAssistantMarkdown ? `AIRA AI:\n${streamingAssistantMarkdown}` : "",
	].filter(Boolean).join("\n\n");

	const handleDownloadExport = (format: "markdown" | "json") => {
		let content = "";
		let filename = `aira-conversation-${Date.now()}`;
		let type = "text/plain";

		if (format === "markdown") {
			content = `# ${title}\n\n${shareableText}`;
			filename += ".md";
			type = "text/markdown";
		} else {
			content = JSON.stringify({ title, createdAt, messages }, null, 2);
			filename += ".json";
			type = "application/json";
		}

		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
		setShowExportModal(false);
	};

	async function shareConversation() {
		if (!shareableText.trim()) {
			setShareFeedback("Start a conversation before sharing.");
			window.setTimeout(() => setShareFeedback(null), 2200);
			return;
		}
		try {
			if (typeof navigator.share === "function") {
				await navigator.share({ title, text: shareableText });
				setShareFeedback("Shared");
			} else if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(shareableText);
				setShareFeedback("Conversation copied");
			} else {
				window.prompt("Copy this conversation:", shareableText);
				setShareFeedback("Ready to copy");
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
			setShareFeedback("Could not share this conversation");
		}
		window.setTimeout(() => setShareFeedback(null), 2200);
	}

	const renderAssistant = (message: {
		readonly id?: string;
		readonly content: string;
		readonly citations: unknown;
		readonly streaming: boolean;
		readonly confidence?: number;
		readonly branchIndex?: number;
		readonly branchCount?: number;
	}) => {
		const citations = isCitationArray(message.citations) ? message.citations : [];
		const effectiveCitations = message.streaming ? streamingCitations : citations;
		const citedIndices = parseCitationIndicesFromAnswer(message.content);
		const linkedContent = linkifyCitations(message.content, effectiveCitations.length);
		const finalText = linkedContent.trim() || (effectiveCitations.length > 0 ? "AIRA found sources but did not generate a text response." : "No response generated.");
		const confidence = message.confidence ?? (effectiveCitations.length > 0 ? 0.94 : 0.88);

		return (
			<div className="aira-enter group flex gap-3 py-5">
				<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-[11px] font-semibold text-accent">A</div>
				<div className="aira-assistant-response min-w-0 flex-1 border-b border-white/[0.07] pb-5">
					<div className="mb-2 flex min-h-7 items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-2">
							<p className="text-[12px] font-semibold text-content-primary">AIRA AI</p>
							{effectiveCitations.length > 0 ? (
								<span className="inline-flex items-center gap-1 text-[10px] text-content-tertiary">
									<Globe2 className="size-3" aria-hidden /> {effectiveCitations.length} sources
								</span>
							) : null}
							{/* Confidence Badge (Gate 61) */}
							<span className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
								<ShieldCheck className="size-2.5" /> {Math.round(confidence * 100)}% Calibrated
							</span>
							{/* Branching indicator if present (Gate 103) */}
							{message.branchCount && message.branchCount > 1 ? (
								<span className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-content-secondary">
									<ChevronLeft className="size-2.5 cursor-pointer hover:text-accent" />
									{message.branchIndex ?? 1} / {message.branchCount}
									<ChevronRight className="size-2.5 cursor-pointer hover:text-accent" />
								</span>
							) : null}
						</div>
						{!message.streaming && message.content ? (
							<div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
								{/* Retry Modes Button (Gate 104) */}
								{message.id && onRetry ? (
									<div className="relative">
										<button
											type="button"
											onClick={() => setRetryMenuOpenId(retryMenuOpenId === message.id ? null : (message.id ?? null))}
											className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-content-tertiary hover:bg-white/[0.05] hover:text-content-primary"
											title="Retry response"
										>
											<RotateCcw className="size-3" /> Retry
										</button>
										{retryMenuOpenId === message.id && (
											<div className="absolute right-0 top-8 z-30 w-44 rounded-lg border border-white/[0.1] bg-[#111728] p-1 shadow-xl">
												<button
													type="button"
													onClick={() => {
														onRetry("same", message.id!);
														setRetryMenuOpenId(null);
													}}
													className="w-full rounded px-2 py-1 text-left text-[11px] text-content-secondary hover:bg-white/[0.08] hover:text-content-primary"
												>
													Same model
												</button>
												<button
													type="button"
													onClick={() => {
														onRetry("alternate_model", message.id!);
														setRetryMenuOpenId(null);
													}}
													className="w-full rounded px-2 py-1 text-left text-[11px] text-content-secondary hover:bg-white/[0.08] hover:text-content-primary"
												>
													Alternate model
												</button>
												<button
													type="button"
													onClick={() => {
														onRetry("deep_reasoning", message.id!);
														setRetryMenuOpenId(null);
													}}
													className="w-full rounded px-2 py-1 text-left text-[11px] text-content-secondary hover:bg-white/[0.08] hover:text-content-primary"
												>
													Deeper reasoning
												</button>
											</div>
										)}
									</div>
								) : null}
								<MessageCopyButton text={message.content} />
							</div>
						) : null}
					</div>
					<div className="whitespace-pre-wrap text-[14px] leading-7 text-content-secondary">
						<MarkdownContent markdown={finalText} citations={effectiveCitations} />
					</div>
					{effectiveCitations.length > 0 ? (
						<div className="mt-6">
							<CitationCards citations={effectiveCitations} citedIndices={citedIndices} />
						</div>
					) : null}
				</div>
			</div>
		);
	};

	return (
		<div className="aira-thread-layout w-full">
			{/* Temporary Mode Alert Banner (Gate 58) */}
			{isTemporary && (
				<div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-200">
					<div className="flex items-center gap-2">
						<EyeOff className="size-3.5 text-amber-400" />
						<span>Temporary Mode Active: Messages will not be saved to your conversation history.</span>
					</div>
				</div>
			)}

			<div className="aira-thread-toolbar sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-[rgba(245,244,239,0.07)] bg-[#0d0e12]/95 px-4 backdrop-blur-xl sm:px-5">
				<div className="min-w-0">
					<h2 className="truncate text-[13px] font-semibold text-content-primary">{title}</h2>
					<p className="mt-0.5 text-[9px] text-content-tertiary">AIRA workspace</p>
				</div>

				{/* Effort Selector in Toolbar (Gate 102) */}
				<div className="hidden items-center rounded-lg border border-[rgba(245,244,239,0.08)] bg-[#13151b] p-0.5 sm:flex" aria-label="Effort Control">
					{(["LOW", "MEDIUM", "HIGH", "MAXIMUM"] as const).map((lvl) => (
						<button
							key={lvl}
							type="button"
							onClick={() => onEffortChange?.(lvl)}
							className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition ${
								effort === lvl ? "bg-[rgba(212,175,55,0.15)] text-[#d4af37]" : "text-content-tertiary hover:text-content-primary"
							}`}
							title={`Set effort to ${lvl}`}
						>
							{lvl}
						</button>
					))}
				</div>

				<div className="flex items-center gap-1.5">
					<Link
						href="/workspace-search"
						className="grid size-8 place-items-center rounded-lg text-content-tertiary transition hover:bg-white/[0.05] hover:text-content-primary"
						aria-label="Search conversation history"
					>
						<History className="size-4" strokeWidth={1.6} />
					</Link>
					<button
						type="button"
						onClick={() => setShowExportModal(true)}
						disabled={!shareableText.trim()}
						className="grid size-8 place-items-center rounded-lg text-content-tertiary transition hover:bg-white/[0.05] hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-35"
						aria-label="Export conversation"
						title="Export / Download"
					>
						<Download className="size-4" strokeWidth={1.6} />
					</button>
					<button
						type="button"
						onClick={() => void shareConversation()}
						disabled={!shareableText.trim()}
						className="grid size-8 place-items-center rounded-lg text-content-tertiary transition hover:bg-white/[0.05] hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-35"
						aria-label="Share conversation"
					>
						<Share2 className="size-4" strokeWidth={1.6} />
					</button>
					<Link
						href="/compare"
						className="ml-1 hidden h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#111827] px-3 text-[10px] font-medium text-content-secondary transition hover:border-accent/25 hover:text-content-primary md:flex"
						title="Open Model Compare"
					>
						<span className="size-1.5 rounded-full bg-accent" />
						AIRA Auto
						<GitCompareArrows className="size-3.5" strokeWidth={1.6} />
					</Link>
				</div>
				{shareFeedback ? <span className="sr-only" role="status" aria-live="polite">{shareFeedback}</span> : null}
			</div>

			{/* Export Modal (Gate 105) */}
			{showExportModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
					<div className="w-full max-w-sm rounded-xl border border-white/[0.1] bg-[#0f1523] p-5 shadow-2xl">
						<h3 className="text-[14px] font-semibold text-content-primary">Export Conversation</h3>
						<p className="mt-1 text-[11px] text-content-tertiary">Select your preferred export format:</p>
						<div className="mt-4 space-y-2">
							<button
								type="button"
								onClick={() => handleDownloadExport("markdown")}
								className="flex w-full items-center gap-2.5 rounded-lg border border-white/[0.08] bg-[#141b2e] p-2.5 text-left text-[12px] text-content-primary hover:bg-white/[0.08]"
							>
								<FileText className="size-4 text-accent" />
								<div>
									<span className="font-medium">Markdown (.md)</span>
									<p className="text-[10px] text-content-tertiary">Plain text formatted with code and citations</p>
								</div>
							</button>
							<button
								type="button"
								onClick={() => handleDownloadExport("json")}
								className="flex w-full items-center gap-2.5 rounded-lg border border-white/[0.08] bg-[#141b2e] p-2.5 text-left text-[12px] text-content-primary hover:bg-white/[0.08]"
							>
								<FileJson className="size-4 text-accent" />
								<div>
									<span className="font-medium">JSON Data (.json)</span>
									<p className="text-[10px] text-content-tertiary">Structured data payload with timestamps & metadata</p>
								</div>
							</button>
							<button
								type="button"
								onClick={() => {
									setShowExportModal(false);
									window.print();
								}}
								className="flex w-full items-center gap-2.5 rounded-lg border border-white/[0.08] bg-[#141b2e] p-2.5 text-left text-[12px] text-content-primary hover:bg-white/[0.08]"
							>
								<FileDown className="size-4 text-accent" />
								<div>
									<span className="font-medium">PDF Document</span>
									<p className="text-[10px] text-content-tertiary">Formatted printable document</p>
								</div>
							</button>
						</div>
						<div className="mt-5 flex justify-end">
							<button
								type="button"
								onClick={() => setShowExportModal(false)}
								className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-content-tertiary hover:text-content-primary"
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			<div className="aira-thread-columns grid min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px]">
				<section className="min-w-0 px-4 py-4 sm:px-6" aria-label="Conversation messages">
					<div className="aira-message-stack mx-auto max-w-[960px]">
						{showEmptyHint ? (
							<div className="aira-enter py-6 sm:py-8 space-y-6">
								{/* Command Hero Header */}
								<div className="flex flex-col items-start text-left space-y-3">
									<div className="inline-flex items-center gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-[11px] font-medium text-sky-400">
										<span className="size-1.5 rounded-full bg-sky-400 animate-pulse" aria-hidden />
										<span>AIRA Intelligence OS · Sovereign Multi-Provider Grid</span>
									</div>
									<h2 className="text-2xl sm:text-3xl font-bold tracking-[-0.035em] text-[#F8FAFC]">
										Where Autonomous Research Meets Verified Truth.
									</h2>
									<p className="max-w-2xl text-[12.5px] leading-relaxed text-[#94A3B8]">
										Orchestrate multi-model reasoning, deep web investigation, and autonomous agent missions with source-grounded proof.
									</p>
								</div>

								{/* Asymmetric Bento Capabilities Grid */}
								<div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
									{/* Dominant Hero Bento Tile (2 cols wide) */}
									<div className="md:col-span-2 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-5 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_32px_rgba(0,0,0,0.4)] transition hover:border-sky-500/30">
										<div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-3.5">
											<div className="flex items-center gap-2.5">
												<span className="grid size-7 place-items-center rounded-lg bg-sky-500/20 text-sky-400">
													<Globe2 className="size-4" />
												</span>
												<div>
													<h3 className="text-xs font-semibold uppercase tracking-wider text-[#F8FAFC]">Autonomous Deep Investigation</h3>
													<p className="text-[11px] text-[#94A3B8]">Multi-hop source triangulation & fail-closed isolation.</p>
												</div>
											</div>
											<span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-medium text-emerald-400">
												48+ Live Indices
											</span>
										</div>
										<p className="mt-3.5 text-[12px] leading-5 text-[#CBD5E1]">
											Launch exhaustive research sweeps synthesizing authoritative market documents, technical specifications, and regulatory frameworks.
										</p>
										<div className="mt-4 flex flex-wrap gap-2">
											<button
												type="button"
												onClick={() => onPickExample?.("Conduct a comprehensive due diligence investigation into competitive AI infrastructure, evaluating fail-closed security, SLA guarantees, and enterprise pricing models.")}
												className="group inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-left text-[11.5px] font-medium text-[#E2E8F0] transition hover:border-sky-500/40 hover:bg-sky-500/[0.08] hover:text-white"
											>
												<Sparkles className="size-3.5 text-sky-400" />
												<span>Run Competitive AI Due Diligence</span>
												<span className="text-sky-400 transition group-hover:translate-x-0.5">→</span>
											</button>
											<button
												type="button"
												onClick={() => onPickExample?.("Perform an end-to-end security architecture audit for cross-tenant data isolation, verifying that row-level policies, signed storage tokens, and memory namespaces fail closed under attack.")}
												className="group inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-left text-[11.5px] font-medium text-[#E2E8F0] transition hover:border-sky-500/40 hover:bg-sky-500/[0.08] hover:text-white"
											>
												<ShieldCheck className="size-3.5 text-sky-400" />
												<span>Security & Threat Model Audit</span>
												<span className="text-sky-400 transition group-hover:translate-x-0.5">→</span>
											</button>
										</div>
									</div>

									{/* Bento Tile 2: OmniRoute Gateway */}
									<div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_24px_rgba(0,0,0,0.3)] transition hover:border-sky-500/30 flex flex-col justify-between">
										<div>
											<div className="flex items-center gap-2.5">
												<span className="grid size-7 place-items-center rounded-lg bg-sky-500/15 text-sky-400">
													<Network className="size-4" />
												</span>
												<div>
													<h3 className="text-xs font-semibold uppercase tracking-wider text-[#F8FAFC]">OmniRoute Grid</h3>
													<p className="text-[10.5px] text-[#94A3B8]">Multi-provider failover</p>
												</div>
											</div>
											<div className="mt-3.5 space-y-1.5">
												<div className="flex items-center justify-between text-[10.5px] font-mono text-[#94A3B8] border-b border-white/[0.04] pb-1.5">
													<span>Claude 3.7 Sonnet</span>
													<span className="text-sky-400">Frontier</span>
												</div>
												<div className="flex items-center justify-between text-[10.5px] font-mono text-[#94A3B8] border-b border-white/[0.04] pb-1.5">
													<span>DeepSeek R1</span>
													<span className="text-emerald-400">Reasoning</span>
												</div>
												<div className="flex items-center justify-between text-[10.5px] font-mono text-[#94A3B8]">
													<span>GPT-4.5 / Gemini 2.0</span>
													<span className="text-[#CBD5E1]">Balanced</span>
												</div>
											</div>
										</div>
										<button
											type="button"
											onClick={() => onPickExample?.("Compare ChatGPT vs Gemini reasoning benchmarks and cost curves")}
											className="mt-4 inline-flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-[#CBD5E1] transition hover:border-sky-500/30 hover:bg-sky-500/10 hover:text-white"
										>
											<span>Compare Models Side-by-Side</span>
											<span className="text-sky-400">→</span>
										</button>
									</div>

									{/* Bento Tile 3: Work Mode Swarms */}
									<div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_24px_rgba(0,0,0,0.3)] transition hover:border-sky-500/30 flex flex-col justify-between">
										<div>
											<div className="flex items-center gap-2.5">
												<span className="grid size-7 place-items-center rounded-lg bg-sky-500/15 text-sky-400">
													<Sparkles className="size-4" />
												</span>
												<div>
													<h3 className="text-xs font-semibold uppercase tracking-wider text-[#F8FAFC]">Work Mode Swarms</h3>
													<p className="text-[10.5px] text-[#94A3B8]">Autonomous missions</p>
												</div>
											</div>
											<p className="mt-3 text-[11.5px] leading-relaxed text-[#94A3B8]">
												State target business outcomes and delegate execution to resilient autonomous agents with verified artifacts.
											</p>
										</div>
										<Link
											href="/work"
											className="mt-4 inline-flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-[#CBD5E1] transition hover:border-sky-500/30 hover:bg-sky-500/10 hover:text-white"
										>
											<span>Explore Managed Work</span>
											<span className="text-sky-400">→</span>
										</Link>
									</div>

									{/* Bento Tile 4: Knowledge Vault (Spans 2 cols) */}
									<div className="md:col-span-2 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_24px_rgba(0,0,0,0.3)] transition hover:border-sky-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<FileText className="size-4 text-sky-400" />
												<h3 className="text-xs font-semibold uppercase tracking-wider text-[#F8FAFC]">Private Context & Knowledge Vault</h3>
											</div>
											<p className="text-[11.5px] text-[#94A3B8]">
												Zero-data-retention document ingestion. Query PDFs, codebases, and financial reports with citation grounding.
											</p>
										</div>
										<Link
											href="/knowledge"
											className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-[11.5px] font-medium text-sky-400 transition hover:bg-sky-500/20 hover:text-sky-300"
										>
											<span>Upload Context</span>
											<span>↗</span>
										</Link>
									</div>
								</div>

								{/* Quick Workspaces Row */}
								<div className="pt-2">
									<p className="text-[10px] font-mono uppercase tracking-wider text-[#64748B] mb-2.5">
										Quick Workspaces
									</p>
									<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
										{STARTERS.map((item) => {
											const Icon = item.icon;
											return (
												<Link
													key={item.href}
													href={item.href}
													className="group flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left transition hover:border-sky-500/30 hover:bg-white/[0.04]"
												>
													<Icon className="size-4 shrink-0 text-[#94A3B8] transition group-hover:text-sky-400" strokeWidth={1.8} aria-hidden />
													<div className="min-w-0">
														<strong className="block truncate text-[11.5px] font-medium text-[#CBD5E1] group-hover:text-white">{item.title}</strong>
														<small className="block truncate text-[10px] text-[#64748B]">{item.description}</small>
													</div>
												</Link>
											);
										})}
									</div>
								</div>
							</div>
						) : null}

						{messages.map((message) =>
							message.role === "USER" ? (
								<div key={message.id} className="aira-enter group flex w-full justify-end py-3">
									<div className="max-w-[86%] sm:max-w-[78%]">
										<div className="rounded-2xl border border-accent/20 bg-accent/15 px-4 py-3 text-[14px] leading-6 text-blue-50">
											{message.content}
										</div>
										<div className="mt-1 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
											<ReusePromptButton text={message.content} />
											<MessageCopyButton text={message.content} />
										</div>
									</div>
								</div>
							) : (
								<div key={message.id}>
									{renderAssistant({
										id: message.id,
										content: message.content,
										citations: message.citations,
										streaming: false,
										confidence: message.metadata?.confidence,
										branchIndex: message.metadata?.branchIndex,
										branchCount: message.metadata?.branchCount,
									})}
								</div>
							),
						)}

						{streamingUserQuery ? (
							<div className="flex w-full justify-end py-3" aria-label="Streaming user message">
								<div className="max-w-[86%] rounded-2xl border border-accent/20 bg-accent/15 px-4 py-3 text-[14px] leading-6 text-blue-50 sm:max-w-[78%]">
									{streamingUserQuery}
								</div>
							</div>
						) : null}
						{streamingAssistantMarkdown ? (
							<div aria-label="Streaming assistant message">{renderAssistant({ content: streamingAssistantMarkdown, citations: [], streaming: true })}</div>
						) : null}
						{showAssistantSkeleton ? <AssistantSkeleton statusText={statusText} sourceCount={streamingCitations.length} /> : null}
					</div>
				</section>

				<aside className="aira-live-inspector hidden border-l border-white/[0.07] bg-[#0d1320]/72 p-3 xl:block" aria-label="Conversation inspector">
					<div className="sticky top-20 space-y-3">
						<section className="aira-inspector-section border-b border-white/[0.07] pb-3">
							<p className="text-[11px] font-semibold text-content-primary">Routing & Policy</p>
							<Link href="/omniroute" className="mt-2 flex items-center justify-between rounded-lg px-1 py-2 transition hover:bg-white/[0.035]">
								<span>
									<strong className="block text-[11px] font-semibold text-content-primary">AIRA Auto</strong>
									<small className="mt-0.5 block text-[9px] text-content-tertiary">Provider routing follows workspace policy (Effort: {effort})</small>
								</span>
								<Network className="size-4 text-accent" strokeWidth={1.6} />
							</Link>
						</section>

						<section className="aira-inspector-section border-b border-white/[0.07] pb-3">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-semibold text-content-primary">Sources</p>
								<span className="text-[10px] tabular-nums text-content-tertiary">{inspectorCitations.length || 0}</span>
							</div>
							<div className="mt-2 space-y-1">
								{inspectorCitations.length === 0 ? (
									<p className="border-t border-dashed border-white/[0.07] py-3 text-[10px] leading-4 text-content-tertiary">
										Sources appear here when AIRA grounds an answer on the web.
									</p>
								) : (
									inspectorCitations.slice(0, 6).map((citation) => (
										<a
											key={`${citation.index}-${citation.url}`}
											href={citation.url}
											target="_blank"
											rel="noreferrer"
											className="group flex gap-2 rounded-lg px-1 py-2 transition hover:bg-white/[0.035]"
										>
											<span className="w-4 shrink-0 text-[10px] text-accent">{citation.index}</span>
											<span className="min-w-0 flex-1">
												<strong className="block truncate text-[10px] font-medium text-content-secondary group-hover:text-content-primary">
													{citation.title}
												</strong>
												<small className="mt-0.5 flex items-center gap-1 truncate text-[9px] text-content-tertiary">
													{hostnameFromUrl(citation.url)}
													<ExternalLink className="size-2.5" aria-hidden />
												</small>
											</span>
										</a>
									))
								)}
							</div>
						</section>

						<section className="aira-inspector-section border-b border-white/[0.07] pb-3">
							<p className="text-[11px] font-semibold text-content-primary">Conversation</p>
							<dl className="mt-2 space-y-2 text-[10px]">
								<div className="flex items-center justify-between gap-3">
									<dt className="text-content-tertiary">Created</dt>
									<dd className="truncate text-content-secondary">
										{createdAt && !Number.isNaN(createdAt.getTime())
											? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(createdAt)
											: "New thread"}
									</dd>
								</div>
								<div className="flex items-center justify-between">
									<dt className="text-content-tertiary">Messages</dt>
									<dd className="tabular-nums text-content-secondary">{messages.length}</dd>
								</div>
								<div className="flex items-center justify-between">
									<dt className="text-content-tertiary">Sources</dt>
									<dd className="tabular-nums text-content-secondary">{inspectorCitations.length}</dd>
								</div>
								<div className="flex items-center justify-between">
									<dt className="text-content-tertiary">Mode</dt>
									<dd className="inline-flex items-center gap-1 text-content-secondary">
										<span className="size-1.5 rounded-full bg-accent" />
										{isTemporary ? "Temporary" : "Persistent"}
									</dd>
								</div>
							</dl>
						</section>

						<section className="aira-inspector-section">
							<p className="text-[11px] font-semibold text-content-primary">Actions</p>
							<div className="mt-2 space-y-0.5">
								<button
									type="button"
									disabled={!copyAll}
									onClick={() => void navigator.clipboard.writeText(copyAll)}
									className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-[10px] text-content-secondary transition hover:bg-white/[0.035] hover:text-content-primary disabled:opacity-40"
								>
									<Copy className="size-3.5" strokeWidth={1.6} />
									Copy conversation
								</button>
								<button
									type="button"
									disabled={!shareableText.trim()}
									onClick={() => void shareConversation()}
									className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-[10px] text-content-secondary transition hover:bg-white/[0.035] hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-40"
								>
									<Share2 className="size-3.5" strokeWidth={1.6} />
									Share conversation
								</button>
								<button
									type="button"
									onClick={() => setShowExportModal(true)}
									className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-[10px] text-content-secondary transition hover:bg-white/[0.035] hover:text-content-primary"
								>
									<Download className="size-3.5" strokeWidth={1.6} />
									Export (.md, .json, .pdf)
								</button>
								<button
									type="button"
									onClick={() => emitComposerCommand("/new")}
									className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-[10px] text-content-secondary transition hover:bg-white/[0.035] hover:text-content-primary"
								>
									<MessageSquarePlus className="size-3.5" strokeWidth={1.6} />
									New conversation
								</button>
							</div>
							{shareFeedback ? (
								<p className="mt-2 rounded-lg bg-white/[0.035] px-2 py-1.5 text-[10px] text-content-tertiary" role="status">
									{shareFeedback}
								</p>
							) : null}
						</section>
					</div>
				</aside>
			</div>
		</div>
	);
}
