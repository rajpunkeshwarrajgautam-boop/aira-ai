import React, { useState, useRef, useEffect } from "react";
import type { Components } from "react-markdown";
import { ExternalLink } from "lucide-react";
import { cn } from "../lib/cn";
import { type CitationItem, hostnameFromUrl, cleanTitle, previewSnippet } from "./CitationCards";

function CitationPreviewPopover({ citation, href, children, ...props }: any) {
	const [open, setOpen] = useState(false);
	const closeTimeout = useRef<any>(null);

	const handleMouseEnter = () => {
		clearTimeout(closeTimeout.current);
		setOpen(true);
	};

	const handleMouseLeave = () => {
		closeTimeout.current = setTimeout(() => setOpen(false), 200);
	};

	const handleFocus = () => setOpen(true);
	const handleBlur = () => setOpen(false);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && open) {
				setOpen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [open]);

	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault();
		const id = href.slice(1);
		const el = document.getElementById(id);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			window.history.pushState(null, "", href);
		}
	};

	if (!citation) {
		return (
			<a href={href} className="citation-link relative after:absolute after:-inset-y-4 after:-inset-x-2 after:content-['']" onClick={handleClick} {...props}>
				{children}
			</a>
		);
	}

	const title = cleanTitle(citation.title, citation.url, citation.excerpt);
	const host = hostnameFromUrl(citation.url);
	const snippet = previewSnippet(citation.excerpt, 120);

	const showBadge = citation.sourceQuality && citation.sourceQuality !== "Unknown";

	return (
		<span
			className="relative inline-block"
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<a
				href={href}
				className="citation-link relative after:absolute after:-inset-y-4 after:-inset-x-2 after:content-['']"
				onClick={handleClick}
				onFocus={handleFocus}
				onBlur={handleBlur}
				{...props}
			>
				{children}
			</a>
			{open ? (
				<span
					className="absolute bottom-full left-1/2 z-50 mb-2 flex w-72 -translate-x-1/2 flex-col rounded-2xl border border-border-subtle/60 bg-surface-elevated/95 p-4 shadow-glass backdrop-blur-md"
					role="tooltip"
				>
					<span className="mb-2 flex items-start gap-3">
						<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent ring-1 ring-accent/20">
							{citation.index}
						</span>
						<span className="min-w-0 flex-1 block">
							<span className="block truncate text-sm font-semibold text-content-primary">
								{title}
							</span>
							<span className="mt-0.5 flex items-center gap-2 text-[11px] text-content-secondary">
								<span className="truncate">{host}</span>
								{showBadge ? (
									<span
										className="max-w-[7.5rem] truncate rounded-md bg-surface-elevated/90 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-content-tertiary/80 ring-1 ring-border-subtle/40"
										title={citation.sourceQuality}
									>
										{citation.sourceQuality}
									</span>
								) : null}
							</span>
						</span>
					</span>
					{snippet ? (
						<span className="mb-3 block line-clamp-3 text-xs leading-relaxed text-content-secondary">
							{snippet}
						</span>
					) : null}
					<a
						href={citation.url}
						target="_blank"
						rel="noopener noreferrer"
						className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-surface-inset py-2 text-xs font-semibold text-content-primary transition hover:bg-surface-inset/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
					>
						Open source
						<ExternalLink className="size-3" />
					</a>
				</span>
			) : null}
		</span>
	);
}

/**
 * Creates markdown components with access to citations for rich inline previews.
 */
export function getMarkdownComponents(citations: readonly CitationItem[] = []): Partial<Components> {
	return {
		a: ({ href, children, ...props }) => {
			if (href && /^https?:\/\//i.test(href)) {
				return (
					<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
						{children}
					</a>
				);
			}
			if (href && href.startsWith("#source-")) {
				const index = parseInt(href.slice(8), 10);
				const citation = citations.find((c) => c.index === index);

				return (
					<CitationPreviewPopover citation={citation} href={href} {...props}>
						{children}
					</CitationPreviewPopover>
				);
			}
			return (
				<a href={href} {...props}>
					{children}
				</a>
			);
		},
	};
}


