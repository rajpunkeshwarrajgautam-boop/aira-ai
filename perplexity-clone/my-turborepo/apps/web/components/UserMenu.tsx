"use client";

import { Bot, Brain, ChevronDown, LogOut, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

import { cn } from "../lib/cn";
import { logProductEvent } from "../lib/log-product-event";

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "AI";
	return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function UserMenu({ className }: { readonly className?: string }) {
	const { data: session, status } = useSession();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const returnTo = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

	if (status === "loading") {
		return <div className={cn("h-9 w-20 animate-pulse rounded-lg border border-border-subtle bg-surface-elevated", className)} aria-hidden />;
	}

	if (!session?.user) {
		return (
			<Link
				href={`/signin?callbackUrl=${encodeURIComponent(returnTo || "/")}`}
				onClick={() => {
					try { logProductEvent({ event: "sign_in_clicked", surface: "auth", userType: "guest" }); } catch { /* analytics is best effort */ }
				}}
				className={cn("inline-flex h-9 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 px-3 text-[11px] font-semibold text-accent transition hover:bg-accent/15", className)}
			>
				Sign in
			</Link>
		);
	}

	const label = session.user.name ?? session.user.email ?? "Account";
	const shortLabel = session.user.name?.split(/\s+/)[0] ?? "Account";
	const itemClass = "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11px] text-content-secondary transition hover:bg-surface-inset hover:text-content-primary";

	return (
		<details className={cn("group relative", className)}>
			<summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-border-subtle bg-surface-elevated px-1.5 pr-2 text-[11px] text-content-secondary transition hover:border-border hover:bg-surface-inset focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
				<span className="grid size-6 place-items-center rounded-md border border-accent/20 bg-accent/10 text-[9px] font-bold tracking-[0.02em] text-accent">
					{initials(label)}
				</span>
				<span className="hidden max-w-[96px] truncate font-medium text-content-primary sm:inline">{shortLabel}</span>
				<ChevronDown className="size-3 text-content-tertiary transition-transform duration-150 group-open:rotate-180" strokeWidth={1.8} aria-hidden />
			</summary>

			<div className="aira-enter absolute right-0 z-[140] mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface-elevated p-1.5 shadow-[var(--aira-shadow-popover)]">
				<div className="border-b border-border-subtle px-2.5 py-2">
					<p className="truncate text-[11px] font-semibold text-content-primary">{label}</p>
					{session.user.email && session.user.name ? <p className="mt-0.5 truncate text-[9px] text-content-tertiary">{session.user.email}</p> : null}
				</div>
				<div className="pt-1">
					<Link href="/settings" className={itemClass}><Settings2 className="size-3.5 text-content-tertiary" strokeWidth={1.8} aria-hidden /> Settings</Link>
					<Link href="/memory" className={itemClass}><Brain className="size-3.5 text-content-tertiary" strokeWidth={1.8} aria-hidden /> Memory</Link>
					<Link href="/agents" className={itemClass}><Bot className="size-3.5 text-content-tertiary" strokeWidth={1.8} aria-hidden /> Agents</Link>
				</div>
				<div className="my-1 h-px bg-border-subtle" />
				<button
					type="button"
					onClick={() => void signOut({ callbackUrl: "/" })}
					className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11px] text-content-secondary transition hover:bg-red-400/[0.06] hover:text-red-300"
				>
					<LogOut className="size-3.5" strokeWidth={1.8} aria-hidden /> Sign out
				</button>
			</div>
		</details>
	);
}
