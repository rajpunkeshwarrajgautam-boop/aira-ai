"use client";

import { Plus } from "lucide-react";
import { useMemo } from "react";

import { Button } from "../ui/button";
import { cn } from "../../lib/cn";

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

function formatShortDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(d);
}

import { UsageIndicator } from "../UsageIndicator";

export function ConversationSidebar({
	conversations,
	selectedConversationId,
	onSelectConversation,
	onCreateConversation,
	disabled,
	className,
}: ConversationSidebarProps) {
	const sorted = useMemo(() => {
		// API should already sort, but keep deterministic ordering for UI.
		return [...conversations].sort((a, b) =>
			a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0,
		);
	}, [conversations]);

	return (
		<aside
			className={cn(
				"flex h-full w-full flex-col overflow-hidden rounded-3xl border border-border-subtle/70 bg-surface-elevated/55 shadow-glass ring-1 ring-white/40 backdrop-blur-md md:min-h-[calc(100dvh-2rem)]",
				className,
			)}
			aria-label="Conversation sidebar"
		>
			<div className="p-4">
				<UsageIndicator />
			</div>
			<div className="flex items-center justify-between gap-3 px-4 py-4">
				<div>
					<h2 className="text-sm font-semibold text-content-primary">Conversations</h2>
					<p className="text-xs text-content-tertiary">Research threads</p>
				</div>
				<Button
					variant="secondary"
					size="icon"
					onClick={() => onCreateConversation()}
					disabled={disabled}
					className="size-9 rounded-xl"
					aria-label="Create new conversation"
				>
					<Plus className="size-4" aria-hidden />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
				{sorted.length === 0 ? (
					<div className="px-2 py-6 text-center">
						<p className="text-sm font-medium text-content-primary">No conversations yet</p>
						<p className="mt-1 text-xs text-content-tertiary">Create one to start a new thread.</p>
					</div>
				) : (
					<ul className="space-y-1 px-1">
						{sorted.map((c) => {
							const selected = c.id === selectedConversationId;
							return (
								<li key={c.id}>
									<Button
										variant="ghost"
										onClick={() => onSelectConversation(c.id)}
										disabled={disabled}
										className={cn(
											"flex h-auto w-full flex-col items-start gap-1 rounded-2xl px-3 py-2.5 text-left shadow-sm transition-colors",
											selected
												? "bg-accent/14 ring-1 ring-accent/30 shadow-panel hover:bg-accent/18"
												: "bg-surface-elevated/30 hover:bg-surface-inset/70",
										)}
									>
										<div className="flex w-full items-start justify-between gap-3">
											<span
												className={cn(
													"min-w-0 flex-1 truncate text-sm font-medium",
													selected ? "text-accent" : "text-content-primary",
												)}
											>
												{c.title}
											</span>
											<span className="shrink-0 text-[11px] font-normal text-content-tertiary">
												{formatShortDate(c.lastMessageAt)}
											</span>
										</div>
									</Button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</aside>
	);
}

