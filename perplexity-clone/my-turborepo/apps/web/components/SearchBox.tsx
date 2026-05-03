"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

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

export type SearchBoxHandle = {
	focus: () => void;
	/** Programmatic submit (same as pressing Enter when non-empty). */
	submit: () => void;
};

export const SearchBox = forwardRef<SearchBoxHandle, SearchBoxProps>(function SearchBox(
	{
		value,
		onChange,
		onSubmit,
		disabled,
		isBusy,
		placeholder = "Ask anything…",
		className,
	},
	ref,
) {
	const taRef = useRef<HTMLTextAreaElement>(null);

	const resize = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	}, []);

	const busy = Boolean(disabled || isBusy);

	const handleSubmit = useCallback(() => {
		if (!value.trim() || busy) return;
		onSubmit();
	}, [value, busy, onSubmit]);

	useImperativeHandle(ref, () => ({
		focus: () => taRef.current?.focus(),
		submit: () => {
			handleSubmit();
		},
	}));

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
			className={cn("w-full mx-auto max-w-3xl", className)}
			aria-label="Search"
		>
			<div
				className={cn(
					"relative overflow-hidden rounded-2xl border border-border-subtle bg-surface-elevated shadow-panel transition-all duration-300",
					"focus-within:border-accent/40 focus-within:shadow-[0_0_0_4px_hsl(var(--accent)/0.15),0_8px_32px_-4px_hsl(0_0%_0%_/_0.08)]",
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
					onChange={(e) => {
						onChange(e.target.value);
						resize();
					}}
					onInput={resize}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					className={cn(
						"relative z-[1] min-h-[60px] w-full resize-none bg-transparent px-5 pb-14 pr-16 pt-5 text-[16px] leading-relaxed text-content-primary placeholder:text-content-tertiary focus:outline-none disabled:cursor-not-allowed",
					)}
				/>
				<div className="absolute bottom-2 right-2 z-[1] flex items-center gap-2">
					<span className="hidden max-w-[min(100%,14rem)] text-right text-[11px] leading-snug text-content-tertiary sm:inline">
						<span className="text-content-tertiary/90">Press Enter to search</span>
						<span className="mx-1">·</span>
						<span className="rounded-md bg-surface-inset px-1.5 py-0.5 font-mono text-[10px] text-content-tertiary">
							Enter
						</span>
						<span className="mx-1">·</span>
						<span className="text-content-tertiary/80">Shift+Enter new line</span>
					</span>
					<Button
						type="submit"
						disabled={busy || !value.trim()}
						size="icon"
						className="size-10 rounded-xl"
						aria-label="Submit question"
					>
						{isBusy ? (
							<Loader2 className="size-5 animate-spin text-white" aria-hidden />
						) : (
							<ArrowUp className="size-5 text-white" aria-hidden />
						)}
					</Button>
				</div>
			</div>
		</form>
	);
});
