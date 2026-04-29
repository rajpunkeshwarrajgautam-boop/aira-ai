"use client";

import { ExternalLink } from "lucide-react";
import Image from "next/image";

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
		<section
			className={cn(
				"scroll-mt-6 rounded-2xl border border-border-subtle bg-surface-elevated/80 p-4 shadow-float backdrop-blur-md",
				className,
			)}
			aria-label="Sources"
		>
			<div className="mb-3 flex items-center justify-between gap-3 px-0.5">
				<h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">
					Sources
				</h2>
				<span className="text-xs tabular-nums text-content-tertiary">{citations.length} pages</span>
			</div>
			<ul className="grid gap-2 sm:grid-cols-2">
				{citations.map((c) => {
					const host = hostnameFromUrl(c.url);
					const favicon = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
					const dateLabel = formatDate(c.publishedDate);

					return (
						<li key={`${c.index}-${c.url}`}>
							<a
								href={c.url}
								target="_blank"
								rel="noopener noreferrer"
								className={cn(
									"group flex gap-3 rounded-xl border border-transparent bg-surface-inset/60 p-3 transition-all",
									"hover:border-border hover:bg-surface-inset hover:shadow-float",
								)}
							>
								<Image
									src={favicon}
									alt=""
									width={32}
									height={32}
									className="mt-0.5 size-8 shrink-0 rounded-md bg-surface-elevated ring-1 ring-border-subtle"
									unoptimized
								/>
								<div className="min-w-0 flex-1">
									<div className="flex items-start justify-between gap-2">
										<span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[11px] font-semibold text-accent">
											{c.index}
										</span>
										<ExternalLink className="size-3.5 shrink-0 text-content-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
									</div>
									<p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-content-primary">
										{c.title}
									</p>
									<p className="mt-1 truncate text-xs text-content-tertiary">{host}</p>
									{dateLabel ? (
										<p className="mt-1 text-[11px] tabular-nums text-content-tertiary">{dateLabel}</p>
									) : null}
								</div>
							</a>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
