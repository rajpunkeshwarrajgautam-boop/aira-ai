"use client";

import { Plus } from "lucide-react";
import { useMemo } from "react";

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
				"flex h-full w-full flex-col border-r border-border-subtle bg-surface-elevated/40 backdrop-blur-md",
				className,
			)}
			aria-label="Conversation sidebar"
		>
			<div className="flex items-center justify-between gap-3 px-4 py-4">
				<div>
					<h2 className="text-sm font-semibold text-content-primary">Conversations</h2>
					<p className="text-xs text-content-tertiary">Research threads</p>
				</div>
				<button
					type="button"
					onClick={() => onCreateConversation()}
					disabled={disabled}
					className={cn(
						"inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/25",
						"hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
						"disabled:opacity-40 disabled:pointer-events-none",
					)}
					aria-label="Create new conversation"
				>
					<Plus className="size-4" aria-hidden />
				</button>
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
									<button
										type="button"
										onClick={() => onSelectConversation(c.id)}
										disabled={disabled}
										className={cn(
											"flex w-full flex-col gap-1 rounded-xl px-3 py-2 text-left transition-colors",
											"ring-1 ring-transparent",
											selected
												? "bg-accent/12 ring-accent/35"
												: "bg-transparent hover:bg-surface-inset/60 ring-border-subtle/0 hover:ring-border-subtle",
											"disabled:opacity-40 disabled:pointer-events-none",
										)}
									>
										<div className="flex items-start justify-between gap-3">
											<span
												className={cn(
													"min-w-0 flex-1 truncate text-sm font-medium",
													selected ? "text-accent" : "text-content-primary",
												)}
											>
												{c.title}
											</span>
											<span className="shrink-0 text-[11px] text-content-tertiary">
												{formatShortDate(c.lastMessageAt)}
											</span>
										</div>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</aside>
	);
}

