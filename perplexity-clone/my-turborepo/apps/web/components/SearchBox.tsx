"use client";

import {
	ArrowUp,
	Bot,
	ChevronDown,
	Command,
	ExternalLink,
	FileText,
	Globe2,
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
	{ id: "auto", label: "Auto (OmniRoute)", description: "Dynamic intelligent multi-provider routing", badge: "Smart" },
	{ id: "fast", label: "Fast", description: "Ultra-low latency for immediate answers", badge: "Low Latency" },
	{ id: "deep", label: "Deep Reasoning", description: "Multi-step investigation & structured synthesis", badge: "Deep" },
	{ id: "smart", label: "Smart Frontier", description: "Maximum reasoning capability for complex domains", badge: "Frontier" },
] as const;

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
	const fileInputRef = useRef<HTMLInputElement>(null);
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
		recognition.start();
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
				<div id={commandMenuId} aria-label="Composer commands" className="absolute bottom-[calc(100%+10px)] left-0 z-40 w-full overflow-hidden rounded-xl border border-white/[0.09] bg-[#111827] shadow-[0_18px_50px_rgba(0,0,0,0.42)]">
					<div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8e95a2]">
						<Command className="size-3.5" aria-hidden />Commands
					</div>
					<div className="p-1.5">
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
								className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/[0.045]"
							>
								<span className="w-14 shrink-0 font-mono text-[11px] text-[#c9a84c]">{item.command.trim()}</span>
								<span className="min-w-0">
									<strong className="block text-[12px] font-medium text-[#f0f0ed]">{item.label}</strong>
									<small className="mt-0.5 block truncate text-[11px] text-[#8e95a2]">{item.description}</small>
								</span>
							</button>
						))}
					</div>
				</div>
			) : null}

			<div className={cn("aira-enterprise-composer overflow-visible rounded-2xl border border-white/[0.1] bg-[#0d1423] shadow-[0_18px_50px_rgba(0,0,0,0.24)]", busy && "opacity-95")}>
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
					placeholder={placeholder}
					className="min-h-[76px] w-full resize-none rounded-t-2xl bg-transparent px-4 pb-2 pt-4 text-[14px] leading-6 text-[#f0f0ed] outline-none placeholder:text-[#6e747f] disabled:cursor-not-allowed sm:px-5 sm:text-[15px]"
				/>

				{/* In-Composer Attachment Preview Chips */}
				{attachments.length > 0 ? (
					<div className="flex flex-wrap items-center gap-2 px-4 pb-2.5 sm:px-5">
						{attachments.map((att) => (
							<div
								key={att.id}
								className="inline-flex items-center gap-2 rounded-lg border border-white/[0.12] bg-[#141b2b] px-3 py-1.5 text-xs text-[#cfd2d8] shadow-sm"
							>
								<FileText className="size-3.5 text-sky-400" />
								<span className="max-w-[160px] truncate text-[11px] font-medium text-[#f0f0ed]">{att.name}</span>
								<span className="text-[10px] text-[#8e95a2]">({(att.size / 1024).toFixed(0)} KB)</span>
								<button
									type="button"
									onClick={() => removeAttachment(att.id)}
									className="rounded p-0.5 text-[#8e95a2] transition hover:bg-white/[0.08] hover:text-red-300"
									aria-label={`Remove ${att.name}`}
								>
									<X className="size-3" />
								</button>
							</div>
						))}
					</div>
				) : null}

				<div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 sm:px-4">
					<div className="relative flex min-w-0 flex-wrap items-center gap-1.5">
						{/* Context / Attachment Popover Trigger */}
						<button
							type="button"
							onClick={() => {
								setModelMenuOpen(false);
								setContextMenuOpen((open) => !open);
							}}
							className={cn(
								"flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] text-[#8e95a2] transition hover:bg-white/[0.05] hover:text-[#f0f0ed]",
								contextMenuOpen && "bg-white/[0.06] text-[#f0f0ed]",
							)}
							aria-label="Add context or attach document"
							aria-controls={contextMenuId}
							aria-expanded={contextMenuOpen}
						>
							{contextMenuOpen ? <X className="size-4" aria-hidden /> : <Plus className="size-4" strokeWidth={1.8} aria-hidden />}
						</button>

						{/* In-Composer Context Popover (Keeps Prompt Preserved) */}
						{contextMenuOpen ? (
							<div
								id={contextMenuId}
								aria-label="Add context"
								className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-72 overflow-hidden rounded-xl border border-[rgba(245,244,239,0.1)] bg-[#121418] p-2 shadow-[0_18px_50px_rgba(0,0,0,0.5)]"
							>
								<p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#8e95a2]">
									Add In-Context Research
								</p>

								{/* Direct File Attachment (No Navigation) */}
								<button
									type="button"
									onClick={() => fileInputRef.current?.click()}
									className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-[#cfd2d8] transition hover:bg-white/[0.06] hover:text-[#f0f0ed]"
								>
									<Paperclip className="size-4 text-sky-400" strokeWidth={1.7} aria-hidden />
									<span>Attach local document</span>
								</button>

								<div className="my-1.5 border-t border-white/[0.07]" />

								<p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8e95a2]">
									Workspace Libraries
								</p>

								{/* Retained Links for Test & Cross-Surface Compatibility */}
								<Link
									href="/knowledge"
									target="_blank"
									rel="noopener noreferrer"
									className="flex min-h-9 items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] text-[#cfd2d8] transition hover:bg-white/[0.05] hover:text-[#f0f0ed]"
									onClick={() => setContextMenuOpen(false)}
								>
									<span className="flex items-center gap-2">
										<FileText className="size-3.5 text-[#8e95a2]" strokeWidth={1.7} aria-hidden />
										Knowledge Library
									</span>
									<ExternalLink className="size-3 text-[#6e747f]" />
								</Link>

								<Link
									href="/agents"
									target="_blank"
									rel="noopener noreferrer"
									className="flex min-h-9 items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] text-[#cfd2d8] transition hover:bg-white/[0.05] hover:text-[#f0f0ed]"
									onClick={() => setContextMenuOpen(false)}
								>
									<span className="flex items-center gap-2">
										<Bot className="size-3.5 text-[#8e95a2]" strokeWidth={1.7} aria-hidden />
										Agent Missions
									</span>
									<ExternalLink className="size-3 text-[#6e747f]" />
								</Link>

								<Link
									href="/omniroute"
									target="_blank"
									rel="noopener noreferrer"
									className="flex min-h-9 items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] text-[#cfd2d8] transition hover:bg-white/[0.05] hover:text-[#f0f0ed]"
									onClick={() => setContextMenuOpen(false)}
								>
									<span className="flex items-center gap-2">
										<Network className="size-3.5 text-[#8e95a2]" strokeWidth={1.7} aria-hidden />
										OmniRoute Status
									</span>
									<ExternalLink className="size-3 text-[#6e747f]" />
								</Link>
							</div>
						) : null}

						{/* Model Selector Pill */}
						<div className="relative">
							<button
								type="button"
								onClick={() => {
									setContextMenuOpen(false);
									setModelMenuOpen((open) => !open);
								}}
								className={cn(
									"flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs text-[#cfd2d8] transition hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-[#f0f0ed]",
									modelMenuOpen && "border-sky-500/40 bg-sky-500/[0.08] text-[#f0f0ed]",
								)}
								aria-label={`Select model: currently ${activeModelOption.label}`}
								aria-controls={modelMenuId}
								aria-expanded={modelMenuOpen}
							>
								<Sparkles className="size-3 text-sky-400" />
								<span className="text-[11px] font-medium">{activeModelOption.label}</span>
								<ChevronDown className="size-3 text-[#8e95a2]" />
							</button>

							{/* Model Selector Popover */}
							{modelMenuOpen ? (
								<div
									id={modelMenuId}
									aria-label="Select AI Model"
									className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-72 overflow-hidden rounded-xl border border-[rgba(245,244,239,0.1)] bg-[#121418] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.5)]"
								>
									<p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#8e95a2]">
										Active Routing Mode
									</p>
									<div className="space-y-1">
										{MODEL_OPTIONS.map((opt) => {
											const isSelected = opt.id === selectedModel;
											return (
												<button
													key={opt.id}
													type="button"
													onClick={() => {
														setSelectedModel(opt.id);
														if (opt.id === "deep" && !value.startsWith("/deep ")) {
															onChange(`/deep ${value.trim()}`);
														}
														setModelMenuOpen(false);
														requestAnimationFrame(() => taRef.current?.focus());
													}}
													className={cn(
														"flex w-full items-start justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.05]",
														isSelected && "bg-white/[0.06]",
													)}
												>
													<div>
														<p className="text-xs font-semibold text-[#f0f0ed]">{opt.label}</p>
														<p className="mt-0.5 text-[11px] text-[#8e95a2]">{opt.description}</p>
													</div>
													<span
														className={cn(
															"rounded px-1.5 py-0.5 text-[9px] font-semibold",
															isSelected
																? "bg-sky-500/20 text-sky-300"
																: "bg-white/[0.06] text-[#8e95a2]",
														)}
													>
														{opt.badge}
													</span>
												</button>
											);
										})}
									</div>
								</div>
							) : null}
						</div>

						{/* Quick Mode Buttons */}
						<button
							type="button"
							onClick={() => {
								if (value.startsWith("/deep ")) {
									onChange(value.replace(/^\/deep\s*/, ""));
								} else {
									onChange(`/deep ${value.trim()}`);
								}
							}}
							disabled={busy}
							className={cn(
								"hidden h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 text-[11px] font-medium text-[#cfd2d8] transition hover:border-sky-500/30 hover:bg-sky-500/[0.08] hover:text-sky-300 sm:flex",
								value.startsWith("/deep ") && "border-sky-500/40 bg-sky-500/10 text-sky-300",
							)}
						>
							<Globe2 className="size-3.5" strokeWidth={1.6} />
							Deep Research
						</button>

						<Link
							href="/agents"
							className="hidden h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 text-[11px] font-medium text-[#cfd2d8] transition hover:border-white/[0.18] hover:bg-white/[0.05] hover:text-[#f0f0ed] md:flex"
						>
							<WandSparkles className="size-3.5" strokeWidth={1.6} />
							Agents
						</Link>
						<Link
							href="/omniroute"
							className="hidden h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 text-[11px] font-medium text-[#cfd2d8] transition hover:border-white/[0.18] hover:bg-white/[0.05] hover:text-[#f0f0ed] lg:flex"
						>
							<Network className="size-3.5" strokeWidth={1.6} />
							OmniRoute
						</Link>
					</div>

					<div className="flex items-center gap-2">
						{voiceAvailable ? (
							<button
								type="button"
								onClick={toggleVoice}
								disabled={busy}
								className={cn(
									"grid size-9 place-items-center rounded-xl border border-white/[0.07] text-[#8e95a2] transition hover:bg-white/[0.05] hover:text-[#f0f0ed]",
									listening && "border-sky-500/40 bg-sky-500/10 text-sky-300",
								)}
								aria-label={listening ? "Stop voice input" : "Start voice input"}
							>
								{listening ? <MicOff className="size-4" strokeWidth={1.7} /> : <Mic className="size-4" strokeWidth={1.7} />}
							</button>
						) : null}
						{isBusy && onCancel ? (
							<Button
								type="button"
								onClick={onCancel}
								size="icon"
								className="size-9 rounded-xl border border-white/[0.08] bg-white/[0.05] text-[#f0f0ed] shadow-none hover:bg-white/[0.08]"
								aria-label="Stop generating"
							>
								<Square className="size-3.5 fill-current" strokeWidth={1.8} aria-hidden />
							</Button>
						) : (
							<Button
								type="submit"
								disabled={!canSubmit}
								size="icon"
								className="size-9 rounded-xl border-0 bg-sky-400 text-[#08090C] shadow-[0_0_18px_rgba(56,189,248,0.3)] transition hover:bg-sky-300 active:scale-[0.98] disabled:pointer-events-none disabled:bg-white/[0.06] disabled:text-[#6e747f] disabled:shadow-none"
								aria-label="Send to AIRA AI"
							>
								<ArrowUp className="size-4" strokeWidth={2.4} aria-hidden />
							</Button>
						)}
					</div>
				</div>
			</div>
			<div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-[#8e95a2]">
				<span>AIRA can make mistakes. Verify important information.</span>
			</div>
		</form>
	);
});
