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
		<aside className={cn("flex h-full w-full flex-col border-r border-border-subtle bg-white/82 backdrop-blur-xl", className)} aria-label="Conversation sidebar">
			<div className="flex h-[68px] items-center justify-between border-b border-border-subtle/70 px-5">
				<AiraLogo />
				<span className="flex size-8 items-center justify-center rounded-xl text-content-tertiary transition hover:bg-surface-inset hover:text-content-primary"><PanelLeftClose className="size-4" aria-hidden /></span>
			</div>

			<div className="px-4 pt-4">
				<button
					type="button"
					onClick={onCreateConversation}
					disabled={disabled}
					className="group relative flex h-11 w-full items-center gap-2 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,hsl(var(--content-primary)),hsl(226_30%_22%))] px-3.5 text-sm font-semibold text-white shadow-[0_10px_26px_rgba(15,23,42,0.13)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(15,23,42,0.17)] disabled:opacity-50"
				>
					<span className="pointer-events-none absolute -right-4 -top-7 size-20 rounded-full bg-[radial-gradient(circle,hsl(var(--accent-violet)/0.42),transparent_68%)] opacity-60" aria-hidden />
					<Plus className="relative size-4 transition-transform group-hover:rotate-90" aria-hidden /> <span className="relative">New chat</span>
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
				<p className="px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-content-tertiary">Previous conversations</p>
				{sorted.length === 0 ? (
					<div className="mx-1 mt-3 rounded-2xl border border-dashed border-border-subtle bg-surface-inset/35 px-3 py-4 text-sm leading-6 text-content-tertiary">Your saved research threads will appear here.</div>
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
										className={cn("group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition", selected ? "bg-white text-content-primary shadow-[0_5px_18px_rgba(15,23,42,0.055)] ring-1 ring-border-subtle/70" : "text-content-secondary hover:bg-white/70 hover:text-content-primary")}
									>
										<span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg transition", selected ? "aira-icon-pop" : "bg-surface-inset text-content-tertiary group-hover:text-accent")}><MessageCircle className="size-3.5" aria-hidden /></span>
										<span className="min-w-0 flex-1 truncate text-[13px] font-medium">{conversation.title}</span>
										<span className="shrink-0 text-[10px] text-content-tertiary">{formatRelative(conversation.lastMessageAt)}</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			<div className="space-y-3 border-t border-border-subtle/70 p-4">
				<UsageIndicator />
				<Link href="/pricing" className="aira-premium-card aira-card-hover relative block overflow-hidden rounded-2xl p-3.5">
					<span className="pointer-events-none absolute -right-5 -top-8 size-24 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.14),transparent_70%)]" aria-hidden />
					<div className="relative flex items-center gap-2 text-sm font-semibold text-content-primary"><span className="aira-icon-pop flex size-8 items-center justify-center rounded-xl"><Sparkles className="aira-sparkle size-4" /></span> AiraAI Pro</div>
					<p className="relative mt-2 text-xs leading-5 text-content-tertiary">Deep Research, larger limits, and autonomous agent runs.</p>
					<p className="relative mt-2 text-xs font-semibold text-accent">Explore Pro →</p>
				</Link>
			</div>
		</aside>
	);
}
