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
				"aira-gradient-frame aira-composer relative rounded-[26px]",
				busy && "opacity-90",
			)}>
				<div className="relative overflow-hidden rounded-[25px] bg-white/95 backdrop-blur-xl">
					<div className="flex items-center justify-between gap-3 border-b border-border-subtle/65 px-5 py-3">
						<div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-content-tertiary">
							<span className="relative flex size-6 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/10">
								<Sparkles className="size-3.5" aria-hidden />
								<span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.75)]" aria-hidden />
							</span>
							Ask Aira
						</div>
						<span className="hidden rounded-full bg-surface-inset/80 px-2.5 py-1 text-[10px] font-medium text-content-tertiary ring-1 ring-border-subtle/70 sm:inline">
							Research · reason · remember
						</span>
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
							className="aira-shine-button size-10 rounded-full bg-content-primary text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)] transition hover:scale-[1.04] hover:bg-accent active:scale-95 disabled:pointer-events-none disabled:scale-100 disabled:bg-surface-inset disabled:text-content-tertiary disabled:opacity-100"
							aria-label="Send to AiraAI"
						>
							{isBusy ? <Loader2 className="size-4.5 animate-spin" aria-hidden /> : <ArrowUp className="size-4.5" aria-hidden />}
						</Button>
					</div>
				</div>
			</div>
		</form>
	);
});
