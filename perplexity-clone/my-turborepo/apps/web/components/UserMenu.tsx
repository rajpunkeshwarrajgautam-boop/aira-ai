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
			<Button variant="default" size="sm" asChild className={cn("h-10 rounded-2xl px-4 text-sm font-semibold shadow-sm", className)}>
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
			<summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-2xl border border-border-subtle bg-white px-2.5 pr-3 text-sm shadow-sm transition hover:border-border hover:bg-surface-inset/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
				<span className="flex size-7 items-center justify-center rounded-xl bg-accent/10 text-[11px] font-bold text-accent ring-1 ring-accent/10">
					{initials(label)}
				</span>
				<span className="hidden max-w-[120px] truncate font-medium text-content-primary sm:inline">{shortLabel}</span>
				<ChevronDown className="size-3.5 text-content-tertiary transition-transform group-open:rotate-180" aria-hidden />
			</summary>

			<div className="aira-enter absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-border-subtle bg-white p-1.5 shadow-[0_18px_55px_rgba(15,23,42,0.14)]">
				<div className="border-b border-border-subtle px-3 py-2.5">
					<p className="truncate text-sm font-semibold text-content-primary">{label}</p>
					{session.user.email && session.user.name ? <p className="mt-0.5 truncate text-xs text-content-tertiary">{session.user.email}</p> : null}
				</div>
				<Link href="/memory" className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-content-secondary transition hover:bg-surface-inset hover:text-content-primary">
					<Brain className="size-4" aria-hidden /> Memory
				</Link>
				<Link href="/agents" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-content-secondary transition hover:bg-surface-inset hover:text-content-primary">
					<Bot className="size-4" aria-hidden /> Agents
				</Link>
				<div className="my-1 h-px bg-border-subtle" />
				<button
					type="button"
					onClick={() => void signOut({ callbackUrl: "/" })}
					className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-content-secondary transition hover:bg-surface-inset hover:text-content-primary"
				>
					<LogOut className="size-4" aria-hidden /> Sign out
				</button>
			</div>
		</details>
	);
}
