"use client";

import {
	ArrowUp,
	Bot,
	ChevronDown,
	Command,
	ExternalLink,
	FileText,
	Globe2,
	Layers,
	Mic,
	MicOff,
	Network,
	Paperclip,
	Plus,
	Sparkles,
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
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

import { Button } from "./ui/button";
import { cn } from "../lib/cn";

export interface SearchBoxProps {
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly onSubmit: (context?: { model?: string; attachments?: readonly AttachedFile[] }) => void;
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

type AttachedFile = {
	readonly id: string;
	readonly name: string;
	readonly size: number;
	readonly status: "ready" | "uploading" | "error";
	readonly error?: string;
};

type ModelOption = {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly badge: string;
};

const MODEL_OPTIONS: readonly ModelOption[] = [
	{ id: "auto", label: "AIRA Sovereign Auto", description: "Cortex dynamic multi-neural intelligence", badge: "Cortex" },
	{ id: "fast", label: "AIRA Ultra-Fast", description: "Sub-100ms low-latency synthesis", badge: "Sub-100ms" },
	{ id: "deep", label: "AIRA HyperResearch", description: "Multi-hop source triangulation & verified proof", badge: "Verified" },
	{ id: "smart", label: "AIRA Frontier Logic", description: "Maximum reasoning power for complex domains", badge: "Frontier" },
] as const;

const QUICK_COMMANDS: readonly QuickCommand[] = [
	{ command: "/deep ", label: "AIRA HyperResearch", description: "Launch multi-hop verified source investigation" },
	{ command: "/new", label: "New thread", description: "Initialize fresh sovereign context" },
	{ command: "/history", label: "History & Memory", description: "Search conversations, messages, and retained context" },
	{ command: "/share", label: "Share Dossier", description: "Export and share this intelligence dossier" },
] as const;

export const SearchBox = forwardRef<SearchBoxHandle, SearchBoxProps>(function SearchBox(
	{ value, onChange, onSubmit, onCancel, disabled, isBusy, placeholder = "Ask anything…", className },
	ref,
) {
	const taRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const modelTriggerRef = useRef<HTMLButtonElement>(null);
	const pendingCommandRef = useRef<string | null>(null);
	const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	const contextMenuId = useId();
	const commandMenuId = useId();
	const modelMenuId = useId();

	const [contextMenuOpen, setContextMenuOpen] = useState(false);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	const [selectedModel, setSelectedModel] = useState<string>("auto");
	const [attachments, setAttachments] = useState<readonly AttachedFile[]>([]);
	const [commandMenuDismissedValue, setCommandMenuDismissedValue] = useState<string | null>(null);
	const [listening, setListening] = useState(false);
	const [voiceAvailable, setVoiceAvailable] = useState(false);

	const resize = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
	}, []);

	useEffect(() => {
		resize();
	}, [value, resize]);

	useEffect(() => {
		const speechWindow = window as SpeechWindow;
		setVoiceAvailable(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
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
		if (!contextMenuOpen && !modelMenuOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setContextMenuOpen(false);
				setModelMenuOpen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [contextMenuOpen, modelMenuOpen]);

	const busy = Boolean(disabled || isBusy);
	const canSubmit = Boolean(value.trim() || attachments.length > 0) && !busy;

	const commandMatches = useMemo(() => {
		if (!value.startsWith("/")) return [];
		const needle = value.slice(1).trim().toLowerCase();
		return QUICK_COMMANDS.filter((item) => !needle || `${item.command} ${item.label} ${item.description}`.toLowerCase().includes(needle));
	}, [value]);

	const showCommandMenu = !busy && value.startsWith("/") && !value.includes(" ") && commandMatches.length > 0 && commandMenuDismissedValue !== value;

	const handleSubmit = useCallback(() => {
		const normalized = value.trim().toLowerCase();
		if (busy || (!normalized && attachments.length === 0)) return;
		if (normalized === "/history" || normalized === "/h") {
			window.location.assign("/workspace-search");
			return;
		}
		onSubmit({ model: selectedModel, attachments });
	}, [value, attachments, busy, onSubmit, selectedModel]);

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
		try {
			recognition.start();
		} catch {
			setListening(false);
		}
	}, [busy, listening, onChange, value, voiceAvailable]);

	const handleFileSelect = useCallback((file: File) => {
		const newAttachment: AttachedFile = {
			id: crypto.randomUUID(),
			name: file.name,
			size: file.size,
			status: "ready",
		};
		setAttachments((prev) => [...prev, newAttachment]);
		setContextMenuOpen(false);
		requestAnimationFrame(() => taRef.current?.focus());
	}, []);

	const removeAttachment = useCallback((id: string) => {
		setAttachments((prev) => prev.filter((a) => a.id !== id));
	}, []);

	const activeModelOption = useMemo(
		() => MODEL_OPTIONS.find((m) => m.id === selectedModel) ?? MODEL_OPTIONS[0]!,
		[selectedModel],
	);

	useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus(), submit: handleSubmit }));

	return (
		<form onSubmit={(event) => { event.preventDefault(); handleSubmit(); }} className={cn("relative mx-auto w-full max-w-[780px]", className)} aria-label="Ask AiraAI">
			{/* Hidden file input for in-composer attachment without navigating away */}
			<input
				ref={fileInputRef}
				type="file"
				className="hidden"
				aria-label="Upload document to composer"
				onChange={(e) => {
					const f = e.target.files?.[0];
					if (f) handleFileSelect(f);
					if (fileInputRef.current) fileInputRef.current.value = "";
				}}
			/>

			{/* Quick Slash Commands Popover */}
			{showCommandMenu ? (
				<div id={commandMenuId} aria-label="Composer commands" className="absolute bottom-[calc(100%+16px)] left-0 z-40 w-full overflow-hidden rounded-2xl border border-white/40 bg-white/90 shadow-2xl backdrop-blur-xl">
					<div className="flex items-center gap-2 border-b border-[#0F172A]/10 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[#0F172A]/50">
						<Command className="size-3.5 text-[#0F172A]" aria-hidden /> Commands
					</div>
					<div className="p-2">
						{commandMatches.map((item) => (
							<button
								key={item.command}
								type="button"
								onClick={() => {
									setCommandMenuDismissedValue(null);
									if (item.command === "/history") {
										window.location.assign("/workspace-search");
										return;
									}
									onChange(item.command);
									requestAnimationFrame(() => taRef.current?.focus());
								}}
								className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left transition hover:bg-[#0F172A]/5"
							>
								<span className="w-16 shrink-0 font-mono text-[12px] font-semibold text-[#8B7CFF]">{item.command.trim()}</span>
								<span className="min-w-0">
									<strong className="block text-[13px] font-semibold text-[#0F172A]">{item.label}</strong>
									<small className="mt-0.5 block truncate text-[12px] font-medium text-[#0F172A]/60">{item.description}</small>
								</span>
							</button>
						))}
					</div>
				</div>
			) : null}

			<div className={cn("relative flex w-full flex-col gap-2 rounded-xl border border-[#EAEAEA] bg-white p-3 shadow-[0_2px_4px_rgba(0,0,0,0.02)] transition focus-within:border-[#111111] focus-within:ring-1 focus-within:ring-[#111111]", busy && "opacity-95")}>
				
				<div className="flex w-full flex-col">
					{attachments.length > 0 ? (
						<div className="flex flex-wrap items-center gap-2 pb-2 px-1">
							{attachments.map((att) => (
								<div key={att.id} className="inline-flex items-center gap-2 rounded-[6px] border border-[#EAEAEA] bg-[#F4F4F5] px-3 py-1.5 shadow-sm">
									<FileText className="size-3.5 text-[#111111]" />
									<span className="max-w-[140px] truncate text-[12px] font-bold text-[#111111]">{att.name}</span>
									<button
										type="button"
										onClick={() => removeAttachment(att.id)}
										className="ml-1 rounded-sm p-0.5 text-[#525252] transition hover:bg-[#EAEAEA] hover:text-[#111111]"
									>
										<X className="size-3.5" strokeWidth={3} />
									</button>
								</div>
							))}
						</div>
					) : null}
					
					<label htmlFor="search-query" className="sr-only">Message AIRA AI</label>
					<textarea
						ref={taRef}
						id="search-query"
						name="query"
						rows={1}
						value={value}
						disabled={busy}
						aria-controls={showCommandMenu ? commandMenuId : undefined}
						aria-expanded={showCommandMenu}
						onChange={(event) => {
							setCommandMenuDismissedValue(null);
							onChange(event.target.value);
							resize();
						}}
						onInput={resize}
						onKeyDown={(event) => {
							if (event.key === "Escape" && (contextMenuOpen || modelMenuOpen)) {
								setContextMenuOpen(false);
								setModelMenuOpen(false);
								return;
							}
							if (event.key === "Escape" && showCommandMenu) {
								setCommandMenuDismissedValue(value);
								return;
							}
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								handleSubmit();
							}
						}}
						placeholder={placeholder || "Ask AIRA..."}
						className="aira-composer-textarea max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-2 py-2 text-[15px] font-medium leading-relaxed text-[#111111] outline-none placeholder:font-medium placeholder:text-[#A3A3A3] disabled:cursor-not-allowed"
					/>
				</div>

				<div className="flex w-full items-center justify-between pt-1">
					<div className="flex items-center gap-2 pl-1">
						<button
							type="button"
							onClick={() => {
								setModelMenuOpen(false);
								setContextMenuOpen((open) => !open);
							}}
							className={cn(
								"flex size-8 items-center justify-center rounded-[6px] transition",
								contextMenuOpen ? "bg-[#111111] text-white" : "bg-[#F4F4F5] text-[#525252] hover:bg-[#EAEAEA] hover:text-[#111111]"
							)}
							aria-label="Add context or attach document"
							aria-controls={contextMenuId}
							aria-expanded={contextMenuOpen}
						>
							{contextMenuOpen ? <X className="size-4" /> : <Plus className="size-4" strokeWidth={2.5} />}
						</button>

					{/* In-Composer Context Popover */}
					{contextMenuOpen ? (
						<div
							id={contextMenuId}
							className="absolute bottom-[calc(100%+16px)] left-0 z-50 w-72 overflow-hidden rounded-2xl border border-white/40 bg-white/90 p-2 shadow-2xl backdrop-blur-xl"
						>
							<p className="px-3 pb-2 pt-1.5 text-[10px] font-bold uppercase tracking-widest text-[#0F172A]/50">
								Research Sources
							</p>

							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-semibold text-[#0F172A] transition hover:bg-[#0F172A]/5"
							>
								<Paperclip className="size-4 text-[#8B7CFF]" strokeWidth={2.5} />
								<span>Attach local document</span>
							</button>

							<div className="my-2 border-t border-[#0F172A]/10" />

							<p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-[#0F172A]/50">
								Sovereign Integrations
							</p>

							<Link href="/knowledge" target="_blank" className="flex min-h-10 items-center justify-between rounded-xl px-3 py-2 text-[13px] font-semibold text-[#0F172A] transition hover:bg-[#0F172A]/5" onClick={() => setContextMenuOpen(false)}>
								<span className="flex items-center gap-3"><FileText className="size-4 text-[#8B7CFF]" strokeWidth={2.5} /> Knowledge Library</span>
							</Link>
							<Link href="/agents" target="_blank" className="flex min-h-10 items-center justify-between rounded-xl px-3 py-2 text-[13px] font-semibold text-[#0F172A] transition hover:bg-[#0F172A]/5" onClick={() => setContextMenuOpen(false)}>
								<span className="flex items-center gap-3"><Bot className="size-4 text-[#8B7CFF]" strokeWidth={2.5} /> Agent Missions</span>
							</Link>
							<Link href="/omniroute" target="_blank" className="flex min-h-10 items-center justify-between rounded-[8px] px-3 py-2 text-[13px] font-semibold text-[#111111] transition hover:bg-[#F4F4F5]" onClick={() => setContextMenuOpen(false)}>
								<span className="flex items-center gap-3"><Network className="size-4 text-[#525252]" strokeWidth={2.5} /> OmniRoute Status</span>
							</Link>
						</div>
					) : null}

					<div className="relative">
						<button
							ref={modelTriggerRef}
							type="button"
							id={`${modelMenuId}-trigger`}
							aria-label={`Select intelligence model. Current: ${activeModelOption.label}`}
							aria-haspopup="listbox"
							aria-expanded={modelMenuOpen}
							aria-controls={modelMenuOpen ? modelMenuId : undefined}
							onClick={() => {
								setContextMenuOpen(false);
								setModelMenuOpen((open) => !open);
							}}
							className={cn(
								"flex h-8 items-center gap-2 rounded-[6px] border px-2.5 text-[11px] font-bold transition",
								modelMenuOpen ? "border-[#111111] bg-[#111111] text-white" : "border-transparent bg-[#F4F4F5] text-[#525252] hover:bg-[#EAEAEA] hover:text-[#111111]"
							)}
						>
							<Sparkles className={cn("size-3.5", modelMenuOpen ? "text-[#D4D4D4]" : "text-[#525252]")} aria-hidden />
							<span aria-hidden>{activeModelOption.label.replace("AIRA ", "")}</span>
						</button>

						{modelMenuOpen ? (
							<div
								id={modelMenuId}
								role="listbox"
								aria-label="Intelligence model"
								aria-labelledby={`${modelMenuId}-trigger`}
								className="absolute bottom-[calc(100%+16px)] right-0 z-50 max-w-[calc(100vw-2rem)] w-72 overflow-hidden rounded-2xl border border-white/40 bg-white/90 p-2 shadow-2xl backdrop-blur-xl"
							>
								<p className="px-3 pb-2 pt-1.5 text-[10px] font-bold uppercase tracking-widest text-[#0F172A]/50" aria-hidden>
									Intelligence Core
								</p>
								<div className="space-y-1">
									{MODEL_OPTIONS.map((opt) => {
										const isSelected = opt.id === selectedModel;
										return (
											<button
												key={opt.id}
												type="button"
												role="option"
												aria-selected={isSelected}
												onClick={() => {
													setSelectedModel(opt.id);
													if (opt.id === "deep" && !value.startsWith("/deep ")) {
														onChange(`/deep ${value.trim()}`);
													}
													setModelMenuOpen(false);
													// Restore focus to trigger, then textarea after a tick
													requestAnimationFrame(() => {
														modelTriggerRef.current?.focus();
														window.setTimeout(() => taRef.current?.focus(), 100);
													});
												}}
												className={cn(
													"flex w-full items-start justify-between rounded-xl px-3 py-2.5 text-left transition",
													isSelected ? "bg-[#0F172A]/5" : "hover:bg-[#0F172A]/5",
												)}
											>
												<div>
													<p className="text-[13px] font-bold text-[#0F172A]">{opt.label}</p>
													<p className="mt-1 text-[11px] font-medium text-[#0F172A]/60">{opt.description}</p>
												</div>
												{isSelected && <div className="mt-1 size-2 rounded-full bg-[#8B7CFF]" aria-hidden />}
											</button>
										);
									})}
								</div>
							</div>
						) : null}
					</div>

					{/* MICROPHONE DEFERRED: Speech-to-text deferred to a post-launch update.
					     Implementation preserved below (voiceAvailable, toggleVoice, SpeechRecognition).
					     Re-enable by replacing `false` with `voiceAvailable` below. */}
					{/* eslint-disable-next-line no-constant-condition, no-constant-binary-expression */}
					{false && voiceAvailable ? (
						<button
							type="button"
							aria-label={listening ? "Stop voice input" : "Start voice input"}
							onClick={toggleVoice}
							disabled={busy}
							className={cn(
								"flex size-8 items-center justify-center rounded-[6px] transition",
								listening ? "bg-red-500 text-white" : "bg-[#F4F4F5] text-[#525252] hover:bg-[#EAEAEA] hover:text-[#111111]"
							)}
						>
							{listening ? <MicOff className="size-3.5" strokeWidth={2.5} /> : <Mic className="size-3.5" strokeWidth={2.5} />}
						</button>
					) : null}
					</div>
					
					<div>
						{isBusy && onCancel ? (
							<Button
								type="button"
								onClick={onCancel}
								size="icon"
								className="size-8 rounded-[6px] border-0 bg-[#111111] text-white transition hover:bg-[#2B2B2B]"
							>
								<Square className="size-3.5 fill-current" />
							</Button>
						) : (
							<Button
								type="submit"
								disabled={!canSubmit}
								size="icon"
								className="size-8 rounded-[6px] border-0 bg-[#111111] text-white transition hover:bg-[#2B2B2B] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none"
							>
								<ArrowUp className="size-4" strokeWidth={2.5} />
							</Button>
						)}
					</div>
				</div>
			</div>
			<div className="mt-4 flex items-center justify-center gap-4 text-[11px] font-semibold tracking-wide text-[#0F172A]/40">
				<span>AIRA CAN MAKE MISTAKES. VERIFY IMPORTANT INFO.</span>
			</div>
		</form>
	);
});
