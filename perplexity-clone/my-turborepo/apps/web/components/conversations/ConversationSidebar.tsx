"use client";

import { Plus, Search, Settings2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { UsageIndicator } from "../UsageIndicator";
import styles from "./ConversationSidebar.module.css";

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
		<aside className={cn(styles.sidebar, className)} aria-label="Conversation sidebar">
			<div className={styles.inner}>
				<div className={styles.header}>
					<div><strong>Conversations</strong><small>Saved AIRA threads</small></div>
					<span className={styles.count}>{conversations.length}</span>
				</div>

				<div className={styles.controls}>
					<button type="button" onClick={onCreateConversation} disabled={disabled} className={styles.newButton}>
						<span><Plus className="size-4" strokeWidth={1.8} aria-hidden />New conversation</span>
						<span className={styles.shortcut}>⌘⇧O</span>
					</button>

					<div className={styles.searchWrap}>
						<Search className={styles.searchIcon} size={14} strokeWidth={1.7} aria-hidden />
						<input
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder="Search conversations"
							className={styles.searchInput}
							aria-label="Search recent conversations"
						/>
						{filter ? (
							<button type="button" onClick={() => setFilter("")} className={styles.clearButton} aria-label="Clear conversation search">
								<X className="size-3.5" aria-hidden />
							</button>
						) : null}
					</div>
				</div>

				<div className={styles.list}>
					{filtered.length === 0 ? (
						<div className={styles.empty}>
							<strong>{filter ? "No matching conversations" : "No saved conversations yet"}</strong>
							<p>{filter ? "Try another title or use global search." : "Saved AIRA threads will appear here after you start working."}</p>
						</div>
					) : (
						["Today", "Previous 7 Days", "Older"].map((label) => {
							const rows = groups.get(label);
							if (!rows?.length) return null;
							return (
								<section key={label} className={styles.group} aria-label={`${label} conversations`}>
									<p className={styles.groupLabel}>{label}</p>
									<ul className={styles.conversationList}>
										{rows.map((conversation) => {
											const selected = conversation.id === selectedConversationId;
											return (
												<li key={conversation.id}>
													<button
														type="button"
														onClick={() => void onSelectConversation(conversation.id)}
														disabled={disabled}
														aria-current={selected ? "page" : undefined}
														className={cn(styles.conversationButton, selected && styles.selected)}
													>
														<span className={styles.conversationTitle}>{conversation.title}</span>
														<span className={styles.time}>{formatRelative(conversation.lastMessageAt)}</span>
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

				<div className={styles.footer}>
					<div className={styles.footerInner}>
						<UsageIndicator />
						<Link href="/settings" className={styles.settingsLink}>
							<span>Account & workspace</span><Settings2 className="size-3.5" strokeWidth={1.7} aria-hidden />
						</Link>
					</div>
				</div>
			</div>
		</aside>
	);
}
