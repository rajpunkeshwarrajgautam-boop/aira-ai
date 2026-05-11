"use client";

import { ExternalLink } from "lucide-react";
import Image from "next/image";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
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

export function previewSnippet(text: string | undefined, maxChars: number): string | null {
	if (!text) return null;
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

export function cleanTitle(title: string, url: string, snippet?: string | null): string {
	let t = title.trim().replace(/\\"/g, '"');
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
	if (citations.length === 0) return null;

	return (
		<Card
			className={cn(
				"scroll-mt-6 overflow-hidden rounded-3xl border-border-subtle/80 bg-surface-elevated/75 shadow-float ring-1 ring-white/45 backdrop-blur-sm md:backdrop-blur-xl",
				className,
			)}
			aria-label="Sources"
		>
			<div className="h-0.5 w-full bg-gradient-to-r from-accent/0 via-accent/50 to-accent/0" aria-hidden />
			<CardHeader className="flex flex-col gap-1 px-6 py-5 pb-2">
				<div className="flex flex-row items-center justify-between gap-3">
					<div className="flex items-center gap-2.5">
						<div className="flex size-7 items-center justify-center rounded-xl bg-accent/12 ring-1 ring-accent/20">
							<div className="size-2 rounded-full bg-accent animate-pulse shadow-[0_0_8px_hsl(var(--accent)/0.5)]" />
						</div>
						<CardTitle className="text-[11px] font-bold uppercase tracking-[0.2em] text-content-tertiary/80">
							Sources Retrieved
						</CardTitle>
					</div>
					<span className="rounded-full bg-surface-inset/80 px-3 py-1 text-[11px] font-bold tabular-nums text-accent ring-1 ring-border-subtle/50">
						{citations.length}
					</span>
				</div>
				{citedIndices && citedIndices.length < citations.length && (
					<p className="text-[11px] text-content-tertiary mt-1">
						Some sources were retrieved for context but not directly cited.
					</p>
				)}
			</CardHeader>
			<CardContent className="px-6 pb-6 pt-3">
				<ul className="grid gap-3 sm:grid-cols-2">
					{citations.map((c) => {
						const host = hostnameFromUrl(c.url);
						const favicon = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`;
						const dateLabel = formatDate(c.publishedDate);
						const snippet = previewSnippet(c.excerpt, 220);
						const isCited = citedIndices ? citedIndices.includes(c.index) : true;

						return (
							<li key={`${c.index}-${c.url}`} id={`source-${c.index}`} className="scroll-mt-24">
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
									className={cn(
										"group relative flex flex-col gap-3 rounded-2xl border border-border-subtle/50 bg-surface-inset/50 p-4 shadow-sm ring-1 ring-white/30 transition-all duration-300 ease-out backdrop-blur-sm md:backdrop-blur-md",
										"hover:border-accent/45 hover:bg-surface-elevated/90 hover:shadow-panel hover:-translate-y-0.5",
										!isCited && "opacity-75 grayscale-[20%]"
									)}
								>
									<div className="flex items-center justify-between gap-3">
										<div className="relative size-10 shrink-0">
											{isCited && <div className="absolute inset-0 animate-pulse rounded-lg bg-accent/5" />}
											<Image
												src={favicon}
												alt=""
												width={40}
												height={40}
												className="relative size-10 shrink-0 rounded-lg bg-surface-elevated object-contain p-1.5 shadow-sm ring-1 ring-border-subtle/50 transition-transform group-hover:scale-110"
												unoptimized
											/>
										</div>
										<div className="flex flex-col items-end gap-1">
											<div className="flex items-center gap-1.5">
												{!isCited && (
													<span
														className="rounded-md bg-surface-inset/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-content-tertiary ring-1 ring-border-subtle/50"
														title="Retrieved during research but not directly cited in the answer."
														aria-label="Retrieved during research but not directly cited in the answer."
													>
														Not directly cited
													</span>
												)}
												<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent ring-1 ring-accent/20 transition-colors group-hover:bg-accent group-hover:text-white">
													{c.index}
												</span>
											</div>
											{c.sourceQuality && c.sourceQuality !== "Unknown" ? (
												<span
													className="max-w-[7.5rem] truncate rounded-md bg-surface-elevated/90 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-content-tertiary/80 ring-1 ring-border-subtle/40"
													title={c.sourceQuality}
												>
													{c.sourceQuality}
												</span>
											) : null}
											<ExternalLink className="size-3 text-content-tertiary opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100" />
										</div>
									</div>
									
									<div className="flex flex-1 flex-col justify-between">
										<p className="line-clamp-2 text-[13px] font-semibold leading-relaxed text-content-primary transition-colors group-hover:text-accent">
											{cleanTitle(c.title, c.url, snippet)}
										</p>
										{snippet ? (
											<p className="mt-1.5 line-clamp-2 text-[12px] md:text-[11px] leading-snug text-content-tertiary/90">
												{snippet}
											</p>
										) : null}
										<div className="mt-3 flex items-center justify-between gap-2 border-t border-border-subtle/20 pt-3">
											<p className="truncate text-[12px] md:text-[11px] font-medium text-content-tertiary">
												{host}
											</p>
											{dateLabel ? (
												<p className="shrink-0 text-[11px] md:text-[10px] font-bold tabular-nums text-content-tertiary/60">
													{dateLabel}
												</p>
											) : null}
										</div>
									</div>
								</a>
							</li>
						);
					})}
				</ul>
			</CardContent>
		</Card>
	);
}
