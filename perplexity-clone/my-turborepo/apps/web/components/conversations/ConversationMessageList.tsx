"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Loader2, MessageCircle } from "lucide-react";

import { CitationCards, type CitationItem } from "../CitationCards";
import { getMarkdownComponents } from "../markdownComponents";
import { cn } from "../../lib/cn";
import { linkifyCitations, parseCitationIndicesFromAnswer } from "../../src/services/citations";

import { type ConversationSummary } from "./ConversationSidebar";
import { Clock, History, ArrowRight } from "lucide-react";

export interface ConversationMessageDto {
	readonly id: string;
	readonly role: "USER" | "ASSISTANT";
	readonly content: string;
	readonly parentMessageId: string | null;
	readonly citations: unknown;
	readonly createdAt: string;
}

function formatLastUpdated(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffHrs = diffMs / (1000 * 60 * 60);
	if (diffHrs < 24) {
		return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
			-Math.round(diffHrs) || -1,
			"hour",
		);
	}
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}

function isCitationArray(value: unknown): value is readonly CitationItem[] {
	if (!Array.isArray(value)) return false;
	return value.every((v) => {
		if (!v || typeof v !== "object") return false;
		const o = v as Record<string, unknown>;
		return (
			typeof o.url === "string" &&
			typeof o.title === "string" &&
			typeof o.index === "number" &&
			(o.publishedDate === null || typeof o.publishedDate === "string") &&
			typeof o.rankingScore === "number" &&
			(o.excerpt === undefined || typeof o.excerpt === "string") &&
			(o.sourceQuality === undefined || typeof o.sourceQuality === "string")
		);
	});
}

export interface ConversationMessageListProps {
	readonly messages: readonly ConversationMessageDto[];
	readonly streamingUserQuery: string | null;
	readonly streamingAssistantMarkdown: string | null;
	readonly streamingCitations: readonly CitationItem[];
	/** True while waiting for the first assistant token (connecting or streaming start). */
	readonly showAssistantSkeleton?: boolean;
	readonly showEmptyHint?: boolean;
	readonly isAuthed?: boolean;
	readonly recentConversations?: readonly ConversationSummary[];
	readonly onSelectConversation?: (id: string) => void;
	readonly exampleQueries?: readonly string[];
	readonly onPickExample?: (query: string) => void;
	readonly statusText?: string;
}

function MarkdownContent({ markdown, citations }: { readonly markdown: string; readonly citations: readonly CitationItem[] }) {
	return (
		<div className="answer-markdown">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownComponents(citations)}>
				{markdown}
			</ReactMarkdown>
		</div>
	);
}

function AssistantSkeleton({
	statusText,
	sourceCount,
}: {
	readonly statusText?: string;
	readonly sourceCount: number;
}) {
	return (
		<div className="flex w-full flex-col gap-4 py-2" aria-busy="true" aria-label="Researching">
			<div className="flex flex-col gap-3 rounded-3xl border border-border-subtle/60 bg-surface-elevated/40 px-5 py-5 shadow-panel backdrop-blur-sm md:backdrop-blur-md">
				<div className="flex items-center gap-3">
					<Loader2 className="size-5 animate-spin text-accent" aria-hidden />
					<p className="text-[15px] font-semibold tracking-tight text-content-primary">
						{statusText || "Researching..."}
					</p>
					{sourceCount > 0 ? (
						<div className="ml-auto rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-accent ring-1 ring-accent/20">
							{sourceCount} {sourceCount === 1 ? "source" : "sources"} found
						</div>
					) : null}
				</div>
				<p className="text-sm leading-relaxed text-content-secondary">
					{statusText === "Writing answer..." || statusText === "Preparing answer..."
						? "Writing the answer from retrieved sources."
						: statusText === "Reading sources..."
							? "Reading retrieved sources before writing the answer."
							: "Searching the web for relevant sources."}
				</p>
				<div className="mt-2 flex flex-col gap-3">
					<div className="h-3 w-[92%] animate-pulse rounded-md bg-surface-inset" />
					<div className="h-3 w-[78%] animate-pulse rounded-md bg-surface-inset [animation-delay:120ms]" />
					<div className="h-3 w-[64%] animate-pulse rounded-md bg-surface-inset [animation-delay:240ms]" />
				</div>
			</div>
		</div>
	);
}

