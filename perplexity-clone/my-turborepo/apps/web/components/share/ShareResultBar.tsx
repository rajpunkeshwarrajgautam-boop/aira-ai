import { Check, ExternalLink, Globe, Loader2, Share2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { logProductEvent } from "@/lib/log-product-event";

export function ShareResultBar({
	conversationId,
	messageId,
	className,
	onGuestClick,
}: {
	readonly conversationId?: string;
	readonly messageId?: string;
	readonly className?: string;
	readonly onGuestClick?: () => void;
}) {
	const { status } = useSession();
	const isAuthed = status === "authenticated";
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
	const [toast, setToast] = useState(false);
	const toastHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const hasValidIds = (conversationId?.length ?? 0) > 0 && (messageId?.length ?? 0) > 0;
	const canShare = isAuthed ? hasValidIds : true;

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

		if (!isAuthed) {
			try {
				logProductEvent({
					event: "share_clicked",
					surface: "share_bar_guest",
					userType: "guest",
					conversationId,
					messageId,
				});
			} catch {
				// ignore
			}
			onGuestClick?.();
			return;
		}

		// Strictly authenticated path below
		if (!hasValidIds) {
			setError("Cannot share this research turn.");
			return;
		}

		try {
			logProductEvent({
				event: "share_clicked",
				surface: "share_bar",
				userType: "signed_in",
				conversationId,
				messageId,
			});
		} catch {
			// ignore analytics
		}
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
		isAuthed,
		hasValidIds,
		loading,
		resolvedUrl,
		conversationId,
		messageId,
		copyUrl,
		showToast,
		onGuestClick,
	]);

	const onOpenLink = useCallback(() => {
		if (!resolvedUrl) return;
		window.open(resolvedUrl, "_blank", "noopener,noreferrer");
	}, [resolvedUrl]);

	return (
		<div className={cn("relative", className)}>
			<div
				className="flex flex-col gap-2 border-t border-border-subtle bg-surface-elevated/45 px-3 py-4 backdrop-blur-sm sm:px-4"
				role="region"
				aria-label="Share this answer"
			>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						disabled={!canShare || loading}
						onClick={() => void onShareResult()}
						className={cn(
							"inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition shadow-float",
							!isAuthed
								? "bg-surface-elevated/80 border border-border-subtle text-content-primary hover:bg-surface-elevated"
								: resolvedUrl
									? "bg-accent/10 border border-accent/30 text-accent hover:bg-accent/15"
									: "bg-accent text-surface hover:bg-accent/90",
							"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
							"disabled:pointer-events-none disabled:opacity-45",
						)}
					>
						{loading ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : !isAuthed ? (
							<Share2 className="size-4" aria-hidden />
						) : resolvedUrl ? (
							<Check className="size-4" aria-hidden />
						) : (
							<Share2 className="size-4" aria-hidden />
						)}
						{loading
							? "Sharing…"
							: !isAuthed
								? "Sign in to share"
								: resolvedUrl
									? "Copy link"
									: "Share"}
					</button>

					{resolvedUrl ? (
						<button
							type="button"
							onClick={onOpenLink}
							className={cn(
								"inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border-subtle bg-surface-elevated/70 px-4 py-2 text-sm font-medium text-content-secondary transition",
								"hover:border-accent/35 hover:bg-surface-elevated hover:text-content-primary",
								"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
							)}
						>
							<ExternalLink className="size-4" aria-hidden />
							Open link
						</button>
					) : null}

					{isAuthed && !resolvedUrl && !loading ? (
						<div className="ml-1 hidden items-center gap-1.5 text-xs text-content-tertiary sm:flex">
							<Globe className="size-3.5" aria-hidden />
							<span>Anyone with the link can view</span>
						</div>
					) : null}
				</div>

				{!isAuthed ? (
					<p className="text-xs text-content-tertiary">
						Create a public link to share this research with others.
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
