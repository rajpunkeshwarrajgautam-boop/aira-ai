"use client";

import { Bot, Brain, MessageSquare, Plus, Search, Settings2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { cn } from "../../lib/cn";
import { AiraLogo } from "../AiraLogo";
import { UsageIndicator } from "../UsageIndicator";

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

export function ConversationSidebar({
	conversations,
	selectedConversationId,
	onSelectConversation,
	onCreateConversation,
	disabled,
	className,
}: ConversationSidebarProps) {
	const sorted = useMemo(
		() => [...conversations].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1)),
		[conversations],
	);

	return (
		<aside
			className={cn(
				"flex h-full w-full flex-col border-r border-border-subtle bg-[hsl(var(--sidebar))]",
				className,
			)}
			aria-label="Conversation sidebar"
		>
			<div className="flex h-14 items-center border-b border-border-subtle px-4">
				<AiraLogo />
			</div>

			<nav className="px-3 pb-2 pt-3" aria-label="Workspace navigation">
				<button
					type="button"
					onClick={onCreateConversation}
					disabled={disabled}
					className="flex h-10 w-full items-center justify-between rounded-lg border border-border-subtle bg-surface-inset px-3 text-[13px] font-medium text-content-primary transition hover:border-border hover:bg-surface-elevated disabled:opacity-50"
				>
					<span className="flex items-center gap-2.5">
						<Plus className="size-4" strokeWidth={1.8} aria-hidden />
						New chat
					</span>
					<span className="rounded-md border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[9px] text-content-tertiary">
						⌘K
					</span>
				</button>

				<p className="px-2 pb-1.5 pt-5 text-[10px] font-medium uppercase tracking-[0.12em] text-content-tertiary">
					Workspace
				</p>
				<div className="space-y-0.5">
					<Link
						href="/agents"
						className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-content-secondary transition hover:bg-surface-elevated hover:text-content-primary"
					>
						<Bot className="size-4" strokeWidth={1.7} aria-hidden />
						Agents
					</Link>
					<Link
						href="/memory"
						className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-content-secondary transition hover:bg-surface-elevated hover:text-content-primary"
					>
						<Brain className="size-4" strokeWidth={1.7} aria-hidden />
						Memory
					</Link>
				</div>
			</nav>

			<div className="px-3 pb-1 pt-2">
				<div className="flex h-8 items-center gap-2 rounded-md px-2 text-content-tertiary" aria-hidden>
					<Search className="size-3.5" strokeWidth={1.7} />
					<span className="text-[11px]">Recent conversations</span>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
				{sorted.length === 0 ? (
					<div className="mx-1 rounded-lg border border-dashed border-border-subtle px-3 py-4">
						<p className="text-[11px] font-medium text-content-secondary">No saved chats yet</p>
						<p className="mt-1 text-[10px] leading-4 text-content-tertiary">
							Start a conversation and it will appear here.
						</p>
					</div>
				) : (
					<ul className="space-y-0.5">
						{sorted.map((conversation) => {
							const selected = conversation.id === selectedConversationId;
							return (
								<li key={conversation.id}>
									<button
										type="button"
										onClick={() => onSelectConversation(conversation.id)}
										disabled={disabled}
										aria-current={selected ? "page" : undefined}
										className={cn(
											"group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition",
											selected
												? "bg-surface-elevated text-content-primary"
												: "text-content-secondary hover:bg-surface-elevated hover:text-content-primary",
										)}
									>
										<span
											className={cn("size-1 rounded-full", selected ? "bg-accent" : "bg-transparent")}
											aria-hidden
										/>
										<MessageSquare
											className="size-3.5 shrink-0 text-content-tertiary"
											strokeWidth={1.6}
											aria-hidden
										/>
										<span className="min-w-0 flex-1 truncate text-[12px] font-medium">
											{conversation.title}
										</span>
										<span className="text-[9px] tabular-nums text-content-tertiary">
											{formatRelative(conversation.lastMessageAt)}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			<div className="border-t border-border-subtle p-3">
				<UsageIndicator />
				<div className="mt-2 flex items-center justify-between rounded-lg px-2 py-2 text-[11px] text-content-tertiary">
					<span>Enterprise workspace</span>
					<Settings2 className="size-3.5" strokeWidth={1.7} aria-hidden />
				</div>
			</div>
		</aside>
	);
}
