"use client";

import {
	Bot,
	Brain,
	Columns2,
	Cpu,
	FileText,
	MessageSquare,
	Plus,
	Search,
	Settings2,
	X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

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

function relativeDays(iso: string): number {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return 999;
	return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function formatRelative(iso: string): string {
	const days = relativeDays(iso);
	if (days === 0) return "Today";
	if (days === 1) return "1d";
	if (days < 7) return `${days}d`;
	if (days < 14) return "1w";
	const date = new Date(iso);
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function groupLabel(iso: string): "Today" | "Previous 7 days" | "Older" {
	const days = relativeDays(iso);
	if (days === 0) return "Today";
	if (days < 7) return "Previous 7 days";
	return "Older";
}

const WORKSPACE_LINKS = [
	{ href: "/knowledge", label: "Files", icon: FileText },
	{ href: "/agents", label: "Agents", icon: Bot },
	{ href: "/local-ai", label: "Local AI", icon: Cpu },
	{ href: "/compare", label: "Compare", icon: Columns2 },
	{ href: "/memory", label: "Memory", icon: Brain },
] as const;

export function ConversationSidebar({
	conversations,
	selectedConversationId,
	onSelectConversation,
	onCreateConversation,
	disabled,
	className,
}: ConversationSidebarProps) {
	const [filter, setFilter] = useState("");
	const sorted = useMemo(
		() => [...conversations].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1)),
		[conversations],
	);
	const filtered = useMemo(() => {
		const needle = filter.trim().toLocaleLowerCase();
		if (!needle) return sorted;
		return sorted.filter((conversation) => conversation.title.toLocaleLowerCase().includes(needle));
	}, [filter, sorted]);
	const groups = useMemo(() => {
		const result = new Map<string, ConversationSummary[]>();
		for (const conversation of filtered) {
			const label = groupLabel(conversation.lastMessageAt);
			const current = result.get(label) ?? [];
			current.push(conversation);
			result.set(label, current);
		}
		return result;
	}, [filtered]);

	return (
		<aside
			className={cn(
				"flex h-full w-full flex-col border-r border-border-subtle bg-[hsl(var(--sidebar))]",
				className,
			)}
			aria-label="Conversation sidebar"
		>
			<div className="flex h-14 items-center justify-between border-b border-border-subtle px-4">
				<AiraLogo />
				<Link
					href="/settings"
					className="grid size-8 place-items-center rounded-lg text-content-tertiary transition hover:bg-surface-elevated hover:text-content-primary"
					aria-label="Open settings"
				>
					<Settings2 className="size-4" strokeWidth={1.7} aria-hidden />
				</Link>
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
						⌘⇧O
					</span>
				</button>

				<div className="relative mt-2.5">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-content-tertiary" strokeWidth={1.7} aria-hidden />
					<input
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Search chats"
						className="h-9 w-full rounded-lg border border-transparent bg-transparent pl-8 pr-8 text-[12px] text-content-primary outline-none placeholder:text-content-tertiary transition hover:bg-surface-elevated focus:border-border-subtle focus:bg-surface-inset"
						aria-label="Search recent conversations"
					/>
					{filter ? (
						<button
							type="button"
							onClick={() => setFilter("")}
							className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-content-tertiary hover:bg-surface-elevated hover:text-content-primary"
							aria-label="Clear conversation search"
						>
							<X className="size-3.5" aria-hidden />
						</button>
					) : null}
				</div>

				<p className="px-2 pb-1.5 pt-4 text-[10px] font-medium uppercase tracking-[0.12em] text-content-tertiary">
					Workspace
				</p>
				<div className="grid grid-cols-2 gap-0.5">
					{WORKSPACE_LINKS.map((item) => {
						const Icon = item.icon;
						return (
							<Link
								key={item.href}
								href={item.href}
								className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[12px] text-content-secondary transition hover:bg-surface-elevated hover:text-content-primary"
							>
								<Icon className="size-3.5" strokeWidth={1.7} aria-hidden />
								{item.label}
							</Link>
						);
					})}
					<Link
						href="/workspace-search"
						className="col-span-2 flex h-9 items-center gap-2 rounded-lg px-2.5 text-[12px] text-content-secondary transition hover:bg-surface-elevated hover:text-content-primary"
					>
						<Search className="size-3.5" strokeWidth={1.7} aria-hidden />
						Search all conversations & memory
					</Link>
				</div>
			</nav>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2">
				{filtered.length === 0 ? (
					<div className="mx-1 rounded-lg border border-dashed border-border-subtle px-3 py-4">
						<p className="text-[11px] font-medium text-content-secondary">
							{filter ? "No matching chats" : "No saved chats yet"}
						</p>
						<p className="mt-1 text-[10px] leading-4 text-content-tertiary">
							{filter ? "Try a shorter title or use global search." : "Start a conversation and it will appear here."}
						</p>
					</div>
				) : (
					["Today", "Previous 7 days", "Older"].map((label) => {
						const rows = groups.get(label);
						if (!rows?.length) return null;
						return (
							<section key={label} className="mb-3" aria-label={`${label} conversations`}>
								<p className="px-2 pb-1.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.11em] text-content-tertiary/80">
									{label}
								</p>
								<ul className="space-y-0.5">
									{rows.map((conversation) => {
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
													<span className={cn("size-1 rounded-full", selected ? "bg-accent" : "bg-transparent")} aria-hidden />
													<MessageSquare className="size-3.5 shrink-0 text-content-tertiary" strokeWidth={1.6} aria-hidden />
													<span className="min-w-0 flex-1 truncate text-[12px] font-medium">{conversation.title}</span>
													<span className="text-[9px] tabular-nums text-content-tertiary">{formatRelative(conversation.lastMessageAt)}</span>
												</button>
											</li>
										);
									})}
								</ul>
							</section>
						);
					})
				)}
			</div>

			<div className="border-t border-border-subtle p-3">
				<UsageIndicator />
				<Link
					href="/settings"
					className="mt-2 flex items-center justify-between rounded-lg px-2 py-2 text-[11px] text-content-tertiary transition hover:bg-surface-elevated hover:text-content-primary"
				>
					<span>Settings & integrations</span>
					<Settings2 className="size-3.5" strokeWidth={1.7} aria-hidden />
				</Link>
			</div>
		</aside>
	);
}