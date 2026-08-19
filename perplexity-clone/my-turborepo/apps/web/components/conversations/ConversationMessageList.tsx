"use client";

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
	return <div className="answer-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownComponents(citations)}>{markdown}</ReactMarkdown></div>;
}

function AssistantSkeleton({ statusText, sourceCount }: { readonly statusText?: string; readonly sourceCount: number }) {
	return (
		<div className="flex gap-3 py-5" aria-busy="true" aria-label="Researching">
			<div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated text-[11px] font-semibold text-content-primary">A</div>
			<div className="min-w-0 flex-1">
				<p className="text-[12px] font-medium text-content-primary">{statusText || "Researching…"}</p>
				<p className="mt-1 text-[11px] text-content-tertiary">{sourceCount > 0 ? `${sourceCount} sources found · verifying answer` : "Searching and comparing relevant sources"}</p>
				<div className="mt-4 space-y-2.5"><div className="h-2 w-[88%] animate-pulse rounded bg-surface-elevated" /><div className="h-2 w-[72%] animate-pulse rounded bg-surface-elevated" /><div className="h-2 w-[58%] animate-pulse rounded bg-surface-elevated" /></div>
			</div>
		</div>
	);
}

export function ConversationMessageList({ messages, streamingUserQuery, streamingAssistantMarkdown, streamingCitations, showAssistantSkeleton = false, showEmptyHint = false, exampleQueries = [], onPickExample, statusText }: ConversationMessageListProps) {
	const renderAssistant = (message: { readonly content: string; readonly citations: unknown; readonly streaming: boolean }) => {
		const citations = isCitationArray(message.citations) ? message.citations : [];
		const effectiveCitations = message.streaming ? streamingCitations : citations;
		const citedIndices = parseCitationIndicesFromAnswer(message.content);
		const linkedContent = linkifyCitations(message.content, effectiveCitations.length);
		return (
			<div className="aira-enter flex gap-3 py-5">
				<div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated text-[11px] font-semibold text-content-primary">A</div>
				<div className="min-w-0 flex-1">
					<p className="mb-2 text-[12px] font-medium text-content-primary">AIRA AI</p>
					<div className="whitespace-pre-wrap text-[14px] leading-7 text-content-secondary"><MarkdownContent markdown={linkedContent.trim() || (effectiveCitations.length > 0 ? "AIRA found sources but did not generate a text response." : "No response generated.")} citations={effectiveCitations} /></div>
					{effectiveCitations.length > 0 ? <div className="mt-5"><CitationCards citations={effectiveCitations} citedIndices={citedIndices} /></div> : null}
				</div>
			</div>
		);
	};

	return (
		<div className="mx-auto flex w-full max-w-[820px] flex-col px-4 py-4 sm:px-6">
			{showEmptyHint ? (
				<div className="aira-enter py-6 text-center">
					<div className="mx-auto flex size-10 items-center justify-center text-content-primary"><svg viewBox="0 0 100 100" className="size-9" fill="none"><path d="M20 80 50 20 80 80M30 60h40" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" /></svg></div>
					<h2 className="mt-4 text-xl font-medium tracking-[-0.025em] text-content-primary">How can AIRA help?</h2>
					<p className="mx-auto mt-2 max-w-md text-xs leading-5 text-content-tertiary">Research, compare, reason, build, and make decisions with grounded evidence.</p>
					{exampleQueries.length > 0 && onPickExample ? <div className="mt-5 flex flex-wrap justify-center gap-2">{exampleQueries.map((item) => <button key={item} type="button" onClick={() => onPickExample(item)} className="rounded-lg border border-border-subtle bg-transparent px-3 py-2 text-[11px] text-content-secondary transition hover:bg-surface-elevated hover:text-content-primary">{item}</button>)}</div> : null}
				</div>
			) : null}

			{messages.map((message) => message.role === "USER" ? (
				<div key={message.id} className="aira-enter flex w-full justify-end py-3"><div className="max-w-[82%] rounded-lg bg-surface-elevated px-4 py-2.5 text-[14px] leading-6 text-content-primary">{message.content}</div></div>
			) : <div key={message.id}>{renderAssistant({ content: message.content, citations: message.citations, streaming: false })}</div>)}

			{streamingUserQuery ? <div className="flex w-full justify-end py-3" aria-label="Streaming user message"><div className="max-w-[82%] rounded-lg bg-surface-elevated px-4 py-2.5 text-[14px] leading-6 text-content-primary">{streamingUserQuery}</div></div> : null}
			{streamingAssistantMarkdown ? <div aria-label="Streaming assistant message">{renderAssistant({ content: streamingAssistantMarkdown, citations: [], streaming: true })}</div> : null}
			{showAssistantSkeleton ? <AssistantSkeleton statusText={statusText} sourceCount={streamingCitations.length} /> : null}
		</div>
	);
}
