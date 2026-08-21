"use client";

import {
	ArrowUp,
	Bot,
	Command,
	Cpu,
	FileText,
	Globe2,
	Paperclip,
	Plus,
	Square,
	X,
} from "lucide-react";
import Link from "next/link";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";

import { Button } from "./ui/button";
import { cn } from "../lib/cn";

export interface SearchBoxProps {
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly onSubmit: () => void;
	readonly onCancel?: () => void;
	readonly disabled?: boolean;
	readonly isBusy?: boolean;
	readonly placeholder?: string;
	readonly className?: string;
}

export type SearchBoxHandle = { focus: () => void; submit: () => void };

type QuickCommand = {
	readonly command: string;
	readonly label: string;
	readonly description: string;
};

const QUICK_COMMANDS: readonly QuickCommand[] = [
	{ command: "/deep ", label: "Deep Research", description: "Run a longer multi-step investigation" },
	{ command: "/new", label: "New chat", description: "Clear the current thread and start fresh" },
	{ command: "/history", label: "History", description: "Jump to your research history" },
	{ command: "/share", label: "Share", description: "Create a share link for this answer" },
] as const;

export const SearchBox = forwardRef<SearchBoxHandle, SearchBoxProps>(function SearchBox(
	{
		value,
		onChange,
		onSubmit,
		onCancel,
		disabled,
		isBusy,
		placeholder = "Message AIRA AI…",
		className,
	},
	ref,
) {
	const taRef = useRef<HTMLTextAreaElement>(null);
	const [contextMenuOpen, setContextMenuOpen] = useState(false);
	const resize = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 190)}px`;
	}, []);

	useEffect(() => {
		resize();
	}, [value, resize]);

	useEffect(() => {
		if (!contextMenuOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setContextMenuOpen(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [contextMenuOpen]);

	const busy = Boolean(disabled || isBusy);
	const canSubmit = Boolean(value.trim()) && !busy;
	const commandMatches = useMemo(() => {
		if (!value.startsWith("/")) return [];
		const needle = value.slice(1).trim().toLowerCase();
		return QUICK_COMMANDS.filter((item) => {
			if (!needle) return true;
			return `${item.command} ${item.label} ${item.description}`.toLowerCase().includes(needle);
		});
	}, [value]);
	const showCommandMenu = !busy && value.startsWith("/") && !value.includes(" ") && commandMatches.length > 0;

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
			className={cn("relative mx-auto w-full max-w-[780px]", className)}
			aria-label="Ask AiraAI"
		>
			{showCommandMenu ? (
				<div className="absolute bottom-[calc(100%+10px)] left-0 z-40 w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-inset shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
					<div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-content-tertiary">
						<Command className="size-3.5" aria-hidden /> Commands
					</div>
					<div className="p-1.5">
						{commandMatches.map((item) => (
							<button
								key={item.command}
								type="button"
								onClick={() => {
									onChange(item.command);
									requestAnimationFrame(() => taRef.current?.focus());
								}}
								className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-elevated"
							>
								<span className="w-14 shrink-0 font-mono text-[11px] text-accent">{item.command.trim()}</span>
								<span className="min-w-0">
									<strong className="block text-[12px] font-medium text-content-primary">{item.label}</strong>
									<small className="mt-0.5 block truncate text-[10px] text-content-tertiary">{item.description}</small>
								</span>
							</button>
						))}
					</div>
				</div>
			) : null}

			<div
				className={cn(
					"aira-enterprise-composer overflow-visible rounded-xl border border-border-subtle bg-surface-inset shadow-[0_8px_28px_rgba(0,0,0,0.22)]",
					busy && "opacity-95",
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
						if (event.key === "Escape" && contextMenuOpen) {
							setContextMenuOpen(false);
							return;
						}
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							handleSubmit();
						}
					}}
					placeholder={placeholder}
					className="min-h-[70px] w-full resize-none rounded-t-xl bg-transparent px-4 pb-2 pt-4 text-[14px] leading-6 text-content-primary outline-none placeholder:text-content-tertiary disabled:cursor-not-allowed sm:px-5 sm:text-[15px]"
				/>

				<div className="flex items-center justify-between gap-3 px-3 pb-3 sm:px-4">
					<div className="relative flex min-w-0 items-center gap-1.5">
						<button
							type="button"
							onClick={() => setContextMenuOpen((open) => !open)}
							className={cn(
								"flex size-8 shrink-0 items-center justify-center rounded-lg text-content-tertiary transition hover:bg-surface-elevated hover:text-content-primary",
								contextMenuOpen && "bg-surface-elevated text-content-primary",
							)}
							aria-label="Add context or open a workspace"
							aria-expanded={contextMenuOpen}
						>
							{contextMenuOpen ? <X className="size-4" aria-hidden /> : <Plus className="size-4" strokeWidth={1.8} aria-hidden />}
						</button>
						{contextMenuOpen ? (
							<div className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-60 overflow-hidden rounded-xl border border-border-subtle bg-surface-inset p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.36)]">
								<p className="px-2.5 pb-1.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-content-tertiary">Add context</p>
								<Link href="/knowledge" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] text-content-secondary transition hover:bg-surface-elevated hover:text-content-primary" onClick={() => setContextMenuOpen(false)}>
									<FileText className="size-4" strokeWidth={1.7} aria-hidden /> Files & knowledge
								</Link>
								<Link href="/agents" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] text-content-secondary transition hover:bg-surface-elevated hover:text-content-primary" onClick={() => setContextMenuOpen(false)}>
									<Bot className="size-4" strokeWidth={1.7} aria-hidden /> Agent task
								</Link>
								<Link href="/local-ai" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] text-content-secondary transition hover:bg-surface-elevated hover:text-content-primary" onClick={() => setContextMenuOpen(false)}>
									<Cpu className="size-4" strokeWidth={1.7} aria-hidden /> Private Local AI
								</Link>
							</div>
						) : null}
						<span className="hidden min-w-0 items-center gap-1.5 text-[11px] text-content-tertiary sm:flex">
							<Paperclip className="size-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
							<span className="truncate">Files · web · memory · tools</span>
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="hidden items-center gap-1.5 text-[10px] text-content-tertiary md:flex" aria-live="polite">
							<Globe2 className="size-3" aria-hidden />
							{isBusy ? "Researching" : canSubmit ? "Ready" : "Ask anything"}
						</span>
						{isBusy && onCancel ? (
							<Button
								type="button"
								onClick={onCancel}
								size="icon"
								className="size-9 rounded-lg border border-border-subtle bg-surface-elevated text-content-primary shadow-none transition hover:bg-surface"
								aria-label="Stop generating"
							>
								<Square className="size-3.5 fill-current" strokeWidth={1.8} aria-hidden />
							</Button>
						) : (
							<Button
								type="submit"
								disabled={!canSubmit}
								size="icon"
								className="size-9 rounded-lg border-0 bg-content-primary text-surface shadow-none transition hover:opacity-85 active:scale-[0.98] disabled:pointer-events-none disabled:bg-surface-elevated disabled:text-content-tertiary disabled:opacity-100"
								aria-label="Send to AIRA AI"
							>
								<ArrowUp className="size-4" strokeWidth={2} aria-hidden />
							</Button>
						)}
					</div>
				</div>
			</div>
			<div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-content-tertiary/80">
				<span>Enter to send</span>
				<span aria-hidden>·</span>
				<span>Shift+Enter for new line</span>
				<span className="hidden sm:inline" aria-hidden>·</span>
				<span className="hidden sm:inline">Type / for commands</span>
			</div>
		</form>
	);
});