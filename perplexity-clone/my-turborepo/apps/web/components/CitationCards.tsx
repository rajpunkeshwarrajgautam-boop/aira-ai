"use client";

import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { useId } from "react";

import { cn } from "../lib/cn";
import { logProductEvent } from "../lib/log-product-event";

export interface CitationItem {
	readonly index: number;
	readonly url: string;
	readonly title: string;
	readonly publishedDate: string | null;
	readonly rankingScore: number;
	/** Short preview from retrieved excerpt (optional for legacy stored citations). */
	readonly excerpt?: string;
	/** Domain heuristic only; omitted on older stored citations. */
	readonly sourceQuality?: string;
}

export interface CitationCardsProps {
	readonly citations: readonly CitationItem[];
	readonly className?: string;
	readonly citedIndices?: number[];
}

export function hostnameFromUrl(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

export function formatDate(iso: string | null): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return new Intl.DateTimeFormat(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(d);
}

export function previewSnippet(text: unknown, maxChars: number): string | null {
	if (typeof text !== "string") return null;
	if (text.includes("[object Object]")) return "Open source to verify details.";

	// Strip leading markdown headers: # title -> title
	let cleanText = text.replace(/^#+\s+/, "");
	// Strip markdown links: [text](url) -> text (with spaces around to preserve word boundaries)
	cleanText = cleanText.replace(/\[([^\]]+)\]\([^)]+\)/g, " $1 ");
	
	// Collapse repeated adjacent phrases if exactly repeated: "was once confined was once confined" -> "was once confined"
	cleanText = cleanText.replace(/\b(\w+(?:\s+\w+)+)\s+\1\b/g, "$1");
	
	// Clean repeated [...] artifacts more aggressively: replace repeated [...] with "… "
	cleanText = cleanText.replace(/\[\.{2,}\]/g, "… ");
	// Remove weird footnote fragments like "plant.38[...]" -> "plant..."
	cleanText = cleanText.replace(/(\w+)\.\d+\[\.{2,}\]/g, "$1...");
	
	// Remove leading punctuation/fragments
	cleanText = cleanText.replace(/^[.,;:!?—…\s]+/, "");
	
	let t = cleanText.replace(/[\s\u00A0]+/g, " ").trim();
	if (!t) return null;
	
	// If snippet starts mid-word or with a lowercase fragment and later contains a cleaner sentence start, prefer the cleaner start if safe
	let hasCleanStart = true;
	if (t.length > 0 && /^[a-z]/.test(t)) {
		hasCleanStart = false;
		const match = t.match(/[.!?]\s+([A-Z])/);
		if (match && match.index !== undefined) {
			const candidate = t.slice(match.index + match[0].length - 1);
			if (candidate.length > 30) {
				t = candidate;
				hasCleanStart = true;
			}
		}
	}
	
	// Heuristics for bad snippets
	const tooManyEllipses = (t.match(/…/g) || []).length > 3 || (t.match(/\.\.\./g) || []).length > 2;
	const tooShort = t.length < 20;
	// Simple repeated phrase check after cleanup
	const hasRepeatedPhrase = /\b(\w+(?:\s+\w+)+)\s+\1\b/.test(t);
	
	const isBad = tooManyEllipses || tooShort || (!hasCleanStart && t.length < 50) || hasRepeatedPhrase;
	
	if (isBad) {
		return "Open source to verify details.";
	}
	
	if (t.length <= maxChars) return t;
	return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function cleanTitle(title: unknown, url: string, snippet?: string | null): string {
	if (typeof title !== "string") return hostnameFromUrl(url);
	let t = title.trim().replace(/\\"/g, '"');
	if (t.includes("[object Object]")) return hostnameFromUrl(url);
	// Strip leading markdown headers
	t = t.replace(/^#+\s+/, "");
	
	const host = hostnameFromUrl(url);
	const isBareDomain = t === host || t === `www.${host}` || t.startsWith("http://") || t.startsWith("https://") || t.includes("://");
	
	if (isBareDomain) {
		if (snippet && snippet.trim().length > 10) {
			const dotIdx = snippet.indexOf(".");
			const phrase = dotIdx > 10 ? snippet.slice(0, dotIdx).trim() : snippet.slice(0, 50).trim();
			if (phrase.length > 10) {
				return phrase;
			}
		}
		return host;
	}
	return t;
}

export function CitationCards({ citations, className, citedIndices }: CitationCardsProps) {
	const headingId = useId();
	if (citations.length === 0) return null;
	const directlyCitedCount = citedIndices
		? citations.filter((citation) => citedIndices.includes(citation.index)).length
		: citations.length;

	return (
		<section className={cn("aira-sources scroll-mt-6", className)} aria-labelledby={headingId}>
			<header className="aira-sources-header flex flex-col gap-1 border-b border-border-subtle/70 pb-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
				<div>
					<h3 id={headingId} className="text-[13px] font-semibold tracking-[-0.01em] text-content-primary">
						Sources
					</h3>
					<p className="mt-1 text-[11px] leading-5 text-content-tertiary">
						{directlyCitedCount === citations.length
							? `${citations.length} source${citations.length === 1 ? "" : "s"} cited in this answer.`
							: `${directlyCitedCount} cited · ${citations.length - directlyCitedCount} retrieved for context.`}
					</p>
				</div>
				<span className="text-[11px] tabular-nums text-content-tertiary">
					{citations.length} retrieved
				</span>
			</header>
			<ul className="aira-source-grid grid gap-x-5 lg:grid-cols-2">
				{citations.map((c) => {
					const host = hostnameFromUrl(c.url);
					const favicon = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`;
					const dateLabel = formatDate(c.publishedDate);
					const snippet = previewSnippet(c.excerpt, 220);
					const isCited = citedIndices ? citedIndices.includes(c.index) : true;

					return (
						<li key={`${c.index}-${c.url}`} id={`source-${c.index}`} className="scroll-mt-24 border-b border-border-subtle/60">
							<a
								href={c.url}
								target="_blank"
								rel="noopener noreferrer"
								onClick={() => {
									try {
										logProductEvent({
											event: "source_opened",
											surface: "source_cards",
											citationIndex: c.index,
											sourceDomain: host,
										});
									} catch {
										// ignore analytics
									}
								}}
								className="group grid min-h-[144px] grid-cols-[32px_minmax(0,1fr)_auto] gap-x-3 gap-y-2 py-4 text-left transition-colors duration-150 hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
							>
								<Image src={favicon} alt="" width={32} height={32} className="row-span-2 size-8 rounded-lg bg-surface-elevated object-contain p-1 ring-1 ring-border-subtle/70" unoptimized />
								<div className="min-w-0">
									<p className="line-clamp-2 text-[13px] font-semibold leading-5 text-content-primary transition-colors group-hover:text-accent">
										{cleanTitle(c.title, c.url, snippet)}
									</p>
									<p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-content-tertiary">
										<span className="max-w-[15rem] truncate">{host}</span>
										{dateLabel ? <span className="tabular-nums">{dateLabel}</span> : null}
										{c.sourceQuality && c.sourceQuality !== "Unknown" ? <span>{c.sourceQuality}</span> : null}
									</p>
								</div>
								<span className={cn("inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-semibold", isCited ? "bg-accent/12 text-accent" : "bg-white/[0.04] text-content-tertiary")} title={isCited ? `Citation ${c.index}` : "Retrieved for context; not directly cited"}>
									{isCited ? c.index : "Context"}
								</span>
								{snippet ? <p className="col-span-2 col-start-2 line-clamp-2 text-[11px] leading-5 text-content-tertiary">{snippet}</p> : null}
								<span className="col-span-2 col-start-2 inline-flex items-center gap-1 text-[10px] font-medium text-content-secondary transition-colors group-hover:text-accent">Open source <ExternalLink className="size-3" aria-hidden /></span>
							</a>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
