"use client";

import { Brain, Loader2, Pin, Plus, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createMemory,
  deleteMemory,
  listMemories,
  setMemoryPinned,
  type MemoryKind,
  type UserMemory,
} from "@/src/v2/compat/aira-api";

const MEMORY_KINDS: readonly { readonly value: MemoryKind; readonly label: string }[] = [
  { value: "PREFERENCE", label: "Preference" },
  { value: "GOAL", label: "Goal" },
  { value: "PROJECT", label: "Project" },
  { value: "DECISION", label: "Decision" },
  { value: "CONSTRAINT", label: "Constraint" },
  { value: "PROFILE", label: "Profile" },
  { value: "RELATIONSHIP", label: "Relationship" },
  { value: "OTHER", label: "Other" },
] as const;

function kindLabel(kind: MemoryKind): string {
  return MEMORY_KINDS.find((item) => item.value === kind)?.label ?? kind;
}

function formatUpdated(iso: string): string {
  const value = new Date(iso).getTime();
  if (!Number.isFinite(value)) return "";
  const days = Math.floor((Date.now() - value) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(value);
}

export function MemoryWorkspacePanel({ authenticated }: { readonly authenticated: boolean }) {
  const [memories, setMemories] = useState<readonly UserMemory[]>([]);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<MemoryKind>("PREFERENCE");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...memories].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
    [memories],
  );

  const refresh = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    try {
      setMemories(await listMemories());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Memory could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    const trimmed = content.trim();
    if (trimmed.length < 3 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const memory = await createMemory({ content: trimmed, kind, pinned: true });
      setMemories((current) => [memory, ...current.filter((item) => item.id !== memory.id)]);
      setContent("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Memory could not be saved.");
    } finally {
      setSaving(false);
    }
  }, [content, kind, saving]);

  const togglePinned = useCallback(async (memory: UserMemory) => {
    if (mutatingId) return;
    setMutatingId(memory.id);
    setError(null);
    try {
      await setMemoryPinned(memory.id, !memory.pinned);
      setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, pinned: !memory.pinned } : item));
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Memory could not be updated.");
    } finally {
      setMutatingId(null);
    }
  }, [mutatingId]);

  const remove = useCallback(async (memory: UserMemory) => {
    if (pendingDeleteId !== memory.id) {
      setPendingDeleteId(memory.id);
      return;
    }
    if (mutatingId) return;
    setMutatingId(memory.id);
    setError(null);
    try {
      await deleteMemory(memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setPendingDeleteId(null);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Memory could not be deleted.");
    } finally {
      setMutatingId(null);
    }
  }, [mutatingId, pendingDeleteId]);

  if (!authenticated) {
    return (
      <section className="v2-module-page">
        <div className="v2-module-heading"><div><p className="v2-eyebrow">CONTEXT</p><h1>Memory</h1></div></div>
        <div className="v2-empty-card">
          <strong>Sign in to use persistent memory.</strong>
          <p>AIRA memory is private to your account and remains enforced by the existing backend ownership checks.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="v2-module-page v2-memory-workspace">
      <div className="v2-module-heading">
        <div>
          <p className="v2-eyebrow">PRIVATE CONTEXT</p>
          <h1>Memory</h1>
        </div>
        <button className="v2-text-action" type="button" onClick={() => void refresh()} disabled={loading}>
          <RotateCw className={loading ? "spin" : ""} aria-hidden /> Refresh
        </button>
      </div>

      <div className="v2-memory-create">
        <div className="v2-memory-create-copy">
          <Brain aria-hidden />
          <div>
            <strong>Teach AIRA something durable</strong>
            <span>Use memory for stable preferences, goals, projects, decisions, and constraints—not secrets.</span>
          </div>
        </div>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Example: I prefer concise executive summaries with a short action list."
          maxLength={600}
          rows={3}
          disabled={saving}
          aria-label="Memory content"
        />
        <div className="v2-memory-create-actions">
          <select value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)} disabled={saving} aria-label="Memory type">
            {MEMORY_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <span>{content.length}/600</span>
          <button type="button" onClick={() => void save()} disabled={saving || content.trim().length < 3}>
            {saving ? <Loader2 className="spin" aria-hidden /> : <Plus aria-hidden />}
            Save memory
          </button>
        </div>
      </div>

      {error ? <div className="v2-error"><strong>Memory action failed</strong><span>{error}</span></div> : null}

      <div className="v2-memory-list-head">
        <span>Stored memories</span>
        <small>{memories.length}</small>
      </div>

      {loading && memories.length === 0 ? (
        <div className="v2-panel-empty"><Loader2 className="spin" aria-hidden /> Loading memory…</div>
      ) : sorted.length === 0 ? (
        <div className="v2-empty-card"><strong>No saved memories yet.</strong><p>AIRA will also curate useful non-sensitive memory from authenticated conversations when the existing backend decides it is appropriate.</p></div>
      ) : (
        <div className="v2-memory-list">
          {sorted.map((memory) => (
            <article key={memory.id} className="v2-memory-row">
              <div className="v2-memory-row-head">
                <div>
                  <span className="v2-memory-kind">{kindLabel(memory.kind)}</span>
                  {memory.pinned ? <span className="v2-memory-pinned"><Pin aria-hidden /> Pinned</span> : null}
                </div>
                <time>{formatUpdated(memory.updatedAt)}</time>
              </div>
              <p>{memory.content}</p>
              <div className="v2-memory-row-foot">
                <span>Importance {memory.importance}/5 · recalled {memory.recallCount}×</span>
                <div>
                  <button type="button" onClick={() => void togglePinned(memory)} disabled={mutatingId === memory.id} aria-pressed={memory.pinned}>
                    <Pin aria-hidden /> {memory.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    className={pendingDeleteId === memory.id ? "danger-confirm" : ""}
                    onClick={() => void remove(memory)}
                    onBlur={() => setPendingDeleteId((current) => current === memory.id ? null : current)}
                    disabled={mutatingId === memory.id}
                  >
                    <Trash2 aria-hidden /> {pendingDeleteId === memory.id ? "Confirm delete" : "Delete"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
