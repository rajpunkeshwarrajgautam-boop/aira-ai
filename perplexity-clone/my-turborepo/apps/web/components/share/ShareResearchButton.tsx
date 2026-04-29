"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";

import { CopyShareLinkButton } from "./CopyShareLinkButton";

export function ShareResearchButton({
	conversationId,
	messageId,
	className,
}: {
	readonly conversationId: string;
	readonly messageId: string;
	readonly className?: string;
}) {
	const { status } = useSession();
	const [busy, setBusy] = useState(false);
	const [shareUrl, setShareUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const canShare = status === "authenticated" && conversationId.length > 0 && messageId.length > 0;

	async function onShare() {
		if (!canShare || busy) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/share", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ conversationId, messageId }),
			});

			if (!res.ok) {
				const parsed = (await res.json().catch(() => null)) as
					| { error?: { message?: string } }
					| null;
				throw new Error(parsed?.error?.message ?? `Share request failed (${res.status}).`);
			}

			const data = (await res.json()) as { readonly url: string };
			setShareUrl(data.url);
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Failed to generate share link.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className={className}>
			{shareUrl ? (
				<CopyShareLinkButton url={shareUrl} />
			) : (
				<button
					type="button"
					disabled={!canShare || busy}
					onClick={() => void onShare()}
					className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-elevated/70 px-3 py-2 text-xs font-medium text-content-secondary shadow-float backdrop-blur-md hover:border-accent/35 hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					Share research
				</button>
			)}

			{error ? (
				<p className="mt-2 text-xs text-red-200" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}

