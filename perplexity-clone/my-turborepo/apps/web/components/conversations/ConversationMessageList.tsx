"use client";

import { Check, Copy, Cpu, FileText, Globe2, Sparkles, WandSparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
			className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] text-content-tertiary transition hover:bg-surface-elevated hover:text-content-primary"
			aria-label={`${label} message`}
		>
			{copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" strokeWidth={1.7} aria-hidden />}
			{copied ? "Copied" : label}
		</button>
	);
}

function AssistantSkeleton({ statusText, sourceCount }: { readonly statusText?: string; readonly sourceCount: number }) {
	return (
		<div className="flex gap-3 py-5" aria-busy="true" aria-label="Researching">
			<div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated text-[11px] font-semibold text-content-primary">A</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="text-[12px] font-medium text-content-primary">{statusText || "Researching…"}</p>
					<span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
				</div>
				<p className="mt-1 text-[11px] text-content-tertiary">{sourceCount > 0 ? `${sourceCount} sources found · verifying answer` : "Searching and comparing relevant sources"}</p>
				<div className="mt-4 space-y-2.5"><div className="h-2 w-[88%] animate-pulse rounded bg-surface-elevated" /><div className="h-2 w-[72%] animate-pulse rounded bg-surface-elevated" /><div className="h-2 w-[58%] animate-pulse rounded bg-surface-elevated" /></div>
			</div>
		</div>
	);
}

const STARTERS = [
	{ href: "/knowledge", title: "Work with files", description: "Upload PDFs and documents, then ask with context.", icon: FileText },
	{ href: "/agents", title: "Delegate a task", description: "Run a longer autonomous workflow with an agent.", icon: WandSparkles },
	{ href: "/local-ai", title: "Use Local AI", description: "Keep routine private work on your llama.cpp worker.", icon: Cpu },
] as const;

export function ConversationMessageList({ messages, streamingUserQuery, streamingAssistantMarkdown, streamingCitations, showAssistantSkeleton = false, showEmptyHint = false, exampleQueries = [], onPickExample, statusText }: ConversationMessageListProps) {
	const renderAssistant = (message: { readonly content: string; readonly citations: unknown; readonly streaming: boolean }) => {
		const citations = isCitationArray(message.citations) ? message.citations : [];
		const effectiveCitations = message.streaming ? streamingCitations : citations;
		const citedIndices = parseCitationIndicesFromAnswer(message.content);
		const linkedContent = linkifyCitations(message.content, effectiveCitations.length);
		const finalText = linkedContent.trim() || (effectiveCitations.length > 0 ? "AIRA found sources but did not generate a text response." : "No response generated.");
		return (
			<div className="aira-enter group flex gap-3 py-5">
				<div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated text-[11px] font-semibold text-content-primary">A</div>
				<div className="min-w-0 flex-1">
					<div className="mb-2 flex min-h-7 items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-2">
							<p className="text-[12px] font-medium text-content-primary">AIRA AI</p>
							{effectiveCitations.length > 0 ? (
								<span className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-[9px] text-content-tertiary">
									<Globe2 className="size-2.5" aria-hidden /> {effectiveCitations.length} sources
								</span>
							) : null}
						</div>
						{!message.streaming && message.content ? <div className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"><MessageCopyButton text={message.content} /></div> : null}
					</div>
					<div className="whitespace-pre-wrap text-[14px] leading-7 text-content-secondary"><MarkdownContent markdown={finalText} citations={effectiveCitations} /></div>
					{effectiveCitations.length > 0 ? <div className="mt-5"><CitationCards citations={effectiveCitations} citedIndices={citedIndices} /></div> : null}
					{!message.streaming && message.content ? (
						<div className="mt-3 flex items-center gap-1 border-t border-border-subtle/60 pt-2 sm:hidden">
							<MessageCopyButton text={message.content} />
						</div>
					) : null}
				</div>
			</div>
		);
	};

	return (
		<div className="mx-auto flex w-full max-w-[820px] flex-col px-4 py-4 sm:px-6">
			{showEmptyHint ? (
				<div className="aira-enter py-5 sm:py-7">
					<div className="mx-auto flex max-w-xl flex-col items-center text-center">
						<div className="mx-auto flex size-9 items-center justify-center text-content-primary"><Sparkles className="size-6" strokeWidth={1.6} aria-hidden /></div>
						<h2 className="mt-4 text-2xl font-medium tracking-[-0.035em] text-content-primary">What are you working on?</h2>
						<p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-content-tertiary">Ask a question, investigate the web, work with private files, compare models, or hand off a longer task.</p>
					</div>
					{exampleQueries.length > 0 && onPickExample ? (
						<div className="mx-auto mt-6 grid max-w-2xl gap-2 sm:grid-cols-3">
							{exampleQueries.map((item) => (
								<button key={item} type="button" onClick={() => onPickExample(item)} className="min-h-16 rounded-xl border border-border-subtle bg-transparent px-3 py-3 text-left text-[11px] leading-5 text-content-secondary transition hover:border-border hover:bg-surface-elevated hover:text-content-primary">
									<span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.1em] text-content-tertiary">Ask AIRA</span>
									{item}
								</button>
							))}
						</div>
					) : null}
					<div className="mx-auto mt-3 grid max-w-2xl gap-1 sm:grid-cols-3">
						{STARTERS.map((item) => {
							const Icon = item.icon;
							return (
								<Link key={item.href} href={item.href} className="group flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-elevated">
									<Icon className="mt-0.5 size-3.5 shrink-0 text-content-tertiary transition group-hover:text-accent" strokeWidth={1.7} aria-hidden />
									<span><strong className="block text-[11px] font-medium text-content-secondary group-hover:text-content-primary">{item.title}</strong><small className="mt-0.5 block text-[9px] leading-4 text-content-tertiary">{item.description}</small></span>
								</Link>
							);
						})}
					</div>
				</div>
			) : null}

			{messages.map((message) => message.role === "USER" ? (
				<div key={message.id} className="aira-enter group flex w-full justify-end py-3">
					<div className="max-w-[86%] sm:max-w-[78%]">
						<div className="rounded-[14px] bg-surface-elevated px-4 py-2.5 text-[14px] leading-6 text-content-primary">{message.content}</div>
						<div className="mt-1 flex justify-end opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"><MessageCopyButton text={message.content} /></div>
					</div>
				</div>
			) : <div key={message.id}>{renderAssistant({ content: message.content, citations: message.citations, streaming: false })}</div>)}

			{streamingUserQuery ? <div className="flex w-full justify-end py-3" aria-label="Streaming user message"><div className="max-w-[86%] rounded-[14px] bg-surface-elevated px-4 py-2.5 text-[14px] leading-6 text-content-primary sm:max-w-[78%]">{streamingUserQuery}</div></div> : null}
			{streamingAssistantMarkdown ? <div aria-label="Streaming assistant message">{renderAssistant({ content: streamingAssistantMarkdown, citations: [], streaming: true })}</div> : null}
			{showAssistantSkeleton ? <AssistantSkeleton statusText={statusText} sourceCount={streamingCitations.length} /> : null}
		</div>
	);
}