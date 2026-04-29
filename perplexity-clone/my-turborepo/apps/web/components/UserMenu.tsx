"use client";

import { LogOut, User } from "lucide-react";
import { signOut, useSession } from "next-auth/react";

import { cn } from "../lib/cn";

export function UserMenu({ className }: { readonly className?: string }) {
	const { data: session, status } = useSession();

	if (status === "loading") {
		return (
			<div
				className={cn(
					"h-9 w-[140px] animate-pulse rounded-xl bg-surface-inset ring-1 ring-border-subtle",
					className,
				)}
				aria-hidden
			/>
		);
	}

	if (!session?.user) {
		return null;
	}

	const label = session.user.name ?? session.user.email ?? "Account";

	return (
		<div
			className={cn(
				"flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-inset/80 px-2 py-1.5 shadow-float backdrop-blur-md",
				className,
			)}
		>
			<div className="flex min-w-0 items-center gap-2 pl-1">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
					<User className="size-4" aria-hidden />
				</span>
				<span className="hidden max-w-[160px] truncate text-sm font-medium text-content-primary sm:inline">
					{label}
				</span>
			</div>
			<button
				type="button"
				onClick={() => void signOut({ callbackUrl: "/signin" })}
				className={cn(
					"inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-content-secondary transition-colors",
					"hover:bg-surface-elevated hover:text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
				)}
			>
				<LogOut className="size-3.5" aria-hidden />
				<span className="hidden sm:inline">Sign out</span>
			</button>
		</div>
	);
}
