"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
}

function MarkdownContent({ markdown }: { readonly markdown: string }) {
	return (
		<div className="answer-markdown">
			<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
		</div>
	);
}

export function ConversationMessageList({
	messages,
	streamingUserQuery,
	streamingAssistantMarkdown,
	streamingCitations,
}: ConversationMessageListProps) {
	const renderAssistant = (msg: {
		readonly content: string;
		readonly citations: unknown;
		readonly streaming: boolean;
	}) => {
		const citations = isCitationArray(msg.citations) ? msg.citations : [];
		const effectiveCitations = msg.streaming ? streamingCitations : citations;

		return (
			<div className="flex flex-col gap-3">
				<div className="whitespace-pre-wrap text-[15px] leading-7 text-content-secondary">
					<MarkdownContent markdown={msg.content} />
				</div>
				{effectiveCitations.length > 0 ? <CitationCards citations={effectiveCitations} /> : null}
			</div>
		);
	};

	return (
		<div className="flex flex-col gap-4 px-2 py-2">
			{messages.map((m) => {
				if (m.role === "USER") {
					return (
						<div key={m.id} className="flex w-full justify-end">
							<div className={cn("max-w-[80%] rounded-2xl bg-accent/10 p-4 ring-1 ring-accent/20")}>
								<div className="whitespace-pre-wrap text-[15px] leading-7 text-content-primary">
									{m.content}
								</div>
							</div>
						</div>
					);
				}

				return (
					<div key={m.id} className="flex w-full justify-start">
						<div className={cn("max-w-[80%] rounded-2xl border border-border-subtle bg-surface-elevated/40 p-4 shadow-panel")}>
							{renderAssistant({ content: m.content, citations: m.citations, streaming: false })}
						</div>
					</div>
				);
			})}

			{streamingUserQuery ? (
				<div className="flex w-full justify-end" aria-label="Streaming user message">
					<div className={cn("max-w-[80%] rounded-2xl bg-accent/10 p-4 ring-1 ring-accent/20")}>
						<div className="whitespace-pre-wrap text-[15px] leading-7 text-content-primary">
							{streamingUserQuery}
						</div>
					</div>
				</div>
			) : null}

			{streamingAssistantMarkdown ? (
				<div className="flex w-full justify-start" aria-label="Streaming assistant message">
					<div className={cn("max-w-[80%] rounded-2xl border border-border-subtle bg-surface-elevated/40 p-4 shadow-panel")}>
						{renderAssistant({
							content: streamingAssistantMarkdown,
							citations: [],
							streaming: true,
						})}
					</div>
				</div>
			) : null}
		</div>
	);
}

