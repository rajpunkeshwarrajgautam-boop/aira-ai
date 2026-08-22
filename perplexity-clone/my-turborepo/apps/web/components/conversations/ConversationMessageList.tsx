"use client";

import {
	Check,
	Copy,
	ExternalLink,
	FileDown,
	FileText,
	GitCompareArrows,
	Globe2,
	History,
	MessageSquarePlus,
	Network,
	PencilLine,
	Share2,
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
		<div className="flex gap-3 py-5" aria-busy="true" aria-label="Researching">
			<div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/10 text-[11px] font-semibold text-violet-200">A</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2"><p className="text-[12px] font-medium text-content-primary">{statusText || "Researching…"}</p><span className="size-1.5 animate-pulse rounded-full bg-violet-400" aria-hidden /></div>
				<p className="mt-1 text-[11px] text-content-tertiary">{sourceCount > 0 ? `${sourceCount} sources found · verifying answer` : "Searching, reading, and comparing relevant sources"}</p>
				<div className="mt-4 space-y-2.5"><div className="h-2 w-[88%] animate-pulse rounded bg-white/[0.055]" /><div className="h-2 w-[72%] animate-pulse rounded bg-white/[0.055]" /><div className="h-2 w-[58%] animate-pulse rounded bg-white/[0.055]" /></div>
			</div>
		</div>
	);
}

