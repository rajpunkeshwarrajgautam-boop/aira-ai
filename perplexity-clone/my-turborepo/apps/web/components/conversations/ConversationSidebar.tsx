"use client";

import { Plus, Search, Settings2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/cn";
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
	readonly onSelectConversation: (id: string) => void | Promise<void>;
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
	const date = new Date(iso);
	const days = relativeDays(iso);
	if (days === 0) return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
	if (days === 1) return "Yesterday";
	if (days < 7) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function groupLabel(iso: string): "Today" | "Previous 7 Days" | "Older" {
	const days = relativeDays(iso);
	if (days === 0) return "Today";
	if (days < 7) return "Previous 7 Days";
	return "Older";
}


export function ConversationSidebar({
	conversations,
	selectedConversationId,
	onSelectConversation,
	onCreateConversation,
	disabled,
	className,
}: ConversationSidebarProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const deepLinkInFlightRef = useRef<string | null>(null);
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

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") {
				event.preventDefault();
				if (!disabled) onCreateConversation();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [disabled, onCreateConversation]);

	useEffect(() => {
		const targetConversationId = searchParams.get("conversation")?.trim();
		if (!targetConversationId || disabled) return;
		if (deepLinkInFlightRef.current === targetConversationId) return;
		if (selectedConversationId === targetConversationId) {
			router.replace("/", { scroll: false });
			return;
		}
		deepLinkInFlightRef.current = targetConversationId;
		void Promise.resolve(onSelectConversation(targetConversationId))
			.catch(() => undefined)
			.finally(() => {
				deepLinkInFlightRef.current = null;
				router.replace("/", { scroll: false });
			});
	}, [disabled, onSelectConversation, router, searchParams, selectedConversationId]);

	return (
		<aside
			className={cn(
				"aira-reference-sidebar flex h-full w-full overflow-hidden border-r border-border-subtle bg-[hsl(var(--sidebar))]",
				className,
			)}
			aria-label="Conversation sidebar"
		>

			<div className="aira-conversation-nav flex min-w-0 flex-1 flex-col bg-[#0c111d]">
				<div className="flex h-14 items-center justify-between border-b border-border-subtle px-4">
					<div>
						<p className="text-[11px] font-semibold text-content-primary">Conversations</p>
						<p className="mt-0.5 text-[9px] text-content-tertiary">Research history</p>
					</div>
					<span className="rounded-md border border-white/[0.07] bg-white/[0.025] px-1.5 py-0.5 text-[8px] tabular-nums text-content-tertiary">{conversations.length}</span>
				</div>

				<div className="px-3 pb-2 pt-3">
					<button
						type="button"
						onClick={onCreateConversation}
						disabled={disabled}
						className="aira-new-chat flex h-11 w-full items-center justify-between rounded-xl border border-accent/20 bg-accent px-3 text-[12px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,.05)] transition hover:bg-accent/90 disabled:opacity-50"
					>
						<span className="flex items-center gap-2.5"><Plus className="size-4" strokeWidth={1.8} aria-hidden />New conversation</span>
						<span className="rounded-md border border-white/10 bg-black/15 px-1.5 py-0.5 font-mono text-[9px] text-violet-100/75">⌘⇧O</span>
					</button>

					<div className="relative mt-2.5">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-content-tertiary" strokeWidth={1.7} aria-hidden />
						<input
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder="Search conversations"
							className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#0a0f1a] pl-9 pr-8 text-[11px] text-content-primary outline-none placeholder:text-content-tertiary transition focus:border-accent/40"
							aria-label="Search recent conversations"
						/>
						{filter ? (
							<button type="button" onClick={() => setFilter("")} className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-content-tertiary hover:bg-white/[0.05] hover:text-content-primary" aria-label="Clear conversation search">
								<X className="size-3.5" aria-hidden />
							</button>
						) : null}
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
					{filtered.length === 0 ? (
						<div className="mx-1 mt-3 rounded-xl border border-dashed border-white/[0.08] px-3 py-4">
							<p className="text-[11px] font-medium text-content-secondary">{filter ? "No matching conversations" : "No saved conversations yet"}</p>
							<p className="mt-1 text-[9px] leading-4 text-content-tertiary">{filter ? "Try a different title or global search." : "Your saved AIRA threads will appear here."}</p>
						</div>
					) : (
						["Today", "Previous 7 Days", "Older"].map((label) => {
							const rows = groups.get(label);
							if (!rows?.length) return null;
							return (
								<section key={label} className="mb-4" aria-label={`${label} conversations`}>
									<h2 className="px-2 pb-1.5 pt-2 text-[10px] font-semibold text-content-tertiary">{label}</h2>
									<ul className="space-y-0.5">
										{rows.map((conversation) => {
								const selected = conversation.id === selectedConversationId;
								return (
									<li key={conversation.id}>
										<button
											type="button"
											onClick={() => void onSelectConversation(conversation.id)}
											disabled={disabled}
											aria-current={selected ? "page" : undefined}
											className={cn(
												"group flex min-h-10 w-full items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left transition",
												selected ? "border-accent/15 bg-accent/10 text-content-primary" : "text-content-secondary hover:bg-white/[0.04] hover:text-content-primary",
											)}
										>
											<span className="min-w-0 flex-1 truncate text-[12px] font-medium">{conversation.title}</span>
											<span className="shrink-0 text-[9px] tabular-nums text-content-tertiary">{formatRelative(conversation.lastMessageAt)}</span>
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

				<div className="border-t border-white/[0.07] p-3">
					<div className="rounded-xl border border-white/[0.08] bg-[#111827]/75 p-2.5">
						<UsageIndicator />
						<Link href="/settings" className="mt-2 flex items-center justify-between rounded-lg px-2 py-1.5 text-[10px] text-content-tertiary transition hover:bg-white/[0.04] hover:text-content-primary">
							<span>Account & workspace</span><Settings2 className="size-3.5" strokeWidth={1.7} aria-hidden />
						</Link>
					</div>
				</div>
			</div>
		</aside>
	);
}
