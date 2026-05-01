"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Loader2, MessageCircle } from "lucide-react";

import { CitationCards, type CitationItem } from "../CitationCards";
import { cn } from "../../lib/cn";

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
	return value.every((v) => {
		if (!v || typeof v !== "object") return false;
		const o = v as Record<string, unknown>;
		return (
			typeof o.url === "string" &&
			typeof o.title === "string" &&
			typeof o.index === "number" &&
			(o.publishedDate === null || typeof o.publishedDate === "string") &&
			typeof o.rankingScore === "number"
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
	readonly exampleQueries?: readonly string[];
	readonly onPickExample?: (query: string) => void;
}

function MarkdownContent({ markdown }: { readonly markdown: string }) {
	return (
		<div className="answer-markdown">
			<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
		</div>
	);
}

function AssistantSkeleton() {
	return (
		<div className="flex w-full flex-col gap-5 py-2" aria-busy="true" aria-label="Researching">
			<div className="flex items-center gap-3">
				<Loader2 className="size-5 animate-spin text-accent" aria-hidden />
				<p className="text-base font-medium tracking-tight text-content-primary">
					Researching
					<span className="inline-block w-6 animate-pulse text-accent">...</span>
				</p>
			</div>
			<div className="flex flex-col gap-3">
				<div className="h-4 w-[92%] animate-pulse rounded-md bg-surface-inset" />
				<div className="h-4 w-[78%] animate-pulse rounded-md bg-surface-inset [animation-delay:120ms]" />
				<div className="h-4 w-[64%] animate-pulse rounded-md bg-surface-inset [animation-delay:240ms]" />
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
	exampleQueries = [],
	onPickExample,
}: ConversationMessageListProps) {
	const renderAssistant = (msg: {
		readonly content: string;
		readonly citations: unknown;
		readonly streaming: boolean;
	}) => {
		const citations = isCitationArray(msg.citations) ? msg.citations : [];
		const effectiveCitations = msg.streaming ? streamingCitations : citations;

		return (
			<div className="flex flex-col gap-5 py-2">
				<div className="whitespace-pre-wrap text-[16px] leading-8 text-content-secondary">
					<MarkdownContent markdown={msg.content} />
				</div>
				{effectiveCitations.length > 0 ? <CitationCards citations={effectiveCitations} /> : null}
			</div>
		);
	};

	return (
		<div className="flex flex-col gap-4 px-2 py-2">
			{showEmptyHint ? (
				<div
					className="flex min-h-[240px] flex-col items-center justify-center gap-8 rounded-2xl border border-dashed border-border-subtle bg-surface-inset/35 px-4 py-16 text-center sm:px-8"
					role="status"
				>
					<MessageCircle className="size-10 text-accent/50" aria-hidden />
					<div className="max-w-lg space-y-2">
						<p className="text-sm font-semibold text-content-primary">Try an example</p>
						<p className="text-sm leading-relaxed text-content-secondary">
							Pick a question to fill the search box, then press{" "}
							<kbd className="rounded-md border border-border-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[11px] text-content-primary">
								Enter
							</kbd>{" "}
							to search.
						</p>
					</div>
					{exampleQueries.length > 0 && onPickExample ? (
						<ul className="flex w-full max-w-xl flex-col gap-3 sm:max-w-2xl">
							{exampleQueries.map((q) => (
								<li key={q} className="w-full">
									<button
										type="button"
										onClick={() => onPickExample(q)}
										className={cn(
											"w-full rounded-xl border border-border-subtle bg-surface-elevated/50 px-5 py-4 text-left text-sm text-content-primary shadow-sm",
											"transition hover:border-accent/35 hover:bg-accent/5 hover:shadow-panel",
											"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
										)}
									>
										{q}
									</button>
								</li>
							))}
						</ul>
					) : null}
					<p className="text-xs text-content-tertiary">Press Enter to search</p>
				</div>
			) : null}

			{messages.map((m) => {
				if (m.role === "USER") {
					return (
						<div key={m.id} className="flex w-full justify-end">
							<div className={cn("max-w-[80%] rounded-3xl bg-surface-inset px-5 py-4")}>
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
					<div className={cn("max-w-[80%] rounded-3xl bg-surface-inset px-5 py-4")}>
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
						<AssistantSkeleton />
					</div>
				</div>
			) : null}
		</div>
	);
}

