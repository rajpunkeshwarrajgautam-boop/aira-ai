"use client";

import { ExternalLink } from "lucide-react";
import Image from "next/image";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { cn } from "../lib/cn";

export interface CitationItem {
	readonly index: number;
	readonly url: string;
	readonly title: string;
	readonly publishedDate: string | null;
	readonly rankingScore: number;
	/** Short preview from retrieved excerpt (optional for legacy stored citations). */
	readonly excerpt?: string;
}

export interface CitationCardsProps {
	readonly citations: readonly CitationItem[];
	readonly className?: string;
}

function hostnameFromUrl(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function formatDate(iso: string | null): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return new Intl.DateTimeFormat(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(d);
}

function previewSnippet(text: string | undefined, maxChars: number): string | null {
	if (!text) return null;
	const t = text.replace(/\s+/g, " ").trim();
	if (!t) return null;
	if (t.length <= maxChars) return t;
	return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function CitationCards({ citations, className }: CitationCardsProps) {
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
			<CardHeader className="flex flex-row items-center justify-between gap-3 px-6 py-5 pb-2">
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
			</CardHeader>
			<CardContent className="px-6 pb-6 pt-3">
				<ul className="grid gap-3 sm:grid-cols-2">
					{citations.map((c) => {
						const host = hostnameFromUrl(c.url);
						const favicon = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`;
						const dateLabel = formatDate(c.publishedDate);
						const snippet = previewSnippet(c.excerpt, 220);

						return (
							<li key={`${c.index}-${c.url}`}>
								<a
									href={c.url}
									target="_blank"
									rel="noopener noreferrer"
									className={cn(
										"group relative flex flex-col gap-3 rounded-2xl border border-border-subtle/50 bg-surface-inset/50 p-4 shadow-sm ring-1 ring-white/30 transition-all duration-300 ease-out backdrop-blur-sm md:backdrop-blur-md",
										"hover:border-accent/45 hover:bg-surface-elevated/90 hover:shadow-panel hover:-translate-y-0.5",
									)}
								>
									<div className="flex items-center justify-between gap-3">
										<div className="relative size-10 shrink-0">
											<div className="absolute inset-0 animate-pulse rounded-lg bg-accent/5" />
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
											<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent ring-1 ring-accent/20 transition-colors group-hover:bg-accent group-hover:text-white">
												{c.index}
											</span>
											<ExternalLink className="size-3 text-content-tertiary opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100" />
										</div>
									</div>
									
									<div className="flex flex-1 flex-col justify-between">
										<p className="line-clamp-2 text-[13px] font-semibold leading-relaxed text-content-primary transition-colors group-hover:text-accent">
											{c.title}
										</p>
										{snippet ? (
											<p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-content-tertiary/90">
												{snippet}
											</p>
										) : null}
										<div className="mt-3 flex items-center justify-between gap-2 border-t border-border-subtle/20 pt-3">
											<p className="truncate text-[11px] font-medium text-content-tertiary">
												{host}
											</p>
											{dateLabel ? (
												<p className="shrink-0 text-[10px] font-bold tabular-nums text-content-tertiary/60">
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
