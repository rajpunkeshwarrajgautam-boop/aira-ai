"use client";

import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

import { Button } from "./ui/button";
import { cn } from "../lib/cn";

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
	{ value, onChange, onSubmit, disabled, isBusy, placeholder = "Ask anything…", className },
	ref,
) {
	const taRef = useRef<HTMLTextAreaElement>(null);
	const resize = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(Math.max(el.scrollHeight, 88), 220)}px`;
	}, []);

	useEffect(() => { resize(); }, [value, resize]);
	const busy = Boolean(disabled || isBusy);
	const handleSubmit = useCallback(() => { if (value.trim() && !busy) onSubmit(); }, [value, busy, onSubmit]);
	useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus(), submit: handleSubmit }));

	return (
		<form
			onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}
			className={cn("mx-auto w-full max-w-[820px]", className)}
			aria-label="Ask AiraAI"
		>
			<div className={cn(
				"aira-card relative overflow-hidden rounded-[24px] bg-white transition-all duration-200",
				"focus-within:border-accent/30 focus-within:shadow-[0_2px_7px_rgba(15,23,42,0.035),0_18px_48px_rgba(15,23,42,0.09)]",
				busy && "opacity-90",
			)}>
				<div className="flex items-center gap-2 border-b border-border-subtle/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.13em] text-content-tertiary">
					<Sparkles className="size-3.5 text-accent" aria-hidden /> Ask Aira
				</div>
				<label htmlFor="search-query" className="sr-only">Query</label>
				<textarea
					ref={taRef}
					id="search-query"
					name="query"
					rows={2}
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
					className="relative z-[1] min-h-[108px] w-full resize-none bg-transparent px-5 pb-16 pt-5 text-[16px] leading-7 text-content-primary outline-none placeholder:text-content-tertiary disabled:cursor-not-allowed sm:text-[17px]"
				/>
				<div className="absolute bottom-3 left-4 right-3 z-[2] flex items-center justify-between gap-3">
					<span className="hidden text-xs text-content-tertiary sm:inline">Enter to send · Shift+Enter for a new line</span>
					<span className="sm:hidden" />
					<Button
						type="submit"
						disabled={busy || !value.trim()}
						size="icon"
						className="size-10 rounded-full bg-content-primary text-white shadow-sm transition hover:scale-[1.03] hover:bg-accent active:scale-95 disabled:pointer-events-none disabled:scale-100 disabled:bg-surface-inset disabled:text-content-tertiary disabled:opacity-100"
						aria-label="Send to AiraAI"
					>
						{isBusy ? <Loader2 className="size-4.5 animate-spin" aria-hidden /> : <ArrowUp className="size-4.5" aria-hidden />}
					</Button>
				</div>
			</div>
		</form>
	);
});
