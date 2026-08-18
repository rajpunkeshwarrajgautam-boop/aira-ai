"use client";

import { Bot, Brain, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
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
		<div className="aira-enter rounded-3xl border border-border-subtle/70 bg-white/45 px-4 py-5 backdrop-blur-sm" aria-busy="true" aria-label="Researching">
			<div className="flex items-center gap-3 text-sm text-content-secondary">
				<span className="aira-orbit-loader shrink-0" aria-hidden />
				<div>
					<p className="font-semibold text-content-primary">{statusText || "Researching…"}</p>
					<p className="mt-0.5 text-xs text-content-tertiary">{sourceCount > 0 ? `${sourceCount} sources found · preparing a grounded answer` : "Searching, checking, and comparing relevant sources"}</p>
				</div>
			</div>
			<div className="mt-5 space-y-3 pl-[46px]">
				<div className="h-2.5 w-[92%] overflow-hidden rounded-full bg-surface-inset"><div className="h-full w-2/5 animate-pulse rounded-full bg-gradient-to-r from-accent/20 via-violet-400/25 to-cyan-400/20" /></div>
				<div className="h-2.5 w-[78%] overflow-hidden rounded-full bg-surface-inset"><div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-accent/15 via-violet-400/20 to-cyan-400/15" /></div>
				<div className="h-2.5 w-[64%] overflow-hidden rounded-full bg-surface-inset"><div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-accent/10 via-violet-400/20 to-cyan-400/15" /></div>
			</div>
		</div>
	);
}

const CAPABILITIES = [
	{ icon: Brain, title: "Persistent memory", body: "Useful preferences and project context can carry into a fresh chat." },
	{ icon: ShieldCheck, title: "Grounded citations", body: "Research answers stay connected to the evidence Aira retrieved." },
	{ icon: Bot, title: "Agent workspace", body: "Delegate autonomous tasks when your plan and agent runtime allow it." },
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
					<span className="flex size-7 items-center justify-center rounded-xl bg-gradient-to-br from-accent/15 to-violet-500/10 text-accent ring-1 ring-accent/10"><Sparkles className="size-3.5" aria-hidden /></span>
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
							<p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.13em] text-content-tertiary">Start with a capability</p>
							<div className="flex flex-wrap justify-center gap-2.5">
								{exampleQueries.map((query) => (
									<button key={query} type="button" onClick={() => onPickExample(query)} className="aira-provider-button rounded-full border border-border-subtle bg-white/85 px-4 py-2 text-sm font-medium text-content-secondary shadow-sm backdrop-blur hover:text-content-primary">
										{query}
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
									<div key={item.title} className="aira-card aira-fun-card rounded-2xl p-4 text-left">
										<span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent/[0.12] to-violet-500/[0.08] text-accent ring-1 ring-accent/10"><Icon className="size-4.5" aria-hidden /></span>
										<h2 className="mt-4 text-sm font-semibold text-content-primary">{item.title}</h2>
										<p className="mt-1.5 text-xs leading-5 text-content-tertiary">{item.body}</p>
									</div>
								);
							})}
						</section>
					) : (
						<div className="flex justify-center text-center"><div className="aira-glass max-w-md rounded-2xl p-5"><MessageCircle className="mx-auto size-6 text-accent" /><p className="mt-3 text-sm font-medium text-content-primary">Search without an account</p><p className="mt-1 text-xs leading-5 text-content-tertiary">Sign in when you want saved threads, memory, Deep Research, and sharing.</p></div></div>
					)}
				</div>
			) : null}

			{messages.map((message) => message.role === "USER" ? (
				<div key={message.id} className="aira-enter flex w-full justify-end py-2">
					<div className="max-w-[88%] rounded-[20px] bg-gradient-to-br from-surface-inset to-white px-4 py-3 text-[15px] leading-7 text-content-primary shadow-sm ring-1 ring-border-subtle/70 sm:max-w-[78%]">{message.content}</div>
				</div>
			) : (
				<div key={message.id} className="w-full">{renderAssistant({ content: message.content, citations: message.citations, streaming: false })}</div>
			))}

			{streamingUserQuery ? <div className="flex w-full justify-end py-2" aria-label="Streaming user message"><div className="max-w-[88%] rounded-[20px] bg-gradient-to-br from-surface-inset to-white px-4 py-3 text-[15px] leading-7 text-content-primary shadow-sm ring-1 ring-border-subtle/70 sm:max-w-[78%]">{streamingUserQuery}</div></div> : null}
			{streamingAssistantMarkdown ? <div className="w-full" aria-label="Streaming assistant message">{renderAssistant({ content: streamingAssistantMarkdown, citations: [], streaming: true })}</div> : null}
			{showAssistantSkeleton ? <AssistantSkeleton statusText={statusText} sourceCount={streamingCitations.length} /> : null}
		</div>
	);
}
