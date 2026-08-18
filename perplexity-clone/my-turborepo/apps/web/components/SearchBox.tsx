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
		el.style.height = `${Math.min(Math.max(el.scrollHeight, 90), 220)}px`;
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
			<div className={cn("aira-composer-shell", busy && "opacity-90")}>
				<div className="relative overflow-hidden rounded-[24px] bg-white">
					<div className="pointer-events-none absolute -right-12 -top-14 size-36 rounded-full bg-[radial-gradient(circle,hsl(var(--accent-violet)/0.10),transparent_68%)]" aria-hidden />
					<div className="pointer-events-none absolute -left-10 bottom-2 size-28 rounded-full bg-[radial-gradient(circle,hsl(var(--accent-cyan)/0.08),transparent_70%)]" aria-hidden />

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
						className="relative z-[1] min-h-[118px] w-full resize-none bg-transparent px-5 pb-[68px] pt-5 text-[16px] leading-7 text-content-primary outline-none placeholder:text-content-tertiary disabled:cursor-not-allowed sm:px-6 sm:pt-6 sm:text-[17px]"
					/>

					<div className="absolute bottom-3.5 left-4 right-3.5 z-[2] flex items-center justify-between gap-3 sm:left-5">
						<div className="flex min-w-0 items-center gap-2 text-xs text-content-tertiary">
							<span className="aira-icon-pop flex size-8 shrink-0 items-center justify-center rounded-full">
								<Sparkles className="size-3.5" aria-hidden />
							</span>
							<span className="hidden sm:inline">Research · reason · cite</span>
							<span className="sm:hidden">Ask Aira</span>
						</div>
						<Button
							type="submit"
							disabled={busy || !value.trim()}
							size="icon"
							className="aira-shine-button size-10 rounded-full border-0 bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))] text-white shadow-[0_8px_24px_hsl(var(--accent)/0.26)] transition hover:scale-[1.05] hover:shadow-[0_10px_30px_hsl(var(--accent)/0.34)] active:scale-95 disabled:pointer-events-none disabled:scale-100 disabled:bg-surface-inset disabled:text-content-tertiary disabled:shadow-none disabled:opacity-100"
							aria-label="Send to AiraAI"
						>
							{isBusy ? <Loader2 className="size-4.5 animate-spin" aria-hidden /> : <ArrowUp className="size-4.5" aria-hidden />}
						</Button>
					</div>
				</div>
			</div>
			<p className="mt-2.5 hidden text-center text-[11px] text-content-tertiary sm:block">Enter to send · Shift+Enter for a new line</p>
		</form>
	);
});
