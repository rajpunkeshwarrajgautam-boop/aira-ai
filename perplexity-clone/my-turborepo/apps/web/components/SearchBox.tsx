"use client";

import {
	ArrowUp,
	Bot,
	Check,
	ChevronDown,
	Columns2,
	Command,
	Cpu,
	FileText,
	Globe2,
	Mic,
	MicOff,
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

import { cn } from "../lib/cn";
import styles from "./SearchBox.module.css";

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
type ProviderPreference = "auto" | "openai" | "nvidia" | "self-hosted";
type ProviderOption = {
	readonly id: Exclude<ProviderPreference, "auto">;
	readonly label: string;
	readonly model: string;
	readonly configured: boolean;
	readonly residencyAllowed: boolean;
	readonly selectable: boolean;
};
type ProviderPreferencePayload = {
	readonly selected: ProviderPreference;
	readonly tier: "free" | "pro";
	readonly authenticated: boolean;
	readonly manualSelectionEnabled: boolean;
	readonly providers: readonly ProviderOption[];
};

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
	{ value, onChange, onSubmit, onCancel, disabled, isBusy, placeholder = "Ask AIRA anything…", className },
	ref,
) {
	const taRef = useRef<HTMLTextAreaElement>(null);
	const pendingCommandRef = useRef<string | null>(null);
	const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	const [contextMenuOpen, setContextMenuOpen] = useState(false);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	const [modelState, setModelState] = useState<ProviderPreferencePayload | null>(null);
	const [modelSaving, setModelSaving] = useState(false);
	const [modelMessage, setModelMessage] = useState<string | null>(null);
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
		let cancelled = false;
		void fetch("/api/model-preference", { credentials: "include", cache: "no-store" })
			.then(async (response) => {
				if (!response.ok) throw new Error("Model routing is temporarily unavailable.");
				return (await response.json()) as ProviderPreferencePayload;
			})
			.then((payload) => {
				if (!cancelled) setModelState(payload);
			})
			.catch(() => {
				if (!cancelled) setModelState(null);
			});
		return () => {
			cancelled = true;
		};
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
	const canSubmit = Boolean(value.trim()) && !busy;
	const commandMatches = useMemo(() => {
		if (!value.startsWith("/")) return [];
		const needle = value.slice(1).trim().toLowerCase();
		return QUICK_COMMANDS.filter((item) => !needle || `${item.command} ${item.label} ${item.description}`.toLowerCase().includes(needle));
	}, [value]);
	const showCommandMenu = !busy && value.startsWith("/") && !value.includes(" ") && commandMatches.length > 0;
	const selectedProvider = modelState?.selected === "auto"
		? null
		: modelState?.providers.find((provider) => provider.id === modelState?.selected) ?? null;
	const modelLabel = selectedProvider?.label ?? "Auto";

	const handleSubmit = useCallback(() => {
		const normalized = value.trim().toLowerCase();
		if (busy || !normalized) return;
		if (normalized === "/history" || normalized === "/h") {
			window.location.assign("/workspace-search");
			return;
		}
		onSubmit();
	}, [value, busy, onSubmit]);

	const selectProvider = useCallback(async (preference: ProviderPreference) => {
		if (modelSaving) return;
		setModelSaving(true);
		setModelMessage(null);
		try {
			const response = await fetch("/api/model-preference", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ preference }),
			});
			const body = (await response.json().catch(() => null)) as { selected?: ProviderPreference; error?: { message?: string } } | null;
			if (!response.ok || !body?.selected) throw new Error(body?.error?.message ?? "Could not update model routing.");
			setModelState((current) => current ? { ...current, selected: body.selected! } : current);
			setModelMenuOpen(false);
		} catch (error) {
			setModelMessage(error instanceof Error ? error.message : "Could not update model routing.");
		} finally {
			setModelSaving(false);
		}
	}, [modelSaving]);

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
		<form
			onSubmit={(event) => {
				event.preventDefault();
				handleSubmit();
			}}
			className={cn(styles.form, className)}
			aria-label="Ask AiraAI"
		>
			{showCommandMenu ? (
				<div className={cn(styles.menu, styles.menuWide)}>
					<div className={styles.menuHeader}><Command className="size-3.5" aria-hidden /> Commands</div>
					<div className={styles.menuBody}>
						{commandMatches.map((item) => (
							<button key={item.command} type="button" onClick={() => {
								if (item.command === "/history") {
									window.location.assign("/workspace-search");
									return;
								}
								onChange(item.command);
								requestAnimationFrame(() => taRef.current?.focus());
							}} className={styles.menuItem}>
								<span className={styles.commandCode}>{item.command.trim()}</span>
								<span className={styles.menuItemCopy}><strong>{item.label}</strong><small>{item.description}</small></span>
							</button>
						))}
					</div>
				</div>
			) : null}

			<div className={cn("aira-enterprise-composer", styles.composer, busy && styles.composerBusy)}>
				<label htmlFor="search-query" className="sr-only">Message AIRA AI</label>
				<textarea
					ref={taRef}
					id="search-query"
					name="query"
					rows={1}
					value={value}
					disabled={busy}
					onChange={(event) => { onChange(event.target.value); resize(); }}
					onInput={resize}
					onKeyDown={(event) => {
						if (event.key === "Escape" && (contextMenuOpen || modelMenuOpen)) {
							setContextMenuOpen(false);
							setModelMenuOpen(false);
							return;
						}
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							handleSubmit();
						}
					}}
					placeholder={placeholder}
					className={styles.textarea}
				/>

				<div className={styles.toolbar}>
					<div className={styles.toolbarGroup}>
						<button type="button" onClick={() => { setContextMenuOpen((open) => !open); setModelMenuOpen(false); }} className={cn(styles.iconControl, contextMenuOpen && styles.active)} aria-label="Add context or assign work" aria-expanded={contextMenuOpen}>
							{contextMenuOpen ? <X className="size-4" aria-hidden /> : <Plus className="size-4" strokeWidth={1.8} aria-hidden />}
						</button>

						{contextMenuOpen ? (
							<div className={styles.menu}>
								<div className={styles.menuHeader}>Add context or work mode</div>
								<div className={styles.menuBody}>
									<Link href="/knowledge" className={styles.menuItem} onClick={() => setContextMenuOpen(false)}><span className={styles.menuItemIcon}><FileText className="size-4" strokeWidth={1.7} aria-hidden /></span><span className={styles.menuItemCopy}><strong>Files & knowledge</strong><small>Work with uploaded and indexed context</small></span></Link>
									<Link href="/agents" className={styles.menuItem} onClick={() => setContextMenuOpen(false)}><span className={styles.menuItemIcon}><Bot className="size-4" strokeWidth={1.7} aria-hidden /></span><span className={styles.menuItemCopy}><strong>Assign to an agent</strong><small>Move from conversation to autonomous execution</small></span></Link>
									<Link href="/local-ai" className={styles.menuItem} onClick={() => setContextMenuOpen(false)}><span className={styles.menuItemIcon}><Cpu className="size-4" strokeWidth={1.7} aria-hidden /></span><span className={styles.menuItemCopy}><strong>Private Local AI</strong><small>Open the configured local runtime workspace</small></span></Link>
								</div>
							</div>
						) : null}

						<button type="button" onClick={() => onChange("/deep ")} disabled={busy} className={cn(styles.chip, styles.chipPrimary)}><Globe2 className="size-3.5" strokeWidth={1.7} aria-hidden />Deep Research</button>

						<div className="relative">
							<button type="button" onClick={() => { setModelMenuOpen((open) => !open); setContextMenuOpen(false); }} className={styles.chip} aria-label="Choose model routing" aria-expanded={modelMenuOpen}>
								<span className={styles.autoBadge}><span className={styles.statusDot} />{modelLabel}</span><ChevronDown className="size-3" aria-hidden />
							</button>
							{modelMenuOpen ? (
								<div className={cn(styles.menu, styles.modelMenu)}>
									<div className={styles.modelSummary}>
										<strong>Model routing</strong>
										<p>{modelState?.manualSelectionEnabled ? "Choose a configured provider for normal AIRA chat. Safety, residency and fallback policies still apply." : "AIRA automatically uses the provider allowed by your current plan. Pro and Team can choose configured providers."}</p>
									</div>
									<div className={styles.menuBody}>
										<button type="button" disabled={modelSaving} onClick={() => void selectProvider("auto")} className={cn(styles.menuItem, modelState?.selected === "auto" && "bg-accent/10 text-content-primary")}>
											<span className={styles.menuItemIcon}>{modelState?.selected === "auto" ? <Check className="size-4" /> : <Globe2 className="size-4" />}</span>
											<span className={styles.menuItemCopy}><strong>Auto · best available</strong><small>Use the plan-aware AIRA primary provider and safe fallback policy</small></span>
										</button>
										{modelState?.providers.map((provider) => {
											const selected = modelState.selected === provider.id;
											const planLocked = modelState.tier === "free" && provider.id !== "nvidia";
											const unavailableReason = planLocked ? "Pro or Team required" : !provider.configured ? "Not configured" : !provider.residencyAllowed ? "Blocked by residency policy" : null;
											return (
												<button key={provider.id} type="button" disabled={modelSaving || !provider.selectable} onClick={() => void selectProvider(provider.id)} className={cn(styles.menuItem, selected && "bg-accent/10 text-content-primary", !provider.selectable && "cursor-not-allowed opacity-45")}>
													<span className={styles.menuItemIcon}>{selected ? <Check className="size-4" /> : provider.id === "self-hosted" ? <Cpu className="size-4" /> : <Columns2 className="size-4" />}</span>
													<span className={styles.menuItemCopy}><strong>{provider.label}</strong><small>{provider.model}{unavailableReason ? ` · ${unavailableReason}` : ""}</small></span>
												</button>
											);
										})}
										<Link href="/compare" className={styles.menuItem} onClick={() => setModelMenuOpen(false)}><span className={styles.menuItemIcon}><Columns2 className="size-4" aria-hidden /></span><span className={styles.menuItemCopy}><strong>Open Model Lab</strong><small>Compare multiple configured providers side by side</small></span></Link>
									</div>
									{modelMessage ? <p className="m-2 rounded-md border border-red-400/15 bg-red-400/[0.05] px-2 py-1.5 text-[9px] text-red-300" role="status">{modelMessage}</p> : null}
								</div>
							) : null}
						</div>
					</div>

					<div className={styles.actions}>
						{voiceAvailable ? <button type="button" onClick={toggleVoice} disabled={busy} className={cn(styles.iconControl, listening && styles.active)} aria-label={listening ? "Stop voice input" : "Start voice input"}>{listening ? <MicOff className="size-4" strokeWidth={1.7} /> : <Mic className="size-4" strokeWidth={1.7} />}</button> : null}
						{isBusy && onCancel ? <button type="button" onClick={onCancel} className={styles.stop} aria-label="Stop generating"><Square className="size-3.5 fill-current" strokeWidth={1.8} aria-hidden /></button> : <button type="submit" disabled={!canSubmit} className={styles.send} aria-label="Send to AIRA AI"><ArrowUp className="size-4" strokeWidth={2} aria-hidden /></button>}
					</div>
				</div>
			</div>
			<p className={styles.disclaimer}>AIRA can make mistakes. Verify important information.</p>
		</form>
	);
});