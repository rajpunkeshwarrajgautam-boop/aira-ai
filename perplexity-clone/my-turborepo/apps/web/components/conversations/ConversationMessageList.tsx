"use client";

import {
	Check,
	Copy,
	Cpu,
	ExternalLink,
	FileDown,
	FileText,
	GitCompareArrows,
	Globe2,
	History,
	MessageSquarePlus,
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
import styles from "./ConversationMessageList.module.css";

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
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownComponents(citations)}>
				{markdown}
			</ReactMarkdown>
		</div>
	);
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
			className={styles.actionButton}
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
			className={styles.actionButton}
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

function AssistantSkeleton({ sourceCount }: { readonly sourceCount: number }) {
	return (
		<div className={styles.skeleton} aria-busy="true" aria-label="AIRA is working on the request">
			<div className={styles.assistantAvatar}>A</div>
			<div className={styles.skeletonBody}>
				<div className={styles.skeletonTitle}>
					<span>{sourceCount > 0 ? "Sources available" : "Working on your request…"}</span>
					<span className={styles.pulseDot} aria-hidden />
				</div>
				<p>{sourceCount > 0 ? `${sourceCount} ${sourceCount === 1 ? "source" : "sources"} available · AIRA is generating the response.` : "AIRA is processing the request."}</p>
				<div className={styles.skeletonLines} aria-hidden>
					<div className={styles.skeletonLine} style={{ width: "88%" }} />
					<div className={styles.skeletonLine} style={{ width: "72%" }} />
					<div className={styles.skeletonLine} style={{ width: "58%" }} />
				</div>
				<span className="sr-only" role="status" aria-live="polite">
					{sourceCount > 0 ? `${sourceCount} ${sourceCount === 1 ? "source is" : "sources are"} available. AIRA is generating the response.` : "AIRA is working on the request."}
				</span>
			</div>
		</div>
	);
}

