"use client";

import { Brain, Pin, PinOff, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import styles from "./MemoryManager.module.css";

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

function dateLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(timestamp));
}

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
      const response = await fetch("/api/memory?limit=200", {
        cache: "no-store",
        credentials: "include",
      });
      const data = (await response.json().catch(() => null)) as { memories?: MemoryItem[]; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not load memory.");
      setMemories(data?.memories ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load memory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const selectedMemoryExists = useMemo(
    () => Boolean(selectedMemoryId && memories.some((memory) => memory.id === selectedMemoryId)),
    [memories, selectedMemoryId],
  );

  useEffect(() => {
    if (loading || !selectedMemoryId || !selectedMemoryExists) return;
    const id = window.setTimeout(() => {
      document.getElementById(`memory-${selectedMemoryId}`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      });
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
      const response = await fetch("/api/memory", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, kind, pinned: true }),
      });
      const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not save memory.");
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
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: memory.id, pinned: !memory.pinned }),
      });
      const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not update memory.");
      setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, pinned: !memory.pinned } : item));
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
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: memory.id }),
      });
      const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not delete memory.");
      setMemories((current) => current.filter((item) => item.id !== memory.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete memory.");
    } finally {
      setBusyId(null);
    }
  }

  const pinnedCount = useMemo(() => memories.filter((memory) => memory.pinned).length, [memories]);

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="Memory controls">
        <form onSubmit={addMemory} className={cn(styles.panel, styles.form)}>
          <div className={styles.panelHeader}>
            <span className={styles.icon}><Plus className="size-4" aria-hidden /></span>
            <div>
              <h2>Remember useful context</h2>
              <p>Add a preference, project, goal, decision, or constraint that should persist.</p>
            </div>
          </div>

          <div className={styles.fields}>
            <label>
              <span className="sr-only">Memory type</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as (typeof KIND_OPTIONS)[number])}
                className={styles.select}
              >
                {KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option.toLowerCase()}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Memory content</span>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={600}
                rows={5}
                placeholder="Example: I prefer the recommendation first, followed by the reasoning."
                className={styles.textarea}
              />
            </label>
          </div>

          <button type="submit" disabled={!content.trim() || busyId === "new"} className={styles.primary}>
            <Brain className="size-4" aria-hidden /> {busyId === "new" ? "Saving…" : "Remember this"}
          </button>
        </form>

        <section className={cn(styles.panel, styles.privacy)} aria-label="Memory privacy">
          <span className={styles.privacyIcon}><ShieldCheck className="size-4" aria-hidden /></span>
          <div>
            <strong>Private by design</strong>
            <span>Credentials, passwords, API keys, authentication tokens, payment-card details, and similar secrets are rejected from memory.</span>
          </div>
        </section>
      </aside>

      <section className={cn(styles.panel, styles.library)} aria-label="Saved memory">
        <header className={styles.libraryHeader}>
          <div>
            <h2>Saved context</h2>
            <p>These are the memory records AIRA can use when relevant. Pinning keeps important items more prominent.</p>
          </div>
          <div className={styles.counts}>
            <span className={styles.count}>{memories.length} total</span>
            <span className={cn(styles.count, styles.countAccent)}>{pinnedCount} pinned</span>
          </div>
        </header>

        {selectedMemoryId && !loading && !selectedMemoryExists ? (
          <p className={styles.notice} role="status">That memory is no longer available. Showing your current memory list instead.</p>
        ) : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        {loading ? (
          <div className={styles.loading} aria-busy="true">
            <div><span className={styles.spinner} aria-hidden /><p>Loading memory…</p></div>
          </div>
        ) : memories.length === 0 ? (
          <div className={styles.empty}>
            <div>
              <span className={styles.emptyIcon}><Brain className="size-5" aria-hidden /></span>
              <strong>No saved memory yet</strong>
              <span>Add a useful preference, project, goal, decision, or constraint when you want AIRA to carry it into later work.</span>
            </div>
          </div>
        ) : (
          <ul className={styles.list}>
            {memories.map((memory) => {
              const selected = memory.id === selectedMemoryId;
              return (
                <li key={memory.id} className={styles.item}>
                  <article
                    id={`memory-${memory.id}`}
                    className={cn(styles.memory, selected && styles.selected)}
                    aria-current={selected ? "true" : undefined}
                  >
                    <div className={styles.memoryMain}>
                      <div className={styles.meta}>
                        <span className={styles.kind}>{memory.kind}</span>
                        {memory.pinned ? <span className={styles.pinned}>Pinned</span> : null}
                        {selected ? <span className={styles.searchResult}>Search result</span> : null}
                      </div>
                      <p className={styles.content}>{memory.content}</p>
                      <div className={styles.metrics}>
                        <span>Importance {memory.importance}/5</span>
                        <span>Confidence {Math.round(memory.confidence * 100)}%</span>
                        <span>Recalled {memory.recallCount} times</span>
                        <span>Updated {dateLabel(memory.updatedAt)}</span>
                      </div>
                    </div>

                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={memory.pinned ? "Unpin memory" : "Pin memory"}
                        aria-pressed={memory.pinned}
                        disabled={busyId === memory.id}
                        onClick={() => void togglePinned(memory)}
                        title={memory.pinned ? "Unpin memory" : "Pin memory"}
                      >
                        {memory.pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className={cn(styles.iconButton, styles.iconButtonDanger)}
                        aria-label="Delete memory"
                        disabled={busyId === memory.id}
                        onClick={() => void removeMemory(memory)}
                        title="Delete memory"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