export function ConversationMessageList({
	messages,
	streamingUserQuery,
	streamingAssistantMarkdown,
	streamingCitations,
	showAssistantSkeleton = false,
	showEmptyHint = false,
	isAuthed = false,
	recentConversations = [],
	onSelectConversation,
	exampleQueries = [],
	onPickExample,
	statusText,
}: ConversationMessageListProps) {
	const renderAssistant = (msg: {
		readonly content: string;
		readonly citations: unknown;
		readonly streaming: boolean;
	}) => {
		const citations = isCitationArray(msg.citations) ? msg.citations : [];
		const effectiveCitations = msg.streaming ? streamingCitations : citations;
		const citedIndices = parseCitationIndicesFromAnswer(msg.content);
		const linkedContent = linkifyCitations(msg.content, effectiveCitations.length);

		return (
			<div className="flex flex-col gap-5 py-2">
				<div className="rounded-3xl border border-border-subtle/60 bg-surface-elevated/50 px-4 py-4 shadow-panel backdrop-blur-sm sm:px-5 sm:py-5 md:bg-surface-elevated/40 md:backdrop-blur-md">
					<div className="whitespace-pre-wrap text-[16px] leading-8 text-content-secondary">
						<MarkdownContent
							markdown={linkedContent.trim() || (effectiveCitations.length > 0 ? "The model did not generate a text response, but found the following sources." : "No response generated.")}
							citations={effectiveCitations}
						/>
					</div>
				</div>
				{effectiveCitations.length > 0 ? (
					<CitationCards citations={effectiveCitations} citedIndices={citedIndices} />
				) : null}
			</div>
		);
	};

	return (
		<div className="flex flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4">
			{showEmptyHint ? (
				<div className="flex flex-col gap-6 md:gap-8">
					{isAuthed ? (
						<div
							className="flex flex-col gap-4 rounded-3xl border border-border-subtle/70 bg-surface-elevated/45 p-6 shadow-panel backdrop-blur-sm md:p-8 md:backdrop-blur-md"
							role="region"
							aria-label="Recent research"
						>
							<div className="flex items-center gap-3">
								<History className="size-5 text-accent" aria-hidden />
								<div>
									<h2 className="text-base font-semibold text-content-primary">Previous conversations</h2>
									<p className="text-xs text-content-tertiary">Open one only when you want to continue it.</p>
								</div>
							</div>

							{recentConversations.length > 0 ? (
								<ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
									{recentConversations.slice(0, 4).map((c) => (
										<li key={c.id}>
											<button
												type="button"
												onClick={() => onSelectConversation?.(c.id)}
												className={cn(
													"group flex w-full flex-col items-start gap-2 rounded-2xl border border-border-subtle/80 bg-surface-elevated/80 p-4 text-left transition-all duration-200",
													"hover:border-accent/40 hover:bg-accent/5 hover:shadow-float active:scale-[0.98]",
													"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
												)}
											>
												<span className="line-clamp-2 min-h-[2.5rem] w-full text-sm font-medium text-content-primary group-hover:text-accent">
													{c.title}
												</span>
												<div className="mt-1 flex w-full items-center justify-between">
													<div className="flex items-center gap-1.5 text-[11px] text-content-tertiary">
														<Clock className="size-3" aria-hidden />
														{formatLastUpdated(c.lastMessageAt)}
													</div>
													<ArrowRight className="size-3.5 -translate-x-1 text-accent opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
												</div>
											</button>
										</li>
									))}
								</ul>
							) : (
								<div className="flex flex-col items-center justify-center py-6 text-center">
									<div className="rounded-2xl bg-surface-inset/50 p-4 ring-1 ring-border-subtle/50">
										<p className="text-sm font-medium text-content-primary">Your saved research threads will appear here.</p>
										<p className="mt-1 text-xs text-content-tertiary">Threads are automatically saved to your account.</p>
									</div>
								</div>
							)}
						</div>
					) : null}

					<div
						className={cn(
							"flex flex-col items-center justify-center gap-4 rounded-3xl border border-border-subtle bg-surface-elevated/40 px-4 py-8 text-center shadow-glass backdrop-blur-md sm:px-8 md:gap-8 md:py-16",
							isAuthed && "border-none bg-transparent py-4 md:py-4 shadow-none backdrop-blur-none",
						)}
						role="status"
					>
						{!isAuthed && <MessageCircle className="size-10 text-accent/50" aria-hidden />}
						<div className="max-w-lg space-y-2">
							<p className={cn("text-sm font-semibold text-content-primary", isAuthed && "text-left")}>
								{isAuthed ? "Start a new chat with an example" : "Try an example"}
							</p>
							{!isAuthed && (
								<p className="text-sm leading-relaxed text-content-secondary">
									Pick a question to fill the search box, then press{" "}
									<kbd className="rounded-md border border-border-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[11px] text-content-primary">
										Enter
									</kbd>{" "}
									to search.
								</p>
							)}
						</div>
						{exampleQueries.length > 0 && onPickExample ? (
							<ul className={cn("flex w-full max-w-xl flex-col gap-3 sm:max-w-2xl", isAuthed && "max-w-none sm:max-w-none")}>
								{exampleQueries.map((q) => (
									<li key={q} className="w-full">
										<button
											type="button"
											onClick={() => onPickExample(q)}
											className={cn(
												"w-full rounded-2xl border border-border-subtle bg-surface-elevated/90 px-5 py-4 text-left text-sm text-content-primary shadow-sm backdrop-blur-sm transition-all duration-200 md:backdrop-blur-md",
												"hover:border-accent/40 hover:bg-surface-elevated hover:shadow-md hover:translate-y-[-1px] hover:scale-[1.005]",
												"active:scale-[0.99] active:translate-y-0",
												"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
											)}
										>
											{q}
										</button>
									</li>
								))}
							</ul>
						) : null}
						{!isAuthed && <p className="text-xs text-content-tertiary">Press Enter to search</p>}
					</div>
				</div>
			) : null}

			{messages.map((m) => {
				if (m.role === "USER") {
					return (
						<div key={m.id} className="flex w-full justify-end">
							<div
								className={cn(
									"max-w-[80%] rounded-3xl border border-white/60 bg-surface-elevated/85 px-5 py-4 shadow-panel ring-1 ring-border-subtle/50 backdrop-blur-sm md:backdrop-blur-md",
								)}
							>
								<div className="whitespace-pre-wrap text-[16px] leading-relaxed text-content-primary">
									{m.content}
								</div>
							</div>
						</div>
					);
				}

				return (
					<div key={m.id} className="flex w-full justify-start">
						<div className={cn("w-full")}>
							{renderAssistant({ content: m.content, citations: m.citations, streaming: false })}
						</div>
					</div>
				);
			})}

			{streamingUserQuery ? (
				<div className="flex w-full justify-end" aria-label="Streaming user message">
					<div
						className={cn(
							"max-w-[80%] rounded-3xl border border-white/60 bg-surface-elevated/85 px-5 py-4 shadow-panel ring-1 ring-border-subtle/50 backdrop-blur-sm md:backdrop-blur-md",
						)}
					>
						<div className="whitespace-pre-wrap text-[16px] leading-relaxed text-content-primary">
							{streamingUserQuery}
						</div>
					</div>
				</div>
			) : null}

			{streamingAssistantMarkdown ? (
				<div className="flex w-full justify-start" aria-label="Streaming assistant message">
					<div className={cn("w-full")}>
						{renderAssistant({
							content: streamingAssistantMarkdown,
							citations: [],
							streaming: true,
						})}
					</div>
				</div>
			) : null}

			{showAssistantSkeleton ? (
				<div className="flex w-full justify-start" aria-label="Assistant loading">
					<div className={cn("w-full")}>
						<AssistantSkeleton
							statusText={statusText}
							sourceCount={streamingCitations.length}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}

