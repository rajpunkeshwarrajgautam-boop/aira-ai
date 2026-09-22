"use client";

import { Brain, Pin, PinOff, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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
	const searchParams = useSearchParams();
	const selectedMemoryId = searchParams.get("memory")?.trim() ?? null;
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

	const selectedMemoryExists = useMemo(
		() => Boolean(selectedMemoryId && memories.some((memory) => memory.id === selectedMemoryId)),
		[memories, selectedMemoryId],
	);

	useEffect(() => {
		if (loading || !selectedMemoryId || !selectedMemoryExists) return;
		const id = window.setTimeout(() => {
			document.getElementById(`memory-${selectedMemoryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
		}, 80);
		return () => window.clearTimeout(id);
	}, [loading, selectedMemoryExists, selectedMemoryId]);

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
				<form onSubmit={addMemory} className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
					<div className="flex items-center gap-3">
						<span className="flex size-9 items-center justify-center rounded-xl bg-[#3A0CA3]/[0.08] text-[#3A0CA3]"><Plus className="size-4" aria-hidden /></span>
						<div><h2 className="text-sm font-semibold text-[#111115]">Pin something important</h2><p className="mt-0.5 text-xs text-[#6B6A75]">Give Aira context worth carrying forward.</p></div>
					</div>
					<div className="mt-4 rounded-xl border border-[rgba(17,17,21,0.1)] bg-[#FAF9F6] p-2.5">
						<select value={kind} onChange={(event) => setKind(event.target.value as (typeof KIND_OPTIONS)[number])} className="h-9 w-full rounded-lg border border-[rgba(17,17,21,0.08)] bg-white px-3 text-xs font-medium text-[#111115] outline-none focus:border-[#3A0CA3] capitalize">
							{KIND_OPTIONS.map((option) => <option key={option} value={option} className="capitalize">{option.toLowerCase()}</option>)}
						</select>
						<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={600} rows={5} placeholder="Example: I prefer the recommendation first, then the reasoning." className="mt-2 w-full resize-none rounded-lg border-0 bg-transparent px-2 py-2 text-sm leading-6 text-[#111115] outline-none placeholder:text-[#8F8E98]" />
					</div>
					<button type="submit" disabled={!content.trim() || busyId === "new"} className="mt-3 flex h-10 w-full items-center justify-center rounded-xl bg-[#3A0CA3] px-4 text-sm font-medium text-white shadow-xs transition hover:bg-[#2D0A82] disabled:cursor-not-allowed disabled:border disabled:border-[rgba(17,17,21,0.08)] disabled:bg-[rgba(17,17,21,0.04)] disabled:text-[#8F8E98]">Remember this</button>
				</form>

				<div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
					<div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><ShieldCheck className="size-4" aria-hidden /></span><div><p className="text-xs font-semibold text-[#111115]">Private by design</p><p className="mt-0.5 text-xs leading-5 text-[#6B6A75]">Credentials, passwords, API keys, auth tokens, card details, and similar secrets are rejected from memory.</p></div></div>
				</div>
			</div>

			<section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs sm:p-6">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(17,17,21,0.08)] pb-4">
					<div><h2 className="text-base font-semibold text-[#111115]">Your memory garden</h2><p className="mt-0.5 text-xs text-[#6B6A75]">Pinned memories stay closest to Aira when context matters.</p></div>
					<div className="flex items-center gap-2"><span className="rounded-full border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-2.5 py-1 text-xs text-[#6B6A75]">{memories.length} total</span><span className="rounded-full bg-[#3A0CA3]/[0.08] px-2.5 py-1 text-xs font-medium text-[#3A0CA3]">{pinnedCount} pinned</span></div>
				</div>

				{selectedMemoryId && !loading && !selectedMemoryExists ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800" role="status">That memory is no longer available. Showing your current memory list instead.</div> : null}
				{error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div> : null}

				{loading ? (
					<div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-sm text-[#8F8E98]"><span className="size-6 animate-spin rounded-full border-2 border-[#3A0CA3] border-t-transparent" aria-hidden /><span>Loading memory…</span></div>
				) : memories.length === 0 ? (
					<div className="py-14 text-center"><span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-[#FAF9F6] border border-[rgba(17,17,21,0.08)] text-[#6B6A75]"><Brain className="size-5" /></span><p className="mt-4 text-sm font-semibold text-[#111115]">Nothing planted yet</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[#6B6A75]">Pin a useful preference, project, goal, or constraint and Aira can carry it into future conversations.</p></div>
				) : (
					<div className="mt-5 grid gap-3 sm:grid-cols-2">
						{memories.map((memory) => {
							const selected = memory.id === selectedMemoryId;
							return (
								<article id={`memory-${memory.id}`} key={memory.id} className={cn("relative scroll-mt-28 rounded-xl border p-4 transition", selected ? "border-[#3A0CA3] bg-[#FAF9F6] shadow-2xs ring-1 ring-[#3A0CA3]" : memory.pinned ? "border-[rgba(58,12,163,0.2)] bg-[#FAF9F6]" : "border-[rgba(17,17,21,0.08)] bg-white")} aria-current={selected ? "true" : undefined}>
									{memory.pinned ? <Sparkles className="absolute right-3 top-3 size-3.5 text-[#3A0CA3]" aria-hidden /> : null}
									<div className="flex flex-wrap items-center gap-2 pr-5"><span className="rounded-full bg-white border border-[rgba(17,17,21,0.08)] px-2 py-0.5 text-[11px] font-medium text-[#3A0CA3] capitalize">{memory.kind.toLowerCase()}</span>{memory.pinned ? <span className="text-xs font-medium text-[#6B6A75]">Pinned</span> : null}{selected ? <span className="rounded-full bg-[#3A0CA3] px-2 py-0.5 text-[11px] font-medium text-white">Search result</span> : null}</div>
									<p className="mt-2.5 text-sm leading-6 text-[#111115]">{memory.content}</p>
									<div className="mt-4 flex items-end justify-between gap-2 border-t border-[rgba(17,17,21,0.06)] pt-3">
										<div><p className="text-xs text-[#6B6A75]">Importance {memory.importance}/5</p><p className="mt-0.5 text-[11px] text-[#8F8E98]">Recalled {memory.recallCount} times · {new Date(memory.updatedAt).toLocaleDateString()}</p></div>
										<div className="flex shrink-0 gap-1">
											<Button variant="ghost" size="sm" className="size-8 rounded-lg p-0 text-[#6B6A75] hover:bg-[#FAF9F6] hover:text-[#111115]" aria-pressed={memory.pinned} disabled={busyId === memory.id} onClick={() => void togglePinned(memory)} title={memory.pinned ? "Unpin memory" : "Pin memory"}>{memory.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}</Button>
											<Button variant="ghost" size="sm" className="size-8 rounded-lg p-0 text-red-500 hover:bg-red-50 hover:text-red-600" disabled={busyId === memory.id} onClick={() => void removeMemory(memory)} title="Delete memory"><Trash2 className="size-4" /></Button>
										</div>
									</div>
								</article>
							);
						})}
					</div>
				)}
			</section>
		</div>
	);
}
