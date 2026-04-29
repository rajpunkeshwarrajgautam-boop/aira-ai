"use client";

import { Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/cn";

export function CopyShareLinkButton({
	url,
	className,
}: {
	readonly url: string;
	readonly className?: string;
}) {
	const [copied, setCopied] = useState(false);

	const label = useMemo(() => (copied ? "Copied" : "Copy link"), [copied]);

	async function onCopy() {
		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error("Clipboard API unavailable.");
			}
			await navigator.clipboard.writeText(url);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1200);
		} catch {
			// Fallback: prompt keeps the user in control and avoids exposing extra data.
			window.prompt("Copy this share link:", url);
		}
	}

	return (
		<button
			type="button"
			onClick={() => void onCopy()}
			className={cn(
				"inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-elevated/70 px-3 py-2 text-xs font-medium text-content-secondary shadow-float backdrop-blur-md",
				"hover:border-accent/35 hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
				"disabled:opacity-40 disabled:pointer-events-none",
				className,
			)}
		>
			<Copy className="size-3.5" aria-hidden />
			<span>{label}</span>
		</button>
	);
}