const STARTERS = [
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

export function ConversationMessageList({ messages, streamingUserQuery, streamingAssistantMarkdown, streamingCitations, showAssistantSkeleton = false, showEmptyHint = false, exampleQueries = [], onPickExample, statusText }: ConversationMessageListProps) {
	const [shareFeedback, setShareFeedback] = useState<string | null>(null);
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

	const renderAssistant = (message: { readonly content: string; readonly citations: unknown; readonly streaming: boolean }) => {
		const citations = isCitationArray(message.citations) ? message.citations : [];
		const effectiveCitations = message.streaming ? streamingCitations : citations;
		const citedIndices = parseCitationIndicesFromAnswer(message.content);
		const linkedContent = linkifyCitations(message.content, effectiveCitations.length);
		const finalText = linkedContent.trim() || (effectiveCitations.length > 0 ? "AIRA found sources but did not generate a text response." : "No response generated.");
		return (
			<div className="aira-enter group flex gap-3 py-5">
				<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-violet-400/35 bg-violet-500/10 text-[11px] font-semibold text-violet-200">A</div>
				<div className="min-w-0 flex-1 rounded-2xl border border-white/[0.07] bg-[#111827]/72 px-5 py-4 shadow-[0_12px_40px_rgba(0,0,0,.16)]">
					<div className="mb-2 flex min-h-7 items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-2"><p className="text-[12px] font-medium text-content-primary">AIRA AI</p>{effectiveCitations.length > 0 ? <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/15 bg-violet-500/[0.07] px-2 py-0.5 text-[9px] text-violet-200"><Globe2 className="size-2.5" aria-hidden /> {effectiveCitations.length} sources</span> : null}</div>
						{!message.streaming && message.content ? <div className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"><MessageCopyButton text={message.content} /></div> : null}
					</div>
					<div className="whitespace-pre-wrap text-[14px] leading-7 text-content-secondary"><MarkdownContent markdown={finalText} citations={effectiveCitations} /></div>
					{effectiveCitations.length > 0 ? <div className="mt-5 border-t border-white/[0.06] pt-4"><CitationCards citations={effectiveCitations} citedIndices={citedIndices} /></div> : null}
				</div>
			</div>
		);
	};

	return (
		<div className="aira-thread-layout w-full">
			<div className="aira-thread-toolbar sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-white/[0.07] bg-[#0b1020]/92 px-4 backdrop-blur-xl sm:px-5">
				<div className="min-w-0"><h2 className="truncate text-[13px] font-semibold text-content-primary">{title}</h2><p className="mt-0.5 text-[9px] text-content-tertiary">AIRA workspace</p></div>
				<div className="hidden items-center rounded-xl border border-white/[0.08] bg-[#0d1322] p-1 sm:flex" aria-label="Research tools">
					<span className="rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-1.5 text-[10px] font-semibold text-white shadow-sm" title="AIRA standard research">AIRA</span>
					<button type="button" onClick={() => emitComposerCommand("/deep ")} className="rounded-lg px-4 py-1.5 text-[10px] font-medium text-content-tertiary transition hover:text-content-primary" title="Prepare a Deep Research query">Web</button>
				</div>
				<div className="flex items-center gap-1.5">
					<Link href="/workspace-search" className="grid size-8 place-items-center rounded-lg text-content-tertiary transition hover:bg-white/[0.05] hover:text-content-primary" aria-label="Search conversation history"><History className="size-4" strokeWidth={1.6} /></Link>
					<button type="button" onClick={() => void shareConversation()} disabled={!shareableText.trim()} className="grid size-8 place-items-center rounded-lg text-content-tertiary transition hover:bg-white/[0.05] hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-35" aria-label="Share conversation"><Share2 className="size-4" strokeWidth={1.6} /></button>
					<Link href="/compare" className="ml-1 hidden h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#111827] px-3 text-[10px] font-medium text-content-secondary transition hover:border-violet-400/25 hover:text-content-primary md:flex" title="Open Model Compare"><span className="size-1.5 rounded-full bg-emerald-400" />AIRA Auto<GitCompareArrows className="size-3.5" strokeWidth={1.6} /></Link>
				</div>
				{shareFeedback ? <span className="sr-only" role="status" aria-live="polite">{shareFeedback}</span> : null}
			</div>

			<div className="aira-thread-columns grid min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px]">
				<section className="min-w-0 px-4 py-4 sm:px-6" aria-label="Conversation messages">
					<div className="mx-auto max-w-[760px]">
						{showEmptyHint ? (
							<div className="aira-enter py-8 sm:py-12">
								<div className="mx-auto flex max-w-xl flex-col items-center text-center"><div className="mx-auto flex size-10 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-500/10 text-violet-200"><Sparkles className="size-5" strokeWidth={1.6} aria-hidden /></div><h2 className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-content-primary">What are you working on?</h2><p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-content-tertiary">Research the web, work with private files, compare models, or hand a longer workflow to an agent.</p></div>
								{exampleQueries.length > 0 && onPickExample ? <div className="mx-auto mt-7 grid max-w-2xl gap-2 sm:grid-cols-3">{exampleQueries.map((item) => <button key={item} type="button" onClick={() => onPickExample(item)} className="min-h-20 rounded-xl border border-white/[0.08] bg-[#101727]/75 px-3 py-3 text-left text-[11px] leading-5 text-content-secondary transition hover:border-violet-400/25 hover:bg-[#141c30] hover:text-content-primary"><span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.1em] text-violet-300/70">Ask AIRA</span>{item}</button>)}</div> : null}
								<div className="mx-auto mt-3 grid max-w-2xl gap-1 sm:grid-cols-3">{STARTERS.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className="group flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.035]"><Icon className="mt-0.5 size-3.5 shrink-0 text-content-tertiary transition group-hover:text-violet-300" strokeWidth={1.7} aria-hidden /><span><strong className="block text-[11px] font-medium text-content-secondary group-hover:text-content-primary">{item.title}</strong><small className="mt-0.5 block text-[9px] leading-4 text-content-tertiary">{item.description}</small></span></Link>; })}</div>
							</div>
						) : null}

						{messages.map((message) => message.role === "USER" ? (
							<div key={message.id} className="aira-enter group flex w-full justify-end py-3"><div className="max-w-[86%] sm:max-w-[78%]"><div className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-600/35 to-indigo-600/25 px-4 py-3 text-[14px] leading-6 text-violet-50 shadow-[0_10px_28px_rgba(31,28,80,.18)]">{message.content}</div><div className="mt-1 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"><ReusePromptButton text={message.content} /><MessageCopyButton text={message.content} /></div></div></div>
						) : <div key={message.id}>{renderAssistant({ content: message.content, citations: message.citations, streaming: false })}</div>)}

						{streamingUserQuery ? <div className="flex w-full justify-end py-3" aria-label="Streaming user message"><div className="max-w-[86%] rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-600/35 to-indigo-600/25 px-4 py-3 text-[14px] leading-6 text-violet-50 sm:max-w-[78%]">{streamingUserQuery}</div></div> : null}
						{streamingAssistantMarkdown ? <div aria-label="Streaming assistant message">{renderAssistant({ content: streamingAssistantMarkdown, citations: [], streaming: true })}</div> : null}
						{showAssistantSkeleton ? <AssistantSkeleton statusText={statusText} sourceCount={streamingCitations.length} /> : null}
					</div>
				</section>

				<aside className="aira-live-inspector hidden border-l border-white/[0.07] bg-[#0d1320]/72 p-3 xl:block" aria-label="Conversation inspector">
					<div className="sticky top-20 space-y-3">
						<section className="rounded-2xl border border-white/[0.08] bg-[#111827]/80 p-3"><p className="text-[11px] font-semibold text-content-primary">Model</p><Link href="/omniroute" className="mt-2 flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#0d1423] px-3 py-2.5 transition hover:border-violet-400/25"><span><strong className="block text-[11px] font-semibold text-content-primary">AIRA Auto</strong><small className="mt-0.5 block text-[9px] text-content-tertiary">OmniRoute + AIRA policy</small></span><Network className="size-4 text-violet-300" strokeWidth={1.6} /></Link></section>

						<section className="rounded-2xl border border-white/[0.08] bg-[#111827]/80 p-3"><div className="flex items-center justify-between"><p className="text-[11px] font-semibold text-content-primary">Sources</p><span className="text-[9px] text-content-tertiary">{inspectorCitations.length || 0}</span></div><div className="mt-2 space-y-1">{inspectorCitations.length === 0 ? <p className="rounded-lg border border-dashed border-white/[0.07] px-2.5 py-3 text-[9px] leading-4 text-content-tertiary">Sources appear here when AIRA grounds an answer on the web.</p> : inspectorCitations.slice(0, 6).map((citation) => <a key={`${citation.index}-${citation.url}`} href={citation.url} target="_blank" rel="noreferrer" className="group flex gap-2 rounded-lg px-2 py-2 transition hover:bg-white/[0.04]"><span className="w-4 shrink-0 text-[9px] text-content-tertiary">{citation.index}</span><span className="min-w-0 flex-1"><strong className="block truncate text-[9px] font-medium text-content-secondary group-hover:text-content-primary">{citation.title}</strong><small className="mt-0.5 flex items-center gap-1 truncate text-[8px] text-content-tertiary">{hostnameFromUrl(citation.url)}<ExternalLink className="size-2.5" /></small></span></a>)}</div></section>

						<section className="rounded-2xl border border-white/[0.08] bg-[#111827]/80 p-3"><p className="text-[11px] font-semibold text-content-primary">Conversation Info</p><dl className="mt-2 space-y-2 text-[9px]"><div className="flex items-center justify-between gap-3"><dt className="text-content-tertiary">Created</dt><dd className="truncate text-content-secondary">{createdAt && !Number.isNaN(createdAt.getTime()) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(createdAt) : "New thread"}</dd></div><div className="flex items-center justify-between"><dt className="text-content-tertiary">Messages</dt><dd className="tabular-nums text-content-secondary">{messages.length}</dd></div><div className="flex items-center justify-between"><dt className="text-content-tertiary">Sources</dt><dd className="tabular-nums text-content-secondary">{inspectorCitations.length}</dd></div><div className="flex items-center justify-between"><dt className="text-content-tertiary">Status</dt><dd className="inline-flex items-center gap-1 text-content-secondary"><span className="size-1.5 rounded-full bg-emerald-400" />Active</dd></div></dl></section>

						<section className="rounded-2xl border border-white/[0.08] bg-[#111827]/80 p-3"><p className="text-[11px] font-semibold text-content-primary">Actions</p><div className="mt-2 space-y-0.5"><button type="button" disabled={!copyAll} onClick={() => void navigator.clipboard.writeText(copyAll)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[9px] text-content-secondary transition hover:bg-white/[0.04] hover:text-content-primary disabled:opacity-40"><Copy className="size-3.5" strokeWidth={1.6} />Copy conversation</button><button type="button" disabled={!shareableText.trim()} onClick={() => void shareConversation()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[9px] text-content-secondary transition hover:bg-white/[0.04] hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-40"><Share2 className="size-3.5" strokeWidth={1.6} />Share conversation</button><button type="button" onClick={() => window.print()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[9px] text-content-secondary transition hover:bg-white/[0.04] hover:text-content-primary"><FileDown className="size-3.5" strokeWidth={1.6} />Print / save as PDF</button><button type="button" onClick={() => emitComposerCommand("/new")} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[9px] text-content-secondary transition hover:bg-white/[0.04] hover:text-content-primary"><MessageSquarePlus className="size-3.5" strokeWidth={1.6} />New conversation</button></div>{shareFeedback ? <p className="mt-2 rounded-lg bg-white/[0.035] px-2 py-1.5 text-[9px] text-content-tertiary" role="status">{shareFeedback}</p> : null}</section>
					</div>
				</aside>
			</div>
		</div>
	);
}
