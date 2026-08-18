"use client";

import { Bot, Brain, Loader2, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CitationCards, type CitationItem } from "../CitationCards";
import { getMarkdownComponents } from "../markdownComponents";
import { linkifyCitations, parseCitationIndicesFromAnswer } from "../../src/services/citations";
import { type ConversationSummary } from "./ConversationSidebar";

export interface ConversationMessageDto {
	readonly id: string;
	readonly role: "USER" | "ASSISTANT";
	readonly content: string;
	readonly parentMessageId: string | null;
	readonly citations: unknown;
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
}

function MarkdownContent({ markdown, citations }: { readonly markdown: string; readonly citations: readonly CitationItem[] }) {
	return (
		<div className="answer-markdown">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownComponents(citations)}>{markdown}</ReactMarkdown>
		</div>
	);
}

function AssistantSkeleton({ statusText, sourceCount }: { readonly statusText?: string; readonly sourceCount: number }) {
	return (
		<div className="aira-enter rounded-3xl border border-border-subtle/70 bg-white/55 px-4 py-4 backdrop-blur" aria-busy="true" aria-label="Researching">
			<div className="flex items-center gap-3 text-sm text-content-secondary">
				<span className="aira-icon-pop flex size-9 items-center justify-center rounded-2xl"><Loader2 className="size-4 animate-spin" aria-hidden /></span>
				<div>
					<p className="font-semibold text-content-primary">{statusText || "Aira is thinking…"}</p>
					<p className="mt-0.5 text-xs text-content-tertiary">{sourceCount > 0 ? `${sourceCount} sources found · checking the evidence` : "Searching, comparing, and preparing a grounded answer"}</p>
				</div>
			</div>
			<div className="mt-5 space-y-3 pl-12">
				<div className="h-2.5 w-[92%] animate-pulse rounded-full bg-surface-inset" />
				<div className="h-2.5 w-[78%] animate-pulse rounded-full bg-surface-inset" />
				<div className="h-2.5 w-[64%] animate-pulse rounded-full bg-surface-inset" />
			</div>
		</div>
	);
}

const CAPABILITIES = [
	{ icon: Brain, title: "Remembers context", body: "Useful preferences and project details can carry into a fresh chat.", tone: "from-blue-500/10 to-cyan-400/5" },
	{ icon: ShieldCheck, title: "Shows its receipts", body: "Research answers stay connected to the evidence Aira retrieved.", tone: "from-emerald-500/10 to-cyan-400/5" },
	{ icon: Bot, title: "Can take the task", body: "Delegate autonomous work when your plan and agent runtime allow it.", tone: "from-violet-500/10 to-fuchsia-400/5" },
] as const;

export function ConversationMessageList({
	messages,
	streamingUserQuery,
	streamingAssistantMarkdown,
	streamingCitations,
	showAssistantSkeleton = false,
	showEmptyHint = false,
	isAuthed = false,
	exampleQueries = [],
	onPickExample,
	statusText,
}: ConversationMessageListProps) {
	const renderAssistant = (message: { readonly content: string; readonly citations: unknown; readonly streaming: boolean }) => {
		const citations = isCitationArray(message.citations) ? message.citations : [];
		const effectiveCitations = message.streaming ? streamingCitations : citations;
		const citedIndices = parseCitationIndicesFromAnswer(message.content);
		const linkedContent = linkifyCitations(message.content, effectiveCitations.length);
		return (
			<div className="aira-enter py-3">
				<div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-content-tertiary">
					<span className="relative flex size-7 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))] text-white shadow-sm"><span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.45),transparent_42%)]" aria-hidden /><Sparkles className="aira-sparkle relative size-3.5" aria-hidden /></span>
					Aira
				</div>
				<div className="pl-0 sm:pl-9">
					<div className="whitespace-pre-wrap text-[16px] leading-8 text-content-secondary">
						<MarkdownContent markdown={linkedContent.trim() || (effectiveCitations.length > 0 ? "Aira found sources but did not generate a text response." : "No response generated.")} citations={effectiveCitations} />
					</div>
					{effectiveCitations.length > 0 ? <div className="mt-6"><CitationCards citations={effectiveCitations} citedIndices={citedIndices} /></div> : null}
				</div>
			</div>
		);
	};

	return (
		<div className="flex flex-col gap-4 px-2 py-2 sm:px-3 sm:py-3">
			{showEmptyHint ? (
				<div className="aira-enter space-y-7 py-2 md:py-5">
					{exampleQueries.length > 0 && onPickExample ? (
						<section aria-label="Suggested tasks">
							<p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.13em] text-content-tertiary">Try something</p>
							<div className="flex flex-wrap justify-center gap-2.5">
								{exampleQueries.map((query) => (
									<button key={query} type="button" onClick={() => onPickExample(query)} className="aira-chip inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-content-secondary">
										<span className="size-1.5 rounded-full bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))]" aria-hidden />{query}
									</button>
								))}
							</div>
						</section>
					) : null}

					{isAuthed ? (
						<section className="grid gap-3 md:grid-cols-3" aria-label="AiraAI capabilities">
							{CAPABILITIES.map((item) => {
								const Icon = item.icon;
								return (
									<div key={item.title} className={`aira-premium-card aira-card-hover relative overflow-hidden rounded-2xl bg-gradient-to-br ${item.tone} p-4 text-left`}>
										<span className="aira-icon-pop flex size-9 items-center justify-center rounded-xl"><Icon className="size-4.5" aria-hidden /></span>
										<h2 className="mt-4 text-sm font-semibold text-content-primary">{item.title}</h2>
										<p className="mt-1.5 text-xs leading-5 text-content-tertiary">{item.body}</p>
									</div>
								);
							})}
						</section>
					) : (
						<div className="flex justify-center text-center"><div className="aira-premium-card max-w-md rounded-2xl p-5"><span className="aira-icon-pop mx-auto flex size-10 items-center justify-center rounded-2xl"><MessageCircle className="size-4.5" /></span><p className="mt-3 text-sm font-medium text-content-primary">Search without an account</p><p className="mt-1 text-xs leading-5 text-content-tertiary">Sign in when you want saved threads, memory, Deep Research, and sharing.</p></div></div>
					)}
				</div>
			) : null}

			{messages.map((message) => message.role === "USER" ? (
				<div key={message.id} className="aira-enter flex w-full justify-end py-2">
					<div className="max-w-[88%] rounded-[20px] border border-border-subtle/70 bg-white/78 px-4 py-3 text-[15px] leading-7 text-content-primary shadow-sm sm:max-w-[78%]">{message.content}</div>
				</div>
			) : (
				<div key={message.id} className="w-full">{renderAssistant({ content: message.content, citations: message.citations, streaming: false })}</div>
			))}

			{streamingUserQuery ? <div className="flex w-full justify-end py-2" aria-label="Streaming user message"><div className="max-w-[88%] rounded-[20px] border border-border-subtle/70 bg-white/78 px-4 py-3 text-[15px] leading-7 text-content-primary shadow-sm sm:max-w-[78%]">{streamingUserQuery}</div></div> : null}
			{streamingAssistantMarkdown ? <div className="w-full" aria-label="Streaming assistant message">{renderAssistant({ content: streamingAssistantMarkdown, citations: [], streaming: true })}</div> : null}
			{showAssistantSkeleton ? <AssistantSkeleton statusText={statusText} sourceCount={streamingCitations.length} /> : null}
		</div>
	);
}
