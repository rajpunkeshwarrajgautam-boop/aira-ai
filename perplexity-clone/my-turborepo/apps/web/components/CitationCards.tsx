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

export function CitationCards({ citations, className }: CitationCardsProps) {
	if (citations.length === 0) return null;

	return (
		<Card
			className={cn(
				"scroll-mt-6 overflow-hidden rounded-3xl border-border-subtle bg-surface-elevated/70 shadow-float backdrop-blur-xl",
				className,
			)}
			aria-label="Sources"
		>
			<CardHeader className="flex flex-row items-center justify-between gap-3 px-6 py-5 pb-2">
				<div className="flex items-center gap-2.5">
					<div className="flex size-6 items-center justify-center rounded-full bg-accent/10">
						<div className="size-2 rounded-full bg-accent animate-pulse" />
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

						return (
							<li key={`${c.index}-${c.url}`}>
								<a
									href={c.url}
									target="_blank"
									rel="noopener noreferrer"
									className={cn(
										"group relative flex flex-col gap-3 rounded-2xl border border-border-subtle/30 bg-surface-inset/40 p-4 transition-all duration-300 ease-out",
										"hover:border-accent/40 hover:bg-surface-inset/80 hover:shadow-panel hover:-translate-y-0.5",
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
