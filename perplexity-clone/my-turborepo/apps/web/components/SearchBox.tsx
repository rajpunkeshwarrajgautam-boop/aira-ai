"use client";

import {
	ArrowUp,
	Bot,
	Command,
	Cpu,
	FileText,
	Globe2,
	Mic,
	MicOff,
	Plus,
	Square,
	WandSparkles,
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

type QuickCommand = { readonly command: string; readonly label: string; readonly description: string };

type SpeechRecognitionResultLike = { readonly 0?: { readonly transcript?: string }; readonly isFinal?: boolean };
type SpeechRecognitionEventLike = { readonly results?: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	start: () => void;
	stop: () => void;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	onend: (() => void) | null;
	onerror: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
	SpeechRecognition?: SpeechRecognitionConstructor;
	webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const QUICK_COMMANDS: readonly QuickCommand[] = [
	{ command: "/deep ", label: "Deep Research", description: "Run a longer multi-step investigation" },
	{ command: "/new", label: "New chat", description: "Clear the current thread and start fresh" },
	{ command: "/history", label: "History", description: "Search conversations, messages, and memory" },
	{ command: "/share", label: "Share", description: "Share the current conversation" },
] as const;

export const SearchBox = forwardRef<SearchBoxHandle, SearchBoxProps>(function SearchBox(
	{ value, onChange, onSubmit, onCancel, disabled, isBusy, placeholder = "Ask anything…", className },
	ref,
) {
	const taRef = useRef<HTMLTextAreaElement>(null);
	const pendingCommandRef = useRef<string | null>(null);
	const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	const [contextMenuOpen, setContextMenuOpen] = useState(false);
	const [listening, setListening] = useState(false);
	const [voiceAvailable, setVoiceAvailable] = useState(false);
	const resize = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(Math.max(el.scrollHeight, 58), 190)}px`;
	}, []);

	useEffect(() => {
		resize();
	}, [value, resize]);

	useEffect(() => {
		const speechWindow = window as SpeechWindow;
		setVoiceAvailable(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
		return () => recognitionRef.current?.stop();
	}, []);

	useEffect(() => {
		const onReuseMessage = (event: Event) => {
			const detail = (event as CustomEvent<{ readonly content?: string }>).detail;
			if (!detail?.content || isBusy) return;
			onChange(detail.content);
			requestAnimationFrame(() => {
				resize();
				taRef.current?.focus();
				taRef.current?.setSelectionRange(detail.content!.length, detail.content!.length);
			});
		};
		const onCommand = (event: Event) => {
			const command = (event as CustomEvent<{ readonly command?: string }>).detail?.command;
			if (!command || isBusy) return;
			if (command === "/history" || command === "/h") {
				window.location.assign("/workspace-search");
				return;
			}
			pendingCommandRef.current = command === "/share" || command === "/new" ? command : null;
			onChange(command);
			requestAnimationFrame(() => taRef.current?.focus());
		};
		window.addEventListener("aira:reuse-message", onReuseMessage);
		window.addEventListener("aira:command", onCommand);
		return () => {
			window.removeEventListener("aira:reuse-message", onReuseMessage);
			window.removeEventListener("aira:command", onCommand);
		};
	}, [isBusy, onChange, resize]);

	useEffect(() => {
		if (!pendingCommandRef.current || isBusy) return;
		if (value !== pendingCommandRef.current) return;
		pendingCommandRef.current = null;
		const id = window.setTimeout(() => onSubmit(), 0);
		return () => window.clearTimeout(id);
	}, [isBusy, onSubmit, value]);

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
		return QUICK_COMMANDS.filter((item) => !needle || `${item.command} ${item.label} ${item.description}`.toLowerCase().includes(needle));
	}, [value]);
	const showCommandMenu = !busy && value.startsWith("/") && !value.includes(" ") && commandMatches.length > 0;

	const handleSubmit = useCallback(() => {
		const normalized = value.trim().toLowerCase();
		if (busy || !normalized) return;
		if (normalized === "/history" || normalized === "/h") {
			window.location.assign("/workspace-search");
			return;
		}
		onSubmit();
	}, [value, busy, onSubmit]);

	const toggleVoice = useCallback(() => {
		if (!voiceAvailable || busy) return;
		if (listening) {
			recognitionRef.current?.stop();
			return;
		}
		const speechWindow = window as SpeechWindow;
		const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
		if (!Recognition) return;
		const recognition = new Recognition();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = document.documentElement.lang || "en-US";
		const base = value.trim();
		recognition.onresult = (event) => {
			let transcript = "";
			if (event.results) {
				for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index]?.[0]?.transcript ?? "";
			}
			if (transcript.trim()) onChange(`${base}${base ? " " : ""}${transcript.trim()}`);
		};
		recognition.onend = () => setListening(false);
		recognition.onerror = () => setListening(false);
		recognitionRef.current = recognition;
		setListening(true);
		recognition.start();
	}, [busy, listening, onChange, value, voiceAvailable]);

	useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus(), submit: handleSubmit }));

	return (
		<form onSubmit={(event) => { event.preventDefault(); handleSubmit(); }} className={cn("relative mx-auto w-full max-w-[780px]", className)} aria-label="Ask AiraAI">
			{showCommandMenu ? (
				<div className="absolute bottom-[calc(100%+10px)] left-0 z-40 w-full overflow-hidden rounded-xl border border-white/[0.09] bg-[#111827] shadow-[0_18px_50px_rgba(0,0,0,0.42)]">
					<div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2 text-[9px] font-medium uppercase tracking-[0.12em] text-content-tertiary"><Command className="size-3.5" aria-hidden />Commands</div>
					<div className="p-1.5">{commandMatches.map((item) => <button key={item.command} type="button" onClick={() => { if (item.command === "/history") { window.location.assign("/workspace-search"); return; } onChange(item.command); requestAnimationFrame(() => taRef.current?.focus()); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/[0.045]"><span className="w-14 shrink-0 font-mono text-[10px] text-violet-300">{item.command.trim()}</span><span className="min-w-0"><strong className="block text-[11px] font-medium text-content-primary">{item.label}</strong><small className="mt-0.5 block truncate text-[9px] text-content-tertiary">{item.description}</small></span></button>)}</div>
				</div>
			) : null}

			<div className={cn("aira-enterprise-composer overflow-visible rounded-2xl border border-white/[0.1] bg-[#0d1423] shadow-[0_18px_50px_rgba(0,0,0,0.24)]", busy && "opacity-95")}>
				<label htmlFor="search-query" className="sr-only">Message AIRA AI</label>
				<textarea ref={taRef} id="search-query" name="query" rows={1} value={value} disabled={busy} onChange={(event) => { onChange(event.target.value); resize(); }} onInput={resize} onKeyDown={(event) => { if (event.key === "Escape" && contextMenuOpen) { setContextMenuOpen(false); return; } if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSubmit(); } }} placeholder={placeholder} className="min-h-[76px] w-full resize-none rounded-t-2xl bg-transparent px-4 pb-2 pt-4 text-[14px] leading-6 text-content-primary outline-none placeholder:text-content-tertiary disabled:cursor-not-allowed sm:px-5 sm:text-[15px]" />

				<div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 sm:px-4">
					<div className="relative flex min-w-0 flex-wrap items-center gap-1.5">
						<button type="button" onClick={() => setContextMenuOpen((open) => !open)} className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] text-content-tertiary transition hover:bg-white/[0.05] hover:text-content-primary", contextMenuOpen && "bg-white/[0.06] text-content-primary")} aria-label="Add context or open a workspace" aria-expanded={contextMenuOpen}>{contextMenuOpen ? <X className="size-4" aria-hidden /> : <Plus className="size-4" strokeWidth={1.8} aria-hidden />}</button>
						{contextMenuOpen ? <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-64 overflow-hidden rounded-xl border border-white/[0.09] bg-[#111827] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.42)]"><p className="px-2.5 pb-1.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-content-tertiary">Add context</p><Link href="/knowledge" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11px] text-content-secondary transition hover:bg-white/[0.045] hover:text-content-primary" onClick={() => setContextMenuOpen(false)}><FileText className="size-4" strokeWidth={1.7} aria-hidden />Files & knowledge</Link><Link href="/agents" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11px] text-content-secondary transition hover:bg-white/[0.045] hover:text-content-primary" onClick={() => setContextMenuOpen(false)}><Bot className="size-4" strokeWidth={1.7} aria-hidden />Agent task</Link><Link href="/local-ai" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11px] text-content-secondary transition hover:bg-white/[0.045] hover:text-content-primary" onClick={() => setContextMenuOpen(false)}><Cpu className="size-4" strokeWidth={1.7} aria-hidden />Private Local AI</Link></div> : null}
						<button type="button" onClick={() => onChange("/deep ")} disabled={busy} className="hidden h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 text-[9px] font-medium text-content-secondary transition hover:border-violet-400/25 hover:bg-violet-500/[0.06] hover:text-violet-200 sm:flex"><Globe2 className="size-3.5" strokeWidth={1.6} />Deep Research</button>
						<Link href="/agents" className="hidden h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 text-[9px] font-medium text-content-secondary transition hover:border-violet-400/25 hover:bg-violet-500/[0.06] hover:text-violet-200 md:flex"><WandSparkles className="size-3.5" strokeWidth={1.6} />Agents</Link>
						<Link href="/local-ai" className="hidden h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 text-[9px] font-medium text-content-secondary transition hover:border-violet-400/25 hover:bg-violet-500/[0.06] hover:text-violet-200 lg:flex"><Cpu className="size-3.5" strokeWidth={1.6} />Local AI</Link>
					</div>
					<div className="flex items-center gap-2">
						{voiceAvailable ? <button type="button" onClick={toggleVoice} disabled={busy} className={cn("grid size-9 place-items-center rounded-xl border border-white/[0.07] text-content-tertiary transition hover:bg-white/[0.05] hover:text-content-primary", listening && "border-violet-400/30 bg-violet-500/10 text-violet-200")} aria-label={listening ? "Stop voice input" : "Start voice input"}>{listening ? <MicOff className="size-4" strokeWidth={1.7} /> : <Mic className="size-4" strokeWidth={1.7} />}</button> : null}
						{isBusy && onCancel ? <Button type="button" onClick={onCancel} size="icon" className="size-9 rounded-xl border border-white/[0.08] bg-white/[0.05] text-content-primary shadow-none hover:bg-white/[0.08]" aria-label="Stop generating"><Square className="size-3.5 fill-current" strokeWidth={1.8} aria-hidden /></Button> : <Button type="submit" disabled={!canSubmit} size="icon" className="size-9 rounded-xl border-0 bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-[0_7px_18px_rgba(91,70,220,.3)] transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:bg-none disabled:bg-white/[0.06] disabled:text-content-tertiary disabled:shadow-none" aria-label="Send to AIRA AI"><ArrowUp className="size-4" strokeWidth={2} aria-hidden /></Button>}
					</div>
				</div>
			</div>
			<div className="mt-2 flex items-center justify-center gap-3 text-[9px] text-content-tertiary/80"><span>AIRA can make mistakes. Verify important information.</span></div>
		</form>
	);
});