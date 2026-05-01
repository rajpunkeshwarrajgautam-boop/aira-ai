"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

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

	useImperativeHandle(ref, () => ({
		focus: () => taRef.current?.focus(),
	}));

	const resize = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	}, []);

	const busy = Boolean(disabled || isBusy);

	const handleSubmit = () => {
		if (!value.trim() || busy) return;
		onSubmit();
	};

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
			className={cn("w-full", className)}
			aria-label="Search"
		>
			<div
				className={cn(
					"relative overflow-hidden rounded-2xl border border-border-subtle bg-surface-elevated/90 shadow-panel backdrop-blur-xl transition-shadow",
					"focus-within:border-accent/40 focus-within:shadow-float focus-within:ring-1 focus-within:ring-accent/25",
					busy && "opacity-90",
				)}
			>
				<div className="pointer-events-none absolute inset-0 bg-noise-soft opacity-[0.35]" aria-hidden />
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
						"relative z-[1] min-h-[52px] w-full resize-none bg-transparent px-4 pb-14 pr-14 pt-4 text-[15px] leading-relaxed text-content-primary placeholder:text-content-tertiary focus:outline-none disabled:cursor-not-allowed",
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
					<button
						type="submit"
						disabled={busy || !value.trim()}
						className={cn(
							"inline-flex size-10 items-center justify-center rounded-xl bg-accent text-surface transition-colors",
							"hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
							"disabled:pointer-events-none disabled:opacity-40",
						)}
						aria-label="Submit question"
					>
						{isBusy ? (
							<Loader2 className="size-5 animate-spin text-white" aria-hidden />
						) : (
							<ArrowUp className="size-5 text-white" aria-hidden />
						)}
					</button>
				</div>
			</div>
		</form>
	);
});
