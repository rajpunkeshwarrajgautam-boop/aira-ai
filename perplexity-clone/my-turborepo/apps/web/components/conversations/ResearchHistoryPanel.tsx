"use client";

import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/cn";

export interface ResearchHistoryRow {
	readonly id: string;
	readonly conversationId: string | null;
	readonly query: string;
	readonly createdAt: string;
	readonly citationCount: number;
}

export function ResearchHistoryPanel({
	items,
	onSelectItem,
	className,
}: {
	readonly items: readonly ResearchHistoryRow[];
	readonly onSelectItem?: (conversationId: string) => void;
	readonly className?: string;
}) {
	const [open, setOpen] = useState(false);

	const content = useMemo(() => items.slice(0, 10), [items]);

	if (items.length === 0) return null;

	return (
		<section
			className={cn(
				"rounded-2xl border border-border-subtle bg-surface-elevated/30 p-4 shadow-panel backdrop-blur-md",
				className,
			)}
			aria-label="Research history"
		>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center justify-between gap-4"
				aria-expanded={open}
			>
				<div className="min-w-0 text-left">
					<h2 className="text-sm font-semibold text-content-primary">Research history</h2>
					<p className="text-xs text-content-tertiary">
						{content.length} recent research queries
					</p>
				</div>
				<ChevronDown
					className={cn("size-4 shrink-0 text-content-tertiary transition-transform", open && "rotate-180")}
					aria-hidden
				/>
			</button>

			{open ? (
				<ul className="mt-3 space-y-2">
					{content.map((r) => (
						<li key={r.id}>
							<button
								type="button"
								onClick={() => r.conversationId && onSelectItem?.(r.conversationId)}
								disabled={!r.conversationId}
								className={cn(
									"flex w-full flex-col items-start gap-1 rounded-xl border border-border-subtle bg-surface-inset/50 p-3 text-left transition-all",
									r.conversationId ? "hover:border-accent/40 hover:bg-accent/5 hover:shadow-sm active:scale-[0.98]" : "cursor-default opacity-80",
								)}
							>
								<p className="truncate text-sm font-medium text-content-primary">{r.query}</p>
								<p className="mt-1 text-[11px] text-content-tertiary">
									{new Date(r.createdAt).toLocaleString()}
									{r.citationCount > 0 ? ` · ${r.citationCount} citations` : ""}
								</p>
							</button>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}

