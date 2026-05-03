"use client";

import { ExternalLink, Loader2, Share2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

export function ShareResultBar({
	conversationId,
	messageId,
	className,
}: {
	readonly conversationId: string;
	readonly messageId: string;
	readonly className?: string;
}) {
	const { status } = useSession();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
	const [toast, setToast] = useState(false);
	const toastHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const canShare =
		status === "authenticated" && conversationId.length > 0 && messageId.length > 0;

	useEffect(() => {
		setResolvedUrl(null);
		setError(null);
		setLoading(false);
	}, [conversationId, messageId]);

	const showToast = useCallback(() => {
		if (toastHideRef.current) clearTimeout(toastHideRef.current);
		setToast(true);
		toastHideRef.current = setTimeout(() => setToast(false), 2800);
	}, []);

	useEffect(() => {
		return () => {
			if (toastHideRef.current) clearTimeout(toastHideRef.current);
		};
	}, []);

	const copyUrl = useCallback(async (url: string): Promise<boolean> => {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(url);
				return true;
			}
		} catch {
			// fall through
		}
		try {
			window.prompt("Copy this share link:", url);
			return true;
		} catch {
			return false;
		}
	}, []);

	const onShareResult = useCallback(async () => {
		if (!canShare || loading) return;
		setError(null);

		if (resolvedUrl) {
			const ok = await copyUrl(resolvedUrl);
			if (ok) showToast();
			else setError("Could not copy link.");
			return;
		}

		setLoading(true);
		try {
			const res = await fetch("/api/share", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ conversationId, messageId }),
			});

			const parsed = (await res.json().catch(() => null)) as
				| { url?: string; error?: { message?: string } }
				| null;

			if (!res.ok) {
				throw new Error(parsed?.error?.message ?? `Share failed (${res.status}).`);
			}

			const url = parsed?.url;
			if (!url || typeof url !== "string") {
				throw new Error("Invalid share response.");
			}

			setResolvedUrl(url);
			const ok = await copyUrl(url);
			if (ok) showToast();
			else setError("Link created. Use “Open link” to view or copy manually.");
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Could not create share link.");
		} finally {
			setLoading(false);
		}
	}, [
		canShare,
		loading,
		resolvedUrl,
		conversationId,
		messageId,
		copyUrl,
		showToast,
	]);

	const onOpenLink = useCallback(() => {
		if (!resolvedUrl) return;
		window.open(resolvedUrl, "_blank", "noopener,noreferrer");
	}, [resolvedUrl]);

	return (
		<div className={cn("relative", className)}>
			<div
				className="flex flex-col gap-2 border-t border-border-subtle bg-surface-elevated/45 px-3 py-3 backdrop-blur-sm sm:px-4"
				role="region"
				aria-label="Share this answer"
			>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						disabled={!canShare || loading}
						onClick={() => void onShareResult()}
						className={cn(
							"inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-surface shadow-float",
							"hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
							"disabled:pointer-events-none disabled:opacity-45",
						)}
					>
						{loading ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Share2 className="size-4" aria-hidden />
						)}
						{loading ? "Sharing…" : "Share result"}
					</button>

					<button
						type="button"
						disabled={!resolvedUrl}
						onClick={onOpenLink}
						className={cn(
							"inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border-subtle bg-surface-elevated/70 px-4 py-2 text-sm font-medium text-content-secondary",
							"hover:border-accent/35 hover:bg-surface-elevated hover:text-content-primary",
							"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
							"disabled:pointer-events-none disabled:opacity-40",
						)}
					>
						<ExternalLink className="size-4" aria-hidden />
						Open link
					</button>
				</div>

				{status === "unauthenticated" ? (
					<p className="text-xs text-content-tertiary">
						Sign in to create shareable research pages.
					</p>
				) : null}

				{error ? (
					<p className="text-xs font-medium text-red-200" role="alert">
						{error}
					</p>
				) : null}
			</div>

			{toast ? (
				<div
					className="pointer-events-none fixed left-1/2 z-[100] -translate-x-1/2 rounded-xl border border-border-subtle bg-surface-elevated/95 px-4 py-2.5 text-sm font-medium text-content-primary shadow-panel backdrop-blur-md"
					style={{
						bottom: "max(calc(env(safe-area-inset-bottom, 0px) + 5.5rem), 5.5rem)",
					}}
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					Link copied
				</div>
			) : null}
		</div>
	);
}
