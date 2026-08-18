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

const KIND_OPTIONS = [
	"OTHER",
	"PREFERENCE",
	"GOAL",
	"PROJECT",
	"DECISION",
	"CONSTRAINT",
	"PROFILE",
	"RELATIONSHIP",
] as const;

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

	useEffect(() => {
		void loadMemories();
	}, [loadMemories]);

	async function addMemory(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = content.trim();
		if (!trimmed) return;
		setBusyId("new");
		setError(null);
		try {
			const response = await fetch("/api/memory", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: trimmed, kind, pinned: true }),
			});
			const data = (await response.json()) as { error?: { message?: string } };
			if (!response.ok) throw new Error(data.error?.message ?? "Could not save memory.");
			setContent("");
			await loadMemories();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not save memory.");
		} finally {
			setBusyId(null);
		}
	}

	async function togglePinned(memory: MemoryItem) {
		setBusyId(memory.id);
		setError(null);
		try {
			const response = await fetch("/api/memory", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: memory.id, pinned: !memory.pinned }),
			});
			if (!response.ok) throw new Error("Could not update memory.");
			setMemories((current) =>
				current.map((item) =>
					item.id === memory.id ? { ...item, pinned: !memory.pinned } : item,
				),
			);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not update memory.");
		} finally {
			setBusyId(null);
		}
	}

	async function removeMemory(memory: MemoryItem) {
		setBusyId(memory.id);
		setError(null);
		try {
			const response = await fetch("/api/memory", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: memory.id }),
			});
			if (!response.ok) throw new Error("Could not delete memory.");
			setMemories((current) => current.filter((item) => item.id !== memory.id));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not delete memory.");
		} finally {
			setBusyId(null);
		}
	}

	return (
		<div className="space-y-6">
		<section className="rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-sm">
			<div className="flex items-start gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
					<Brain className="size-5" aria-hidden />
				</span>
				<div>
					<h2 className="text-lg font-semibold text-content-primary">Persistent memory</h2>
					<p className="mt-1 text-sm leading-6 text-content-secondary">
						AIRA automatically keeps stable preferences, goals, projects, decisions, and constraints from signed-in conversations. Relevant memories are recalled across new chats.
					</p>
				</div>
			</div>
			<div className="mt-4 flex items-start gap-2 rounded-xl border border-border-subtle bg-surface-inset px-3 py-2.5 text-xs leading-5 text-content-secondary">
				<ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
				<span>Credentials, passwords, API keys, authentication tokens, payment-card details, and similar secrets are rejected from automatic and manual memory.</span>
			</div>
		</section>

		<form onSubmit={addMemory} className="rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-sm">
			<h3 className="text-sm font-semibold text-content-primary">Add a pinned memory</h3>
			<p className="mt-1 text-xs text-content-secondary">Use this for something you always want AIRA to remember.</p>
			<div className="mt-4 grid gap-3 md:grid-cols-[160px_1fr_auto]">
				<select
					value={kind}
					onChange={(event) => setKind(event.target.value as (typeof KIND_OPTIONS)[number])}
					className="h-10 rounded-xl border border-border-subtle bg-surface-inset px-3 text-sm text-content-primary outline-none focus:ring-2 focus:ring-accent/40"
				>
					{KIND_OPTIONS.map((option) => (
						<option key={option} value={option}>{option.toLowerCase()}</option>
					))}
				</select>
				<input
					value={content}
					onChange={(event) => setContent(event.target.value)}
					maxLength={600}
					placeholder="Example: I prefer concise answers with the recommendation first."
					className="h-10 rounded-xl border border-border-subtle bg-surface-inset px-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary focus:ring-2 focus:ring-accent/40"
				/>
				<Button type="submit" disabled={!content.trim() || busyId === "new"} className="h-10 rounded-xl">
					<Plus className="mr-1.5 size-4" aria-hidden />
					Remember
				</Button>
			</div>
		</form>

		{error ? (
			<div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">{error}</div>
		) : null}

		<section className="space-y-3">
			<div className="flex items-end justify-between gap-3">
				<div>
					<h3 className="text-base font-semibold text-content-primary">What AIRA remembers</h3>
					<p className="mt-1 text-xs text-content-secondary">Pinned memories receive priority. Delete anything you no longer want retained.</p>
				</div>
				<span className="rounded-full bg-surface-inset px-2.5 py-1 text-xs font-medium text-content-secondary">{memories.length} memories</span>
			</div>

			{loading ? (
				<div className="rounded-2xl border border-border-subtle bg-surface-raised p-6 text-sm text-content-secondary">Loading memory…</div>
			) : memories.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-border-subtle bg-surface-raised p-8 text-center">
					<Brain className="mx-auto size-7 text-content-tertiary" aria-hidden />
					<p className="mt-3 text-sm font-medium text-content-primary">No durable memories yet</p>
					<p className="mt-1 text-xs text-content-secondary">Tell AIRA something useful in chat, or add a pinned memory above.</p>
				</div>
			) : (
				<div className="grid gap-3">
					{memories.map((memory) => (
						<article key={memory.id} className="rounded-2xl border border-border-subtle bg-surface-raised p-4 shadow-sm">
							<div className="flex gap-3">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">{memory.kind}</span>
										{memory.pinned ? <span className="text-[11px] font-medium text-content-secondary">Pinned</span> : null}
										<span className="text-[11px] text-content-tertiary">importance {memory.importance}/5</span>
									</div>
									<p className="mt-2 text-sm leading-6 text-content-primary">{memory.content}</p>
									<p className="mt-2 text-[11px] text-content-tertiary">Recalled {memory.recallCount} times · updated {new Date(memory.updatedAt).toLocaleDateString()}</p>
								</div>
								<div className="flex shrink-0 items-start gap-1">
									<Button variant="ghost" size="sm" className="size-8 p-0" disabled={busyId === memory.id} onClick={() => void togglePinned(memory)} title={memory.pinned ? "Unpin memory" : "Pin memory"}>
										{memory.pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
									</Button>
									<Button variant="ghost" size="sm" className="size-8 p-0 text-red-500 hover:text-red-600" disabled={busyId === memory.id} onClick={() => void removeMemory(memory)} title="Delete memory">
										<Trash2 className="size-4" aria-hidden />
									</Button>
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
