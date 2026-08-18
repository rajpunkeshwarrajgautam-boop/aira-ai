"use client";

import { MessageCircle, PanelLeftClose, Plus, Sparkles } from "lucide-react";
import { useMemo } from "react";
import Link from "next/link";

import { cn } from "../../lib/cn";
import { UsageIndicator } from "../UsageIndicator";
import { AiraLogo } from "../AiraLogo";

export interface ConversationSummary {
	readonly id: string;
	readonly title: string;
	readonly lastMessageAt: string;
	readonly createdAt: string;
}

export interface ConversationSidebarProps {
	readonly conversations: readonly ConversationSummary[];
	readonly selectedConversationId: string | null;
	readonly onSelectConversation: (id: string) => void;
	readonly onCreateConversation: () => void;
	readonly disabled?: boolean;
	readonly className?: string;
}

function formatRelative(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
	if (days <= 0) return "Today";
	if (days === 1) return "1d";
	if (days < 7) return `${days}d`;
	if (days < 14) return "1w";
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function ConversationSidebar({ conversations, selectedConversationId, onSelectConversation, onCreateConversation, disabled, className }: ConversationSidebarProps) {
	const sorted = useMemo(() => [...conversations].sort((a, b) => a.lastMessageAt < b.lastMessageAt ? 1 : -1), [conversations]);

	return (
		<aside className={cn("flex h-full w-full flex-col border-r border-border-subtle bg-white/90", className)} aria-label="Conversation sidebar">
			<div className="flex h-[68px] items-center justify-between border-b border-border-subtle px-5">
				<AiraLogo />
				<PanelLeftClose className="size-4 text-content-tertiary" aria-hidden />
			</div>

			<div className="px-4 pt-4">
				<button
					type="button"
					onClick={onCreateConversation}
					disabled={disabled}
					className="flex h-11 w-full items-center gap-2 rounded-2xl border border-accent/20 bg-accent/[0.055] px-3.5 text-sm font-semibold text-accent transition hover:bg-accent/[0.09] disabled:opacity-50"
				>
					<Plus className="size-4" aria-hidden /> New chat
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
				<p className="px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-content-tertiary">Previous conversations</p>
				{sorted.length === 0 ? (
					<p className="px-2 py-5 text-sm leading-6 text-content-tertiary">Your saved research threads will appear here.</p>
				) : (
					<ul className="mt-2 space-y-0.5">
						{sorted.map((conversation) => {
							const selected = conversation.id === selectedConversationId;
							return (
								<li key={conversation.id}>
									<button
										type="button"
										onClick={() => onSelectConversation(conversation.id)}
										disabled={disabled}
										className={cn("group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition", selected ? "bg-surface-inset text-content-primary" : "text-content-secondary hover:bg-surface-inset/60 hover:text-content-primary")}
									>
										<MessageCircle className={cn("size-4 shrink-0", selected ? "text-accent" : "text-content-tertiary")} aria-hidden />
										<span className="min-w-0 flex-1 truncate text-[13px] font-medium">{conversation.title}</span>
										<span className="shrink-0 text-[10px] text-content-tertiary">{formatRelative(conversation.lastMessageAt)}</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			<div className="space-y-3 border-t border-border-subtle p-4">
				<UsageIndicator />
				<Link href="/pricing" className="aira-card-hover block rounded-2xl border border-border-subtle bg-surface-inset/45 p-3.5">
					<div className="flex items-center gap-2 text-sm font-semibold text-content-primary"><Sparkles className="size-4 text-accent" /> AiraAI Pro</div>
					<p className="mt-1.5 text-xs leading-5 text-content-tertiary">More research, Deep Research, and agent runs.</p>
					<p className="mt-2 text-xs font-semibold text-accent">View plans →</p>
				</Link>
			</div>
		</aside>
	);
}
