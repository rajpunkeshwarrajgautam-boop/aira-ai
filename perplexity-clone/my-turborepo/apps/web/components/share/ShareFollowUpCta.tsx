"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";

export function ShareFollowUpCta({
	initialQuery,
	className,
}: {
	readonly initialQuery: string;
	readonly className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [followUp, setFollowUp] = useState("");
	const { data: session, status } = useSession();
	const router = useRouter();

	const asking = status === "loading";
	const effectiveDisabled = asking;

	function authOrRedirect(callbackUrl: string) {
		const signinUrl = `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
		window.location.assign(signinUrl);
	}

	async function onSubmit() {
		const q = followUp.trim() || initialQuery.trim();
		if (!q) return;

		if (!session?.user) {
			const callback = `/?q=${encodeURIComponent(q)}`;
			authOrRedirect(callback);
			return;
		}

		// Start a new private conversation from the follow-up query.
		// We do not reuse the shared research thread to avoid exposing private conversation state.
		router.push(`/?q=${encodeURIComponent(q)}`);
	}

	return (
		<div className={cn("flex flex-col gap-2", className)}>
			{open ? (
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
					<input
						type="text"
						value={followUp}
						onChange={(e) => setFollowUp(e.target.value)}
						placeholder="Ask a follow-up…"
						className="h-11 flex-1 rounded-xl border border-border-subtle bg-surface-elevated/80 px-4 text-sm text-content-primary outline-none ring-0 focus-visible:ring-2 focus-visible:ring-accent/50"
						disabled={effectiveDisabled}
					/>
					<button
						type="button"
						onClick={() => void onSubmit()}
						disabled={effectiveDisabled}
						className={cn(
							"h-11 rounded-xl bg-accent/20 px-4 text-sm font-medium text-accent ring-1 ring-accent/30 shadow-float",
							"hover:bg-accent/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
							"disabled:opacity-40 disabled:pointer-events-none",
						)}
					>
						Continue
					</button>
					<button
						type="button"
						onClick={() => {
							setOpen(false);
							setFollowUp("");
						}}
						disabled={effectiveDisabled}
						className={cn(
							"h-11 rounded-xl border border-border-subtle bg-surface-elevated/70 px-4 text-sm font-medium text-content-secondary",
							"hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
							"disabled:opacity-40 disabled:pointer-events-none",
						)}
					>
						Cancel
					</button>
				</div>
			) : (
				<button
					type="button"
					disabled={effectiveDisabled}
					onClick={() => setOpen(true)}
					className={cn(
						"inline-flex w-fit items-center gap-2 rounded-xl border border-border-subtle bg-surface-elevated/70 px-3 py-2 text-xs font-medium text-content-secondary shadow-float backdrop-blur-md",
						"hover:border-accent/35 hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
						"disabled:opacity-40 disabled:pointer-events-none",
					)}
				>
					Ask a follow-up
				</button>
			)}
		</div>
	);
}

