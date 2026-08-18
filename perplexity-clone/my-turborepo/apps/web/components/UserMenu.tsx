"use client";

import { Bot, Brain, ChevronDown, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

import { Button } from "./ui/button";
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
		return <div className={cn("h-10 w-[132px] animate-pulse rounded-2xl bg-surface-inset", className)} aria-hidden />;
	}

	if (!session?.user) {
		return (
			<Button variant="default" size="sm" asChild className={cn("h-10 rounded-2xl bg-content-primary px-4 text-sm font-semibold shadow-[0_8px_24px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5", className)}>
				<Link
					href={`/signin?callbackUrl=${encodeURIComponent(returnTo || "/")}`}
					onClick={() => {
						try { logProductEvent({ event: "sign_in_clicked", surface: "auth", userType: "guest" }); } catch { /* noop */ }
					}}
				>
					Sign in
				</Link>
			</Button>
		);
	}

	const label = session.user.name ?? session.user.email ?? "Account";
	const shortLabel = session.user.name?.split(/\s+/)[0] ?? "Account";

	return (
		<details className={cn("group relative", className)}>
			<summary className="aira-glass flex h-10 cursor-pointer list-none items-center gap-2 rounded-2xl px-2.5 pr-3 text-sm transition hover:-translate-y-0.5 hover:border-accent/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
				<span className="relative flex size-7 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))] text-[10px] font-bold text-white shadow-sm">
					<span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.5),transparent_40%)]" aria-hidden />
					<span className="relative">{initials(label)}</span>
				</span>
				<span className="hidden max-w-[120px] truncate font-medium text-content-primary sm:inline">{shortLabel}</span>
				<ChevronDown className="size-3.5 text-content-tertiary transition-transform group-open:rotate-180" aria-hidden />
			</summary>

			<div className="aira-enter aira-glass absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-3xl p-2 shadow-[0_22px_65px_rgba(15,23,42,0.15)]">
				<div className="rounded-2xl bg-white/70 px-3 py-3">
					<p className="truncate text-sm font-semibold text-content-primary">{label}</p>
					{session.user.email && session.user.name ? <p className="mt-0.5 truncate text-xs text-content-tertiary">{session.user.email}</p> : null}
				</div>
				<Link href="/memory" className="mt-1 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-content-secondary transition hover:bg-white hover:text-content-primary">
					<span className="aira-icon-pop flex size-8 items-center justify-center rounded-xl"><Brain className="size-4" aria-hidden /></span> Memory
				</Link>
				<Link href="/agents" className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-content-secondary transition hover:bg-white hover:text-content-primary">
					<span className="aira-icon-pop flex size-8 items-center justify-center rounded-xl"><Bot className="size-4" aria-hidden /></span> Agents
				</Link>
				<div className="my-1 h-px bg-border-subtle" />
				<button
					type="button"
					onClick={() => void signOut({ callbackUrl: "/" })}
					className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left text-sm text-content-secondary transition hover:bg-white hover:text-content-primary"
				>
					<span className="flex size-8 items-center justify-center rounded-xl bg-surface-inset text-content-tertiary"><LogOut className="size-4" aria-hidden /></span> Sign out
				</button>
			</div>
		</details>
	);
}