const STARTERS = [
	{ href: "/knowledge", title: "Work with files", description: "Upload documents and use them as context.", icon: FileText },
	{ href: "/agents", title: "Delegate a task", description: "Assign longer work to an autonomous agent.", icon: WandSparkles },
	{ href: "/local-ai", title: "Use Local AI", description: "Open the configured private local runtime.", icon: Cpu },
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
}: ConversationMessageListProps) {
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
			<div className={styles.assistantRow}>
				<div className={styles.assistantAvatar}>A</div>
				<div className={styles.assistantBody}>
					<div className={styles.assistantHeader}>
						<div className={styles.assistantIdentity}>
							<strong>AIRA AI</strong>
							{effectiveCitations.length > 0 ? (
								<span className={styles.sourceCount}>
									<Globe2 className="size-2.5" aria-hidden /> {effectiveCitations.length} sources
								</span>
							) : null}
						</div>
						{!message.streaming && message.content ? (
							<div className={styles.messageActions}><MessageCopyButton text={message.content} /></div>
						) : null}
					</div>
					<div className={styles.answer}><MarkdownContent markdown={finalText} citations={effectiveCitations} /></div>
					{effectiveCitations.length > 0 ? (
						<div className={styles.citations}><CitationCards citations={effectiveCitations} citedIndices={citedIndices} /></div>
					) : null}
				</div>
			</div>
		);
	};

	return (
		<div className={styles.thread}>
			<div className={styles.toolbar}>
				<div className={styles.toolbarTitle}>
					<h2>{title}</h2>
					<p>AIRA workspace</p>
				</div>
				<div className={styles.modeGroup} aria-label="Research tools">
					<span className={styles.modeActive} title="AIRA standard research">AIRA</span>
					<button type="button" onClick={() => emitComposerCommand("/deep ")} className={styles.modeButton} title="Prepare a Deep Research query">Deep research</button>
				</div>
				<div className={styles.toolbarActions}>
					<Link href="/workspace-search" className={styles.iconLink} aria-label="Search conversation history"><History className="size-4" strokeWidth={1.6} /></Link>
					<button type="button" onClick={() => void shareConversation()} disabled={!shareableText.trim()} className={styles.iconButton} aria-label="Share conversation"><Share2 className="size-4" strokeWidth={1.6} /></button>
					<Link href="/compare" className={styles.modelLink} title="Open Model Lab"><span className={styles.modelDot} />AIRA Auto<GitCompareArrows className="size-3.5" strokeWidth={1.6} /></Link>
				</div>
				{shareFeedback ? <span className="sr-only" role="status" aria-live="polite">{shareFeedback}</span> : null}
			</div>

			<div className={styles.columns}>
				<section className={styles.messages} aria-label="Conversation messages">
					<div className={styles.readingColumn}>
						{showEmptyHint ? (
							<div className={styles.empty}>
								<div className={styles.emptyIntro}>
									<div className={styles.emptyMark}><Sparkles className="size-5" strokeWidth={1.6} aria-hidden /></div>
									<h2>What can AIRA help you accomplish?</h2>
									<p>Ask a question, investigate the web, work with your knowledge, compare configured models, or hand a longer task to an agent.</p>
								</div>
								{exampleQueries.length > 0 && onPickExample ? (
									<div className={styles.examples}>
										{exampleQueries.map((item) => (
											<button key={item} type="button" onClick={() => onPickExample(item)} className={styles.example}>
												<span className={styles.exampleLabel}>Ask AIRA</span>{item}
											</button>
										))}
									</div>
								) : null}
								<div className={styles.starters}>
									{STARTERS.map((item) => {
										const Icon = item.icon;
										return (
											<Link key={item.href} href={item.href} className={styles.starter}>
												<Icon className={styles.starterIcon} size={14} strokeWidth={1.7} aria-hidden />
												<span><strong>{item.title}</strong><small>{item.description}</small></span>
											</Link>
										);
									})}
								</div>
							</div>
						) : null}

						{messages.map((message) => message.role === "USER" ? (
							<div key={message.id} className={styles.userRow}>
								<div className={styles.userWrap}>
									<div className={styles.userBubble}>{message.content}</div>
									<div className={`${styles.messageActions} ${styles.userActions}`}><ReusePromptButton text={message.content} /><MessageCopyButton text={message.content} /></div>
								</div>
							</div>
						) : <div key={message.id}>{renderAssistant({ content: message.content, citations: message.citations, streaming: false })}</div>)}

						{streamingUserQuery ? (
							<div className={styles.userRow} aria-label="Streaming user message"><div className={styles.userWrap}><div className={styles.userBubble}>{streamingUserQuery}</div></div></div>
						) : null}
						{streamingAssistantMarkdown ? <div aria-label="Streaming assistant message">{renderAssistant({ content: streamingAssistantMarkdown, citations: [], streaming: true })}</div> : null}
						{showAssistantSkeleton ? <AssistantSkeleton sourceCount={streamingCitations.length} /> : null}
					</div>
				</section>

				<aside className={styles.inspector} aria-label="Conversation inspector">
					<div className={styles.inspectorInner}>
						<section className={styles.inspectorSection}>
							<strong>Model routing</strong>
							<Link href="/compare" className={styles.modelRow}>
								<span><strong>AIRA Auto</strong><small>Provider router + task policy</small></span>
								<GitCompareArrows className="size-4" strokeWidth={1.6} />
							</Link>
						</section>

						<section className={styles.inspectorSection}>
							<div className={styles.inspectorHeader}><strong>Sources</strong><span className={styles.inspectorMeta}>{inspectorCitations.length}</span></div>
							<div className={styles.sourceList}>
								{inspectorCitations.length === 0 ? (
									<p className={styles.sourceEmpty}>Sources appear here when the backend returns grounded web citations.</p>
								) : inspectorCitations.slice(0, 6).map((citation) => (
									<a key={`${citation.index}-${citation.url}`} href={citation.url} target="_blank" rel="noreferrer" className={styles.sourceLink}>
										<span className={styles.sourceIndex}>{citation.index}</span>
										<span className={styles.sourceCopy}><strong>{citation.title}</strong><small>{hostnameFromUrl(citation.url)}<ExternalLink className="size-2.5" /></small></span>
									</a>
								))}
							</div>
						</section>

						<section className={styles.inspectorSection}>
							<strong>Conversation</strong>
							<dl className={styles.infoList}>
								<div className={styles.infoRow}><dt>Created</dt><dd>{createdAt && !Number.isNaN(createdAt.getTime()) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(createdAt) : "New thread"}</dd></div>
								<div className={styles.infoRow}><dt>Messages</dt><dd>{messages.length}</dd></div>
								<div className={styles.infoRow}><dt>Sources</dt><dd>{inspectorCitations.length}</dd></div>
								<div className={styles.infoRow}><dt>Status</dt><dd className={styles.status}><span className={styles.modelDot} />Active</dd></div>
							</dl>
						</section>

						<section className={styles.inspectorSection}>
							<strong>Actions</strong>
							<div className={styles.actionList}>
								<button type="button" disabled={!copyAll} onClick={() => void navigator.clipboard.writeText(copyAll)} className={styles.inspectorAction}><Copy className="size-3.5" strokeWidth={1.6} />Copy conversation</button>
								<button type="button" disabled={!shareableText.trim()} onClick={() => void shareConversation()} className={styles.inspectorAction}><Share2 className="size-3.5" strokeWidth={1.6} />Share conversation</button>
								<button type="button" onClick={() => window.print()} className={styles.inspectorAction}><FileDown className="size-3.5" strokeWidth={1.6} />Print / save as PDF</button>
								<button type="button" onClick={() => emitComposerCommand("/new")} className={styles.inspectorAction}><MessageSquarePlus className="size-3.5" strokeWidth={1.6} />New conversation</button>
							</div>
							{shareFeedback ? <p className={styles.feedback} role="status">{shareFeedback}</p> : null}
						</section>
					</div>
				</aside>
			</div>
		</div>
	);
}
