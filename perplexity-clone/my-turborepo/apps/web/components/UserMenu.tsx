"use client";

import { LogOut, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

import { Button } from "./ui/button";
import { cn } from "../lib/cn";

export function UserMenu({ className }: { readonly className?: string }) {
	const { data: session, status } = useSession();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const returnTo = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

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
		return (
			<Button
				variant="default"
				size="sm"
				asChild
				className={cn("h-9 rounded-xl px-4 text-sm font-semibold shadow-sm", className)}
			>
				<Link
					href={`/signin?callbackUrl=${encodeURIComponent(returnTo || "/")}`}
					title="Sign in to save threads, use Deep Research, and share results"
				>
					Sign in
				</Link>
			</Button>
		);
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
			<Button
				variant="ghost"
				size="sm"
				onClick={() => void signOut({ callbackUrl: "/" })}
				className="h-8 px-2 text-xs text-content-secondary hover:text-content-primary"
			>
				<LogOut className="mr-1.5 size-3.5" aria-hidden />
				<span className="hidden sm:inline">Sign out</span>
			</Button>
		</div>
	);
}
