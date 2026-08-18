"use client";

import { Brain, Pin, PinOff, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

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

	return (
		<div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
			<div className="space-y-4">
				<form onSubmit={addMemory} className="aira-card aira-fun-card rounded-3xl p-5">
					<div className="flex items-center gap-3">
						<span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent/15 to-violet-500/10 text-accent ring-1 ring-accent/10"><Plus className="size-4" aria-hidden /></span>
						<div><h2 className="text-sm font-semibold text-content-primary">Pin something important</h2><p className="mt-0.5 text-xs text-content-tertiary">AiraAI will prioritize it when relevant.</p></div>
					</div>
					<select value={kind} onChange={(event) => setKind(event.target.value as (typeof KIND_OPTIONS)[number])} className="mt-5 h-10 w-full rounded-xl border border-border-subtle bg-surface-inset/60 px-3 text-sm text-content-primary outline-none transition focus:border-accent/30 focus:bg-white focus:ring-4 focus:ring-accent/[0.06]">
						{KIND_OPTIONS.map((option) => <option key={option} value={option}>{option.toLowerCase()}</option>)}
					</select>
					<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={600} rows={5} placeholder="Example: I prefer concise answers with the recommendation first." className="mt-3 w-full resize-none rounded-2xl border border-border-subtle bg-surface-inset/60 px-3 py-3 text-sm leading-6 text-content-primary outline-none transition placeholder:text-content-tertiary focus:border-accent/30 focus:bg-white focus:ring-4 focus:ring-accent/[0.06]" />
					<Button type="submit" disabled={!content.trim() || busyId === "new"} className="aira-shine-button mt-3 h-10 w-full rounded-xl">Remember this</Button>
				</form>

				<div className="aira-glass rounded-3xl p-5">
					<div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-4.5 shrink-0 text-accent" aria-hidden /><div><p className="text-sm font-semibold text-content-primary">Private by design</p><p className="mt-1 text-xs leading-5 text-content-tertiary">Credentials, passwords, API keys, auth tokens, card details, and similar secrets are rejected from memory.</p></div></div>
				</div>
			</div>

			<section className="aira-card rounded-3xl p-5 sm:p-6">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
					<div><h2 className="text-base font-semibold text-content-primary">What AiraAI remembers</h2><p className="mt-1 text-xs text-content-tertiary">Pinned memories receive priority. Delete anything you no longer want retained.</p></div>
					<span className="rounded-full bg-gradient-to-r from-accent/[0.08] to-violet-500/[0.07] px-2.5 py-1 text-xs font-semibold text-content-secondary ring-1 ring-accent/10">{memories.length} memories</span>
				</div>

				{error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

				{loading ? (
					<div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-sm text-content-tertiary"><span className="aira-orbit-loader" aria-hidden /><span>Loading memory…</span></div>
				) : memories.length === 0 ? (
					<div className="py-14 text-center"><span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/10 to-violet-500/10 text-accent ring-1 ring-accent/10"><Brain className="size-5" /></span><p className="mt-4 text-sm font-semibold text-content-primary">No durable memories yet</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-content-tertiary">Tell Aira something useful in chat, or pin a memory from the panel on the left.</p></div>
				) : (
					<div className="space-y-1 pt-2">
						{memories.map((memory) => (
							<article key={memory.id} className="aira-memory-card px-3 py-4">
								<div className="flex gap-3">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-accent/[0.07] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-accent">{memory.kind}</span>{memory.pinned ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-content-secondary"><Pin className="size-3 text-accent" aria-hidden />Pinned</span> : null}<span className="text-[11px] text-content-tertiary">importance {memory.importance}/5</span></div>
										<p className="mt-2 text-sm leading-6 text-content-primary">{memory.content}</p>
										<p className="mt-2 text-[11px] text-content-tertiary">Recalled {memory.recallCount} times · updated {new Date(memory.updatedAt).toLocaleDateString()}</p>
									</div>
									<div className="flex shrink-0 items-start gap-1">
										<Button variant="ghost" size="sm" className="aira-pin-button size-8 rounded-xl p-0" aria-pressed={memory.pinned} disabled={busyId === memory.id} onClick={() => void togglePinned(memory)} title={memory.pinned ? "Unpin memory" : "Pin memory"}>{memory.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}</Button>
										<Button variant="ghost" size="sm" className="size-8 rounded-xl p-0 text-red-500 transition hover:bg-red-50 hover:text-red-600" disabled={busyId === memory.id} onClick={() => void removeMemory(memory)} title="Delete memory"><Trash2 className="size-4" /></Button>
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
