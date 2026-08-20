"use client";

import { ArrowUp, Loader2, Paperclip, Plus } from "lucide-react";
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
	{ value, onChange, onSubmit, disabled, isBusy, placeholder = "How can I help you today?", className },
	ref,
) {
	const taRef = useRef<HTMLTextAreaElement>(null);
	const resize = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(Math.max(el.scrollHeight, 54), 200)}px`;
	}, []);

	useEffect(() => {
		resize();
	}, [value, resize]);

	const busy = Boolean(disabled || isBusy);
	const effectivePlaceholder =
		placeholder === "Ask anything..." ? "How can I help you today?" : placeholder;

	const handleSubmit = useCallback(() => {
		if (value.trim() && !busy) onSubmit();
	}, [value, busy, onSubmit]);

	useImperativeHandle(ref, () => ({
		focus: () => taRef.current?.focus(),
		submit: handleSubmit,
	}));

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				handleSubmit();
			}}
			className={cn("mx-auto w-full max-w-[672px]", className)}
			aria-label="Ask AiraAI"
		>
			<div
				className={cn(
					"aira-enterprise-composer overflow-hidden border",
					busy && "opacity-90",
				)}
			>
				<label htmlFor="search-query" className="sr-only">
					Query
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
					placeholder={effectivePlaceholder}
					className="aira-reference-textarea min-h-[66px] w-full resize-none bg-transparent px-4 pb-2 pt-4 text-[15px] leading-6 text-content-primary outline-none placeholder:text-content-tertiary disabled:cursor-not-allowed sm:px-[18px]"
				/>

				<div className="aira-reference-composer-toolbar flex items-center justify-between gap-3 px-3 pb-3 sm:px-[14px]">
					<div className="flex min-w-0 items-center gap-1">
						<button
							type="button"
							className="aira-reference-context-button flex size-8 shrink-0 items-center justify-center rounded-full text-content-secondary transition"
							aria-label="Add context"
						>
							<Plus className="size-[17px]" strokeWidth={1.8} aria-hidden />
						</button>
						<span className="aira-reference-context-label hidden min-w-0 items-center gap-1.5 px-1.5 text-[12px] text-content-tertiary sm:flex">
							<Paperclip className="size-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
							<span className="truncate">Add context</span>
						</span>
					</div>
					<Button
						type="submit"
						disabled={busy || !value.trim()}
						size="icon"
						className="aira-reference-send-button size-8 rounded-full border-0 shadow-none transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-100"
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
			<p className="aira-reference-input-hint mt-2 text-center text-[10px] text-content-tertiary/80">
				Enter to send · Shift+Enter for a new line
			</p>
		</form>
	);
});
