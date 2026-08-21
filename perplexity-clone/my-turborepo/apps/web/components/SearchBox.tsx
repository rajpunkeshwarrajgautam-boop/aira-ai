"use client";

import { ArrowUp, Loader2, Paperclip, Plus } from "lucide-react";
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
	{ value, onChange, onSubmit, disabled, isBusy, placeholder = "Message AIRA AI…", className },
	ref,
) {
	const taRef = useRef<HTMLTextAreaElement>(null);
	const resize = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 190)}px`;
	}, []);

	useEffect(() => {
		resize();
	}, [value, resize]);

	const busy = Boolean(disabled || isBusy);
	const canSubmit = Boolean(value.trim()) && !busy;
	const handleSubmit = useCallback(() => {
		if (value.trim() && !busy) onSubmit();
	}, [value, busy, onSubmit]);

	useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus(), submit: handleSubmit }));

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				handleSubmit();
			}}
			className={cn("mx-auto w-full max-w-[780px]", className)}
			aria-label="Ask AiraAI"
		>
			<div
				className={cn(
					"aira-enterprise-composer overflow-hidden rounded-xl border border-border-subtle bg-surface-inset shadow-[0_8px_28px_rgba(0,0,0,0.22)]",
					busy && "opacity-90",
				)}
			>
				<label htmlFor="search-query" className="sr-only">
					Message AIRA AI
				</label>
				<textarea
					ref={taRef}
					id="search-query"
					name="query"
					rows={1}
					value={value}
					disabled={busy}
					onChange={(event) => {
						onChange(event.target.value);
						resize();
					}}
					onInput={resize}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							handleSubmit();
						}
					}}
					placeholder={placeholder}
					className="min-h-[70px] w-full resize-none bg-transparent px-4 pb-2 pt-4 text-[14px] leading-6 text-content-primary outline-none placeholder:text-content-tertiary disabled:cursor-not-allowed sm:px-5 sm:text-[15px]"
				/>

				<div className="flex items-center justify-between gap-3 px-3 pb-3 sm:px-4">
					<div className="flex min-w-0 items-center gap-1.5">
						<button
							type="button"
							className="flex size-8 shrink-0 items-center justify-center rounded-lg text-content-tertiary transition hover:bg-surface-elevated hover:text-content-primary"
							aria-label="Add context"
						>
							<Plus className="size-4" strokeWidth={1.8} aria-hidden />
						</button>
						<span className="hidden min-w-0 items-center gap-1.5 text-[11px] text-content-tertiary sm:flex">
							<Paperclip className="size-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
							<span className="truncate">Web research · reasoning · citations</span>
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="hidden text-[10px] text-content-tertiary md:inline" aria-live="polite">
							{isBusy ? "Working…" : canSubmit ? "Ready" : "Ask anything"}
						</span>
						<Button
							type="submit"
							disabled={!canSubmit}
							size="icon"
							className="size-9 rounded-lg border-0 bg-content-primary text-surface shadow-none transition hover:opacity-85 active:scale-[0.98] disabled:pointer-events-none disabled:bg-surface-elevated disabled:text-content-tertiary disabled:opacity-100"
							aria-label="Send to AIRA AI"
						>
							{isBusy ? (
								<Loader2 className="size-4 animate-spin" aria-hidden />
							) : (
								<ArrowUp className="size-4" strokeWidth={2} aria-hidden />
							)}
						</Button>
					</div>
				</div>
			</div>
			<p className="mt-2 hidden text-center text-[10px] text-content-tertiary/80 sm:block">
				Enter to send · Shift+Enter for a new line
			</p>
		</form>
	);
});
