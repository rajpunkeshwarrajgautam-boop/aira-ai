"use client";

import { Brain, Pin, PinOff, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface MemoryItem {
	readonly id: string;
	readonly memoryKey: string;
	readonly kind: string;
	readonly content: string;
	readonly importance: number;
	readonly confidence: number;
	readonly pinned: boolean;
	readonly recallCount: number;
	readonly updatedAt: string;
}

const KIND_OPTIONS = ["OTHER", "PREFERENCE", "GOAL", "PROJECT", "DECISION", "CONSTRAINT", "PROFILE", "RELATIONSHIP"] as const;

export function MemoryManager() {
	const [memories, setMemories] = useState<MemoryItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [content, setContent] = useState("");
	const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]>("OTHER");
	const [error, setError] = useState<string | null>(null);

	const loadMemories = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await fetch("/api/memory?limit=200", { cache: "no-store" });
			if (!response.ok) throw new Error("Could not load memory.");
			const data = (await response.json()) as { memories?: MemoryItem[] };
			setMemories(data.memories ?? []);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not load memory.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { void loadMemories(); }, [loadMemories]);

	async function addMemory(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = content.trim();
		if (!trimmed) return;
		setBusyId("new");
		setError(null);
		try {
			const response = await fetch("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: trimmed, kind, pinned: true }) });
			const data = (await response.json()) as { error?: { message?: string } };
			if (!response.ok) throw new Error(data.error?.message ?? "Could not save memory.");
			setContent("");
			await loadMemories();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not save memory.");
		} finally { setBusyId(null); }
	}

	async function togglePinned(memory: MemoryItem) {
		setBusyId(memory.id);
		setError(null);
		try {
			const response = await fetch("/api/memory", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: memory.id, pinned: !memory.pinned }) });
			if (!response.ok) throw new Error("Could not update memory.");
			setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, pinned: !memory.pinned } : item));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not update memory.");
		} finally { setBusyId(null); }
	}

	async function removeMemory(memory: MemoryItem) {
		setBusyId(memory.id);
		setError(null);
		try {
			const response = await fetch("/api/memory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: memory.id }) });
			if (!response.ok) throw new Error("Could not delete memory.");
			setMemories((current) => current.filter((item) => item.id !== memory.id));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not delete memory.");
		} finally { setBusyId(null); }
	}

	const pinnedCount = memories.filter((memory) => memory.pinned).length;

	return (
		<div className="grid gap-5 lg:grid-cols-[350px_minmax(0,1fr)]">
			<div className="space-y-4">
				<form onSubmit={addMemory} className="aira-premium-card relative overflow-hidden rounded-3xl p-5">
					<span className="pointer-events-none absolute -right-12 -top-14 size-40 rounded-full bg-[radial-gradient(circle,hsl(var(--accent-violet)/0.13),transparent_68%)]" aria-hidden />
					<div className="relative flex items-center gap-3">
						<span className="aira-icon-pop flex size-10 items-center justify-center rounded-2xl"><Plus className="size-4.5" aria-hidden /></span>
						<div><h2 className="text-sm font-semibold text-content-primary">Pin something important</h2><p className="mt-0.5 text-xs text-content-tertiary">Give Aira context worth carrying forward.</p></div>
					</div>
					<div className="relative mt-5 rounded-2xl border border-border-subtle bg-white/70 p-2 shadow-inner">
						<select value={kind} onChange={(event) => setKind(event.target.value as (typeof KIND_OPTIONS)[number])} className="h-9 w-full rounded-xl border-0 bg-surface-inset/70 px-3 text-sm font-medium text-content-primary outline-none focus:ring-2 focus:ring-accent/20">
							{KIND_OPTIONS.map((option) => <option key={option} value={option}>{option.toLowerCase()}</option>)}
						</select>
						<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={600} rows={5} placeholder="Example: I prefer the recommendation first, then the reasoning." className="mt-2 w-full resize-none rounded-2xl border-0 bg-transparent px-2 py-2 text-sm leading-6 text-content-primary outline-none placeholder:text-content-tertiary focus:ring-0" />
					</div>
					<Button type="submit" disabled={!content.trim() || busyId === "new"} className="relative mt-3 h-10 w-full rounded-xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))] shadow-[0_8px_24px_hsl(var(--accent)/0.18)]">Remember this</Button>
				</form>

				<div className="aira-glass rounded-3xl p-5">
					<div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700"><ShieldCheck className="size-4.5" aria-hidden /></span><div><p className="text-sm font-semibold text-content-primary">Private by design</p><p className="mt-1 text-xs leading-5 text-content-tertiary">Credentials, passwords, API keys, auth tokens, card details, and similar secrets are rejected from memory.</p></div></div>
				</div>
			</div>

			<section className="aira-premium-card rounded-3xl p-5 sm:p-6">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
					<div><h2 className="text-base font-semibold text-content-primary">Your memory garden</h2><p className="mt-1 text-xs text-content-tertiary">Pinned memories stay closest to Aira when context matters.</p></div>
					<div className="flex items-center gap-2"><span className="rounded-full bg-surface-inset px-2.5 py-1 text-xs font-medium text-content-secondary">{memories.length} total</span><span className="rounded-full bg-accent/[0.08] px-2.5 py-1 text-xs font-medium text-accent">{pinnedCount} pinned</span></div>
				</div>

				{error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

				{loading ? (
					<div className="py-12 text-center text-sm text-content-tertiary">Loading memory…</div>
				) : memories.length === 0 ? (
					<div className="py-14 text-center"><span className="aira-icon-pop mx-auto flex size-12 items-center justify-center rounded-2xl"><Brain className="size-5" /></span><p className="mt-4 text-sm font-semibold text-content-primary">Nothing planted yet</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-content-tertiary">Pin a useful preference, project, goal, or constraint and Aira can carry it into future conversations.</p></div>
				) : (
					<div className="mt-5 grid gap-3 sm:grid-cols-2">
						{memories.map((memory) => (
							<article key={memory.id} className={cn("aira-card-hover relative rounded-2xl border p-4", memory.pinned ? "border-accent/20 bg-[linear-gradient(145deg,hsl(var(--accent)/0.045),hsl(var(--accent-violet)/0.025),white)]" : "border-border-subtle bg-white/70")}>
								{memory.pinned ? <Sparkles className="absolute right-3 top-3 size-3.5 text-accent/70" aria-hidden /> : null}
								<div className="flex flex-wrap items-center gap-2 pr-5"><span className="rounded-full bg-accent/[0.07] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-accent">{memory.kind}</span>{memory.pinned ? <span className="text-[11px] font-medium text-content-secondary">Pinned</span> : null}</div>
								<p className="mt-3 text-sm leading-6 text-content-primary">{memory.content}</p>
								<div className="mt-4 flex items-end justify-between gap-2">
									<div><p className="text-[10px] uppercase tracking-[0.1em] text-content-tertiary">importance {memory.importance}/5</p><p className="mt-1 text-[10px] text-content-tertiary">Recalled {memory.recallCount} times · {new Date(memory.updatedAt).toLocaleDateString()}</p></div>
									<div className="flex shrink-0 gap-1">
										<Button variant="ghost" size="sm" className="size-8 rounded-xl p-0" disabled={busyId === memory.id} onClick={() => void togglePinned(memory)} title={memory.pinned ? "Unpin memory" : "Pin memory"}>{memory.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}</Button>
										<Button variant="ghost" size="sm" className="size-8 rounded-xl p-0 text-red-500 hover:bg-red-50 hover:text-red-600" disabled={busyId === memory.id} onClick={() => void removeMemory(memory)} title="Delete memory"><Trash2 className="size-4" /></Button>
									</div>
								</div>
							</article>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
