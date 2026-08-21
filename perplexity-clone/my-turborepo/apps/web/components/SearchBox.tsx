"use client";

import { ArrowUp, Globe2, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

import { cn } from "../lib/cn";
import { Button } from "./ui/button";

export interface SearchBoxProps {
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly onSubmit: () => void;
	readonly disabled?: boolean;
	readonly isBusy?: boolean;
	readonly placeholder?: string;
	readonly className?: string;
}

export type SearchBoxHandle = { focus: () => void; submit: () => void };

export const SearchBox = forwardRef<SearchBoxHandle, SearchBoxProps>(function SearchBox(
	{ value, onChange, onSubmit, disabled, isBusy, placeholder = "Ask anything. AIRA will research, reason, and cite sources…", className },
	ref,
) {
	const taRef = useRef<HTMLTextAreaElement>(null);
	const resize = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), 210)}px`;
	}, []);

	useEffect(() => { resize(); }, [value, resize]);
	const busy = Boolean(disabled || isBusy);
	const handleSubmit = useCallback(() => {
		if (value.trim() && !busy) onSubmit();
	}, [value, busy, onSubmit]);
	useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus(), submit: handleSubmit }));

	return (
		<form
			onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}
			className={cn("mx-auto w-full max-w-[820px]", className)}
			aria-label="Ask AiraAI"
		>
			<div className={cn("aira-enterprise-composer overflow-hidden rounded-2xl border border-border-subtle bg-surface-elevated", busy && "opacity-90")}>
				<div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
					<div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-content-tertiary">
						<span className="flex size-6 items-center justify-center rounded-lg border border-border-subtle bg-surface-inset text-content-secondary" aria-hidden>
							<Sparkles className="size-3.5" strokeWidth={1.8} />
						</span>
						Ask AIRA
					</div>
					<span className="hidden rounded-full border border-border-subtle bg-surface-inset px-2.5 py-1 text-[10px] font-medium text-content-tertiary sm:inline-flex">
						Grounded research
					</span>
				</div>

				<label htmlFor="search-query" className="sr-only">Query</label>
				<textarea
					ref={taRef}
					id="search-query"
					name="query"
					rows={1}
					value={value}
					disabled={busy}
					onChange={(event) => { onChange(event.target.value); resize(); }}
					onInput={resize}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							handleSubmit();
						}
					}}
					placeholder={placeholder}
					className="min-h-[82px] w-full resize-none bg-transparent px-4 pb-3 pt-3 text-[15px] leading-7 text-content-primary outline-none placeholder:text-content-tertiary/80 disabled:cursor-not-allowed sm:px-5 sm:text-[16px]"
				/>

				<div className="flex items-center justify-between gap-3 border-t border-border-subtle/80 px-3 py-3 sm:px-4">
					<div className="flex min-w-0 items-center gap-2 overflow-hidden">
						<span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-inset px-2.5 py-1.5 text-[11px] font-medium text-content-secondary">
							<Globe2 className="size-3.5" strokeWidth={1.8} aria-hidden />
							Live web
						</span>
						<span className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-surface-inset px-2.5 py-1.5 text-[11px] font-medium text-content-secondary sm:inline-flex">
							<ShieldCheck className="size-3.5" strokeWidth={1.8} aria-hidden />
							Citations
						</span>
						<span className="hidden truncate text-[11px] text-content-tertiary md:block">Enter to send · Shift+Enter for a new line</span>
					</div>
					<Button
						type="submit"
						disabled={busy || !value.trim()}
						size="icon"
						className="size-10 shrink-0 rounded-xl border-0 bg-content-primary text-white shadow-[0_6px_18px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:bg-content-primary/90 active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:bg-surface-inset disabled:text-content-tertiary disabled:shadow-none"
						aria-label="Send to AIRA AI"
					>
						{isBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" strokeWidth={2.1} aria-hidden />}
					</Button>
				</div>
			</div>
		</form>
	);
});
