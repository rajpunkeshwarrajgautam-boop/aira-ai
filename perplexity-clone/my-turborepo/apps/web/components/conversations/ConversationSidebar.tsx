"use client";

import {
	Boxes,
	FolderOpen,
	Library,
	PanelLeftClose,
	Pin,
	PinOff,
	Plus,
	Search,
	Settings2,
	X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import {
	type ConversationGroupingItem,
	partitionConversations,
} from "../../lib/conversation-grouping";
import { AiraLogo } from "../AiraLogo";
import { UsageIndicator } from "../UsageIndicator";

export interface ConversationSummary extends ConversationGroupingItem {
	readonly id: string;
	readonly title: string;
	readonly lastMessageAt: string | Date;
	readonly createdAt?: string | Date;
	readonly pinnedAt?: string | Date | null;
}

export interface SidebarProject {
	readonly id: string;
	readonly name: string;
	readonly objective?: string;
	readonly updatedAt?: string | Date;
	readonly createdAt?: string | Date;
}

export interface ConversationSidebarProps {
	readonly conversations: readonly ConversationSummary[];
	readonly projects?: readonly SidebarProject[];
	readonly selectedConversationId: string | null;
	readonly onSelectConversation: (id: string) => void | Promise<void>;
	readonly onCreateConversation: () => void;
	readonly onTogglePin?: (id: string, pinned: boolean) => void | Promise<void>;
	readonly pinningConversationIds?: readonly string[];
	readonly onCollapse?: () => void;
	readonly errorMessage?: string | null;
	readonly disabled?: boolean;
	readonly className?: string;
}

const PRIMARY_NAV = [
	{ href: "/", label: "Research", icon: Search },
	{ href: "/knowledge", label: "Knowledge", icon: FolderOpen },
	{ href: "/projects", label: "Projects", icon: Boxes },
	{ href: "/library", label: "Library", icon: Library },
] as const;

function parseValidDate(value?: string | Date | null): Date | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelative(value?: string | Date | null): string {
	const date = parseValidDate(value);
	if (!date) return "";
	const now = new Date();
	const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const dayDelta = Math.round((startToday - startDate) / 86_400_000);
	if (dayDelta === 0) {
		return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
	}
	if (dayDelta === 1) return "Yesterday";
	if (dayDelta > 1 && dayDelta < 7) {
		return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
	}
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function SidebarSectionHeading({ children }: { readonly children: ReactNode }) {
	return (
		<h2 className="px-2 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8F8E98]">
			{children}
		</h2>
	);
}

function ConversationRow({
	conversation,
	selected,
	disabled,
	pinning,
	onSelect,
	onTogglePin,
}: {
	readonly conversation: ConversationSummary;
	readonly selected: boolean;
	readonly disabled?: boolean;
	readonly pinning: boolean;
	readonly onSelect: () => void;
	readonly onTogglePin?: () => void;
}) {
	const pinned = conversation.pinnedAt !== null && conversation.pinnedAt !== undefined;
	return (
		<li className="group/row relative">
			<button
				type="button"
				onClick={onSelect}
				disabled={disabled}
				aria-current={selected ? "page" : undefined}
				className={cn(
					"flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 pr-16 text-left transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#3A0CA3]",
					selected
						? "bg-[#3A0CA3]/[0.07] font-semibold text-[#2D0A82]"
						: "text-[#5F5E68] hover:bg-[#111115]/[0.035] hover:text-[#111115]",
				)}
			>
				<span className="min-w-0 flex-1 truncate text-[12px]">{conversation.title}</span>
				<span className="shrink-0 text-[9px] tabular-nums text-[#A09FAA]">
					{formatRelative(conversation.lastMessageAt)}
				</span>
			</button>
			{onTogglePin ? (
				<button
					type="button"
					onClick={(event) => {
					event.stopPropagation();
					onTogglePin();
				}}
					disabled={disabled || pinning}
					className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-[#9A99A3] opacity-0 transition hover:bg-white hover:text-[#3A0CA3] focus-visible:opacity-100 group-hover/row:opacity-100 disabled:cursor-wait disabled:opacity-40"
					aria-label={pinned ? `Unpin ${conversation.title}` : `Pin ${conversation.title}`}
					title={pinned ? "Unpin conversation" : "Pin conversation"}
				>
					{pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
				</button>
			) : null}
		</li>
	);
}

export function ConversationSidebar({
	conversations,
	projects = [],
	selectedConversationId,
	onSelectConversation,
	onCreateConversation,
	onTogglePin,
	pinningConversationIds = [],
	onCollapse,
	errorMessage,
	disabled,
	className,
}: ConversationSidebarProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const deepLinkInFlightRef = useRef<string | null>(null);
	const [filter, setFilter] = useState("");
	const pendingPins = useMemo(() => new Set(pinningConversationIds), [pinningConversationIds]);

	const filtered = useMemo(() => {
		const needle = filter.trim().toLocaleLowerCase();
		if (!needle) return conversations;
		return conversations.filter((conversation) =>
			conversation.title.toLocaleLowerCase().includes(needle),
		);
	}, [conversations, filter]);

	const partitioned = useMemo(() => partitionConversations(filtered), [filtered]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") {
				event.preventDefault();
				onCreateConversation();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onCreateConversation]);

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
				"aira-reference-sidebar flex h-full w-full overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F7] shadow-[0_12px_32px_rgba(17,17,21,0.045)]",
				className,
			)}
			aria-label="Aira workspace sidebar"
		>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-14 shrink-0 items-center justify-between px-3.5">
					<AiraLogo />
					{onCollapse ? (
						<button
							type="button"
							onClick={onCollapse}
							className="grid size-8 place-items-center rounded-lg text-[#777680] transition hover:bg-white hover:text-[#111115]"
							aria-label="Collapse workspace sidebar"
							title="Collapse sidebar"
						>
							<PanelLeftClose className="size-4" aria-hidden />
						</button>
					) : null}
				</div>

				<div className="px-3 pb-2">
					<button
						type="button"
						onClick={onCreateConversation}
						className="aira-new-chat flex h-10 w-full items-center justify-between rounded-xl bg-[#111115] px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[#27272B] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
					>
						<span className="flex items-center gap-2"><Plus className="size-4" aria-hidden />New Chat</span>
						<span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[9px] font-medium text-white/70">⌘⇧O</span>
					</button>
				</div>

				<nav className="px-3 pb-2" aria-label="Workspace destinations">
					{PRIMARY_NAV.map((item) => {
						const Icon = item.icon;
						return (
							<Link
								key={item.href}
								href={item.href}
								className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[12px] font-medium text-[#5F5E68] transition hover:bg-white hover:text-[#111115]"
							>
								<Icon className="size-4 text-[#8F8E98]" strokeWidth={1.8} aria-hidden />
								<span>{item.label}</span>
							</Link>
						);
					})}
				</nav>

				<div className="px-3 pb-2 pt-1">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9A99A3]" strokeWidth={1.7} aria-hidden />
						<input
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder="Search chats"
							className="h-9 w-full rounded-xl border border-[rgba(17,17,21,0.075)] bg-white pl-9 pr-8 text-[11px] text-[#111115] outline-none placeholder:text-[#A09FAA] shadow-[0_1px_2px_rgba(17,17,21,0.02)] transition focus:border-[#3A0CA3]/35 focus:ring-2 focus:ring-[#3A0CA3]/[0.06]"
							aria-label="Search conversations"
						/>
						{filter ? (
							<button type="button" onClick={() => setFilter("")} className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-[#9A99A3] hover:bg-[#111115]/[0.04] hover:text-[#111115]" aria-label="Clear conversation search">
								<X className="size-3.5" aria-hidden />
							</button>
						) : null}
					</div>
				</div>

				{errorMessage ? (
					<div className="mx-3 mb-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] leading-4 text-red-700" role="status">
						{errorMessage}
					</div>
				) : null}

				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
					{partitioned.pinned.length > 0 ? (
						<section className="mb-1" aria-label="Pinned conversations">
							<SidebarSectionHeading>Pinned</SidebarSectionHeading>
							<ul className="space-y-0.5">
								{partitioned.pinned.map((conversation) => (
									<ConversationRow
										key={conversation.id}
										conversation={conversation}
										selected={conversation.id === selectedConversationId}
										disabled={disabled}
										pinning={pendingPins.has(conversation.id)}
										onSelect={() => void onSelectConversation(conversation.id)}
										onTogglePin={onTogglePin ? () => void onTogglePin(conversation.id, false) : undefined}
									/>
								))}
							</ul>
						</section>
					) : null}

					{projects.length > 0 ? (
						<section className="mb-1" aria-label="Projects">
							<div className="flex items-center justify-between pr-2">
								<SidebarSectionHeading>Projects</SidebarSectionHeading>
								<Link href="/projects" className="text-[9px] font-medium text-[#8F8E98] hover:text-[#3A0CA3]">View all</Link>
							</div>
							<ul className="space-y-0.5">
								{projects.slice(0, 5).map((project) => (
									<li key={project.id}>
										<Link
											href={`/projects?project=${encodeURIComponent(project.id)}`}
											className="flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-[#5F5E68] transition hover:bg-white hover:text-[#111115]"
										>
											<Boxes className="size-3.5 shrink-0 text-[#9A99A3]" strokeWidth={1.8} aria-hidden />
											<span className="min-w-0 flex-1 truncate">{project.name}</span>
										</Link>
									</li>
								))}
							</ul>
						</section>
					) : null}

					<section aria-label="Recent conversations">
						<SidebarSectionHeading>Recent</SidebarSectionHeading>
						{partitioned.recentGroups.length === 0 ? (
							<div className="mx-1 rounded-xl border border-dashed border-[rgba(17,17,21,0.1)] bg-white/55 px-3 py-4 text-center">
								<p className="text-[11px] font-medium text-[#6B6A75]">{filter ? "No matching chats" : "No saved chats yet"}</p>
								<p className="mt-1 text-[10px] leading-4 text-[#9A99A3]">{filter ? "Try another title." : "Your research threads will appear here."}</p>
							</div>
						) : (
							partitioned.recentGroups.map((group) => (
								<div key={group.key} className="mb-2">
									<p className="px-2.5 pb-1 pt-1 text-[9px] font-medium text-[#A09FAA]">{group.label}</p>
									<ul className="space-y-0.5">
										{group.items.map((conversation) => (
											<ConversationRow
												key={conversation.id}
												conversation={conversation}
												selected={conversation.id === selectedConversationId}
												disabled={disabled}
												pinning={pendingPins.has(conversation.id)}
												onSelect={() => void onSelectConversation(conversation.id)}
												onTogglePin={onTogglePin ? () => void onTogglePin(conversation.id, true) : undefined}
											/>
										))}
									</ul>
								</div>
							))
						)}
					</section>
				</div>

				<div className="shrink-0 border-t border-[rgba(17,17,21,0.07)] p-3">
					<div className="rounded-xl border border-[rgba(17,17,21,0.075)] bg-white p-2.5 shadow-[0_1px_3px_rgba(17,17,21,0.03)]">
						<div className="mb-2 flex items-center justify-between gap-2">
							<div>
								<p className="text-[11px] font-semibold text-[#111115]">Aira PRO</p>
								<p className="mt-0.5 text-[9px] text-[#8F8E98]">More research capacity and premium workflows.</p>
							</div>
							<Link href="/upgrade" className="rounded-lg bg-[#F4F4F5] px-2 py-1 text-[9px] font-semibold text-[#111115] transition hover:bg-[#EAEAEA]">Upgrade</Link>
						</div>
						<UsageIndicator />
						<Link href="/settings" className="mt-2 flex items-center justify-between rounded-lg px-2 py-1.5 text-[10px] text-[#6B6A75] transition hover:bg-[#F4F4F5] hover:text-[#111115]">
							<span>Account & workspace</span><Settings2 className="size-3.5 text-[#8F8E98]" strokeWidth={1.7} aria-hidden />
						</Link>
					</div>
				</div>
			</div>
		</aside>
	);
}
