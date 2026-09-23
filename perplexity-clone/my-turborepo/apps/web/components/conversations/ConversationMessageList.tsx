"use client";

import {
	BookOpen,
	Check,
	ChevronLeft,
	ChevronRight,
	Compass,
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
	PenTool,
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
import { AiraNeuralDeliberation } from "../AiraNeuralDeliberation";
import { getMarkdownComponents } from "../markdownComponents";
import { linkifyCitations, parseCitationIndicesFromAnswer } from "../../src/services/citations";
import { type ConversationSummary } from "./ConversationSidebar";
import { cn } from "../../lib/cn";

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
	readonly composerSlot?: React.ReactNode;
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
		<div className="py-2" aria-busy="true" aria-label="Researching" aria-live="polite">
			<AiraNeuralDeliberation isDeliberating={true} sourceCount={sourceCount} />
		</div>
	);
}

const STARTERS = [
	{ href: "/work", title: "AIRA Swarms", description: "Outcome-driven autonomous missions with verified proof.", icon: Sparkles },
	{ href: "/knowledge", title: "Sovereign Vault", description: "Zero-leak private context, PDF analysis & embeddings.", icon: FileText },
	{ href: "/agents", title: "Agent Builder", description: "Design, simulate and launch resilient autonomous agents.", icon: WandSparkles },
	{ href: "/omniroute", title: "Cortex Engine", description: "Multi-neural gateway optimizing speed, cost & reasoning.", icon: Network },
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
	composerSlot,
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
		const hasCalibratedConfidence = typeof message.confidence === "number" && message.confidence > 0;

		return (
			<div className="aira-enter group flex gap-4 py-4 sm:py-6">
				<div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-[4px] border border-[#EAEAEA] bg-[#F9F8F6] text-[10px] font-bold text-[#111111]">A</div>
				<div className="aira-assistant-response min-w-0 flex-1 pb-8">
					<div className="mb-2 flex min-h-7 flex-wrap items-center justify-between gap-2">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<p className="shrink-0 whitespace-nowrap text-[12px] font-semibold text-[#111115]">AIRA AI</p>
							{effectiveCitations.length > 0 ? (
								<span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-[#6B6A75]">
									<Globe2 className="size-3 text-[#3A0CA3]" aria-hidden /> {effectiveCitations.length} sources
								</span>
							) : null}
							{/* Evidence / Confidence Badge */}
							{hasCalibratedConfidence ? (
								<span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-emerald-500/20 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
									<ShieldCheck className="size-2.5" /> {Math.round(message.confidence! * 100)}% Calibrated
								</span>
							) : effectiveCitations.length > 0 ? (
								<span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-[#EAEAEA] bg-[#F4F4F5] px-1.5 py-0.5 text-[9px] font-medium text-[#111111]">
									<ShieldCheck className="size-2.5" /> Source-Grounded
								</span>
							) : null}
							{/* Branching indicator if present (Gate 103) */}
							{message.branchCount && message.branchCount > 1 ? (
								<span className="inline-flex items-center gap-1 rounded border border-[rgba(17,17,21,0.08)] bg-white px-1.5 py-0.5 text-[9px] text-[#6B6A75]">
									<ChevronLeft className="size-2.5 cursor-pointer hover:text-[#3A0CA3]" />
									{message.branchIndex ?? 1} / {message.branchCount}
									<ChevronRight className="size-2.5 cursor-pointer hover:text-[#3A0CA3]" />
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
											className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-[#6B6A75] hover:bg-[#111115]/[0.05] hover:text-[#111115]"
											title="Retry response"
										>
											<RotateCcw className="size-3" /> Retry
										</button>
										{retryMenuOpenId === message.id && (
											<div className="absolute right-0 top-8 z-30 w-44 rounded-lg border border-[rgba(17,17,21,0.1)] bg-white p-1 shadow-lg">
												<button
													type="button"
													onClick={() => {
														onRetry("same", message.id!);
														setRetryMenuOpenId(null);
													}}
													className="w-full rounded px-2 py-1 text-left text-[11px] text-[#6B6A75] hover:bg-[#111115]/[0.05] hover:text-[#111115]"
												>
													Same model
												</button>
												<button
													type="button"
													onClick={() => {
														onRetry("alternate_model", message.id!);
														setRetryMenuOpenId(null);
													}}
													className="w-full rounded px-2 py-1 text-left text-[11px] text-[#6B6A75] hover:bg-[#111115]/[0.05] hover:text-[#111115]"
												>
													Alternate model
												</button>
												<button
													type="button"
													onClick={() => {
														onRetry("deep_reasoning", message.id!);
														setRetryMenuOpenId(null);
													}}
													className="w-full rounded px-2 py-1 text-left text-[11px] text-[#6B6A75] hover:bg-[#111115]/[0.05] hover:text-[#111115]"
												>
													Deeper reasoning
												</button>
											</div>
										)}
									</div>
								) : null}
								<button
									type="button"
									onClick={() => window.dispatchEvent(new CustomEvent("aira:toggle-canvas"))}
									className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-[#3A0CA3] transition hover:bg-[#3A0CA3]/[0.08]"
									title="Open in AIRA Deliverables Canvas"
								>
									<Layers className="size-3" /> Canvas
								</button>
								<MessageCopyButton text={message.content} />
							</div>
						) : null}
					</div>
					<div className="whitespace-pre-wrap text-[15px] leading-8 text-content-secondary">
						<MarkdownContent markdown={finalText} citations={effectiveCitations} />
					</div>
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

			{!showEmptyHint && (
				<div className="aira-thread-toolbar sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-[rgba(17,17,21,0.08)] bg-[#F9F8F6]/95 px-4 backdrop-blur-xl sm:px-5">
				<div className="min-w-0">
					<h2 className="truncate text-[13px] font-semibold text-[#111115]">{title}</h2>
					<p className="mt-0.5 text-[10px] text-[#6B6A75]">AIRA workspace</p>
				</div>

				{/* Effort Selector in Toolbar (Gate 102) */}
				<div className="hidden items-center rounded-lg border border-[rgba(17,17,21,0.08)] bg-white p-0.5 sm:flex" aria-label="Effort Control">
					{(["LOW", "MEDIUM", "HIGH", "MAXIMUM"] as const).map((lvl) => (
						<button
							key={lvl}
							type="button"
							onClick={() => onEffortChange?.(lvl)}
							className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition ${
								effort === lvl ? "bg-[#3A0CA3]/10 text-[#3A0CA3] font-semibold" : "text-[#6B6A75] hover:text-[#111115]"
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
						className="grid size-8 place-items-center rounded-lg text-[#6B6A75] transition hover:bg-[#111115]/[0.05] hover:text-[#111115]"
						aria-label="Search conversation history"
					>
						<History className="size-4" strokeWidth={1.6} />
					</Link>
					<button
						type="button"
						onClick={() => setShowExportModal(true)}
						disabled={!shareableText.trim()}
						className="grid size-8 place-items-center rounded-lg text-[#6B6A75] transition hover:bg-[#111115]/[0.05] hover:text-[#111115] disabled:cursor-not-allowed disabled:opacity-35"
						aria-label="Export conversation"
						title="Export / Download"
					>
						<Download className="size-4" strokeWidth={1.6} />
					</button>
					<button
						type="button"
						onClick={() => void shareConversation()}
						disabled={!shareableText.trim()}
						className="grid size-8 place-items-center rounded-lg text-[#6B6A75] transition hover:bg-[#111115]/[0.05] hover:text-[#111115] disabled:cursor-not-allowed disabled:opacity-35"
						aria-label="Share conversation"
					>
						<Share2 className="size-4" strokeWidth={1.6} />
					</button>
					<Link
						href="/compare"
						className="ml-1 hidden h-9 items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.08)] bg-white px-3 text-[11px] font-medium text-[#111115] shadow-sm transition hover:border-[#3A0CA3]/30 md:flex"
						title="Open Model Compare"
					>
						<span className="size-1.5 rounded-full bg-[#3A0CA3]" />
						AIRA Auto
						<GitCompareArrows className="size-3.5 text-[#3A0CA3]" strokeWidth={1.6} />
					</Link>
				</div>
				{shareFeedback ? <span className="sr-only" role="status" aria-live="polite">{shareFeedback}</span> : null}
			</div>
			)}

			{/* Export Modal (Gate 105) */}
			{showExportModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
					<div className="w-full max-w-sm rounded-xl border border-[rgba(17,17,21,0.1)] bg-white p-5 shadow-2xl">
						<h3 className="text-[14px] font-semibold text-[#111115]">Export Conversation</h3>
						<p className="mt-1 text-[11px] text-[#6B6A75]">Select your preferred export format:</p>
						<div className="mt-4 space-y-2">
							<button
								type="button"
								onClick={() => handleDownloadExport("markdown")}
								className="flex w-full items-center gap-2.5 rounded-lg border border-[rgba(17,17,21,0.08)] bg-[#F9F8F6] p-2.5 text-left text-[12px] text-[#111115] hover:bg-[#F2F0E8] transition"
							>
								<FileText className="size-4 text-[#3A0CA3]" />
								<div>
									<span className="font-medium">Markdown (.md)</span>
									<p className="text-[10px] text-[#6B6A75]">Plain text formatted with code and citations</p>
								</div>
							</button>
							<button
								type="button"
								onClick={() => handleDownloadExport("json")}
								className="flex w-full items-center gap-2.5 rounded-lg border border-[rgba(17,17,21,0.08)] bg-[#F9F8F6] p-2.5 text-left text-[12px] text-[#111115] hover:bg-[#F2F0E8] transition"
							>
								<FileJson className="size-4 text-[#3A0CA3]" />
								<div>
									<span className="font-medium">JSON Data (.json)</span>
									<p className="text-[10px] text-[#6B6A75]">Structured data payload with timestamps & metadata</p>
								</div>
							</button>
							<button
								type="button"
								onClick={() => {
									setShowExportModal(false);
									window.print();
								}}
								className="flex w-full items-center gap-2.5 rounded-lg border border-[rgba(17,17,21,0.08)] bg-[#F9F8F6] p-2.5 text-left text-[12px] text-[#111115] hover:bg-[#F2F0E8] transition"
							>
								<FileDown className="size-4 text-[#3A0CA3]" />
								<div>
									<span className="font-medium">PDF Document</span>
									<p className="text-[10px] text-[#6B6A75]">Formatted printable document</p>
								</div>
							</button>
						</div>
						<div className="mt-5 flex justify-end">
							<button
								type="button"
								onClick={() => setShowExportModal(false)}
								className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-[#6B6A75] hover:text-[#111115]"
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			<div className={cn("aira-thread-columns grid min-h-0 grid-cols-1", !showEmptyHint && "xl:grid-cols-[minmax(0,1fr)_320px]")}>
				<section className="min-w-0 px-4 py-4 sm:px-6" aria-label="Conversation messages">
					<div className={cn("aira-message-stack mx-auto", showEmptyHint ? "max-w-4xl" : "max-w-4xl")}>
						{showEmptyHint ? (
							<div className="aira-enter mx-auto max-w-4xl py-8 sm:py-12 space-y-6 text-center">
								{/* Approved Aira Greeting */}
								<div className="flex flex-col items-center space-y-2">
									<h1 className="font-sans text-3xl sm:text-[40px] font-medium tracking-tight text-[#111111] leading-tight">
										Where would you like to begin?
									</h1>
									<p className="text-[14px] text-[var(--aira-text-2)]">
										Ask anything. Explore further with Aira.
									</p>
								</div>

								{/* Center-Stage Hero Composer */}
								{composerSlot ? (
									<div className="w-full my-1 text-left">
										{composerSlot}
									</div>
								) : null}

								{/* Exactly Three Curated Starter Prompts: Explore, Understand, Create */}
								<div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 text-left">
									<button
										type="button"
										onClick={() => onPickExample?.("Investigate how renewable energy grids and geothermal sources are evolving to power gigawatt-scale AI computing clusters.")}
										className="group flex h-full flex-col justify-between rounded-xl border border-[#EAEAEA] bg-white p-6 shadow-sm transition hover:border-[#A3A3A3] hover:shadow-md"
									>
										<div>
											<div className="flex items-center justify-between gap-2 mb-4">
												<span className="text-[10px] font-bold uppercase tracking-widest text-[#111111] bg-[#F4F4F5] px-2.5 py-1 rounded-sm">
													Explore
												</span>
												<Compass className="size-4 text-[#111111] opacity-60 group-hover:opacity-100 transition" />
											</div>
											<h2 className="text-[14px] font-semibold text-[#111111] leading-snug group-hover:text-black transition">
												Frontier Energy & Compute
											</h2>
											<p className="mt-2 text-[12px] leading-relaxed text-[#525252]">
												Renewable grids and geothermal sources powering gigawatt-scale AI clusters.
											</p>
										</div>
										<span className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-[#111111]">
											Start research <span className="transition group-hover:translate-x-0.5">→</span>
										</span>
									</button>

									<button
										type="button"
										onClick={() => onPickExample?.("Break down the architectural differences and latency trade-offs between test-time compute scaling and standard inference.")}
										className="group flex h-full flex-col justify-between rounded-xl border border-[#EAEAEA] bg-white p-6 shadow-sm transition hover:border-[#A3A3A3] hover:shadow-md"
									>
										<div>
											<div className="flex items-center justify-between gap-2 mb-4">
												<span className="text-[10px] font-bold uppercase tracking-widest text-[#111111] bg-[#F4F4F5] px-2.5 py-1 rounded-sm">
													Understand
												</span>
												<BookOpen className="size-4 text-[#111111] opacity-60 group-hover:opacity-100 transition" />
											</div>
											<h2 className="text-[14px] font-semibold text-[#111111] leading-snug group-hover:text-black transition">
												Test-Time Reasoning Models
											</h2>
											<p className="mt-2 text-[12px] leading-relaxed text-[#525252]">
												Latency trade-offs between test-time compute search depth and standard inference.
											</p>
										</div>
										<span className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-[#111111]">
											Start research <span className="transition group-hover:translate-x-0.5">→</span>
										</span>
									</button>

									<button
										type="button"
										onClick={() => onPickExample?.("Synthesize an executive briefing comparing row-level tenant isolation, signed storage tokens, and private inference deployments.")}
										className="group flex h-full flex-col justify-between rounded-xl border border-[#EAEAEA] bg-white p-6 shadow-sm transition hover:border-[#A3A3A3] hover:shadow-md"
									>
										<div>
											<div className="flex items-center justify-between gap-2 mb-4">
												<span className="text-[10px] font-bold uppercase tracking-widest text-[#111111] bg-[#F4F4F5] px-2.5 py-1 rounded-sm">
													Create
												</span>
												<PenTool className="size-4 text-[#111111] opacity-60 group-hover:opacity-100 transition" />
											</div>
											<h2 className="text-[14px] font-semibold text-[#111111] leading-snug group-hover:text-black transition">
												Sovereign AI Architecture
											</h2>
											<p className="mt-2 text-[12px] leading-relaxed text-[#525252]">
												Executive briefing on row-level security, signed tokens, and private infrastructure.
											</p>
										</div>
										<span className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-[#111111]">
											Start research <span className="transition group-hover:translate-x-0.5">→</span>
										</span>
									</button>
								</div>
							</div>
						) : null}

						{messages.map((message) =>
							message.role === "USER" ? (
								<div key={message.id} className="aira-enter group flex w-full py-8 border-b border-[#EAEAEA] mb-6">
									<div className="w-full">
										<h2 className="font-sans text-[24px] sm:text-[32px] font-medium leading-[1.2] tracking-tight text-[#111111]">
											{message.content}
										</h2>
										<div className="mt-4 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
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
							<div className="flex w-full py-8 border-b border-[#EAEAEA] mb-6" aria-label="Streaming user message">
								<div className="w-full">
									<h2 className="font-sans text-[24px] sm:text-[32px] font-medium leading-[1.2] tracking-tight text-[#111111]">
										{streamingUserQuery}
									</h2>
								</div>
							</div>
						) : null}
						{streamingAssistantMarkdown ? (
							<div aria-label="Streaming assistant message">{renderAssistant({ content: streamingAssistantMarkdown, citations: [], streaming: true })}</div>
						) : null}
						{showAssistantSkeleton ? <AssistantSkeleton statusText={statusText} sourceCount={streamingCitations.length} /> : null}
					</div>
				</section>

				{!showEmptyHint && (
				<aside className="aira-live-inspector hidden border-l border-[var(--aira-border-subtle)] bg-[#F9F8F6]/80 backdrop-blur-sm p-4 xl:block" aria-label="Focus your research">
					<div className="sticky top-20 space-y-6">
						<section className="aira-inspector-section border-b border-[var(--aira-border-subtle)] pb-4">
							<p className="text-[12px] font-semibold text-[var(--aira-text-0)]">Routing & Policy</p>
							<Link href="/omniroute" className="mt-2 flex items-center justify-between rounded-lg px-2 py-2 transition hover:bg-[#09090B]/5">
								<span>
									<strong className="block text-[11px] font-semibold text-[var(--aira-text-0)]">AIRA Auto</strong>
									<small className="mt-0.5 block text-[10px] text-[var(--aira-text-2)]">Provider routing follows workspace policy (Effort: {effort})</small>
								</span>
								<Network className="size-4 text-[#09090B]" strokeWidth={1.6} />
							</Link>
						</section>

						<section className="aira-inspector-section border-b border-[var(--aira-border-subtle)] pb-4">
							<div className="flex items-center justify-between mb-4">
								<p className="text-[12px] font-semibold text-[var(--aira-text-0)]">Focus your research</p>
							</div>
							<div className="mt-2">
								{inspectorCitations.length === 0 ? (
									<p className="py-3 text-[11px] leading-relaxed text-[var(--aira-text-2)]">
										Sources appear here when AIRA grounds an answer on the web.
									</p>
								) : (
									<CitationCards citations={inspectorCitations} />
								)}
							</div>
						</section>

						<section className="aira-inspector-section border-b border-[var(--aira-border-subtle)] pb-4">
							<p className="text-[12px] font-semibold text-[var(--aira-text-0)]">Conversation</p>
							<dl className="mt-2 space-y-2 text-[11px]">
								<div className="flex items-center justify-between gap-3">
									<dt className="text-[var(--aira-text-2)]">Created</dt>
									<dd className="truncate text-[var(--aira-text-0)] font-medium">
										{createdAt && !Number.isNaN(createdAt.getTime())
											? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(createdAt)
											: "New thread"}
									</dd>
								</div>
								<div className="flex items-center justify-between">
									<dt className="text-[var(--aira-text-2)]">Messages</dt>
									<dd className="tabular-nums text-[var(--aira-text-0)] font-medium">{messages.length}</dd>
								</div>
								<div className="flex items-center justify-between">
									<dt className="text-[var(--aira-text-2)]">Sources</dt>
									<dd className="tabular-nums text-[var(--aira-text-0)] font-medium">{inspectorCitations.length}</dd>
								</div>
								<div className="flex items-center justify-between">
									<dt className="text-[var(--aira-text-2)]">Mode</dt>
									<dd className="inline-flex items-center gap-1 text-[var(--aira-text-0)] font-medium">
										<span className="size-1.5 rounded-full bg-[#09090B]" />
										{isTemporary ? "Temporary" : "Persistent"}
									</dd>
								</div>
							</dl>
						</section>

						<section className="aira-inspector-section">
							<p className="text-[12px] font-semibold text-[var(--aira-text-0)]">Actions</p>
							<div className="mt-2 space-y-0.5">
								<button
									type="button"
									disabled={!copyAll}
									onClick={() => void navigator.clipboard.writeText(copyAll)}
									className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] text-[var(--aira-text-2)] transition hover:bg-[#09090B]/5 hover:text-[var(--aira-text-0)] disabled:opacity-40"
								>
									<Copy className="size-3.5" strokeWidth={1.6} />
									Copy conversation
								</button>
								<button
									type="button"
									disabled={!shareableText.trim()}
									onClick={() => void shareConversation()}
									className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] text-[var(--aira-text-2)] transition hover:bg-[#09090B]/5 hover:text-[var(--aira-text-0)] disabled:cursor-not-allowed disabled:opacity-40"
								>
									<Share2 className="size-3.5" strokeWidth={1.6} />
									Share conversation
								</button>
								<button
									type="button"
									onClick={() => setShowExportModal(true)}
									className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] text-[var(--aira-text-2)] transition hover:bg-[#09090B]/5 hover:text-[var(--aira-text-0)]"
								>
									<Download className="size-3.5" strokeWidth={1.6} />
									Export (.md, .json, .pdf)
								</button>
								<button
									type="button"
									onClick={() => emitComposerCommand("/new")}
									className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] text-[var(--aira-text-2)] transition hover:bg-[#09090B]/5 hover:text-[var(--aira-text-0)]"
								>
									<MessageSquarePlus className="size-3.5" strokeWidth={1.6} />
									New conversation
								</button>
							</div>
							{shareFeedback ? (
								<p className="mt-2 rounded-lg bg-white/[0.035] px-2 py-1.5 text-[10px] text-[var(--aira-text-2)]" role="status">
									{shareFeedback}
								</p>
							) : null}
						</section>
					</div>
				</aside>
				)}
			</div>
		</div>
	);
}
