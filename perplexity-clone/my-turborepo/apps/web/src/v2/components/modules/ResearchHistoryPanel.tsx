"use client";

import { Clock3, FileSearch, History } from "lucide-react";

import type { ResearchHistoryRow } from "@/src/v2/compat/aira-api";

function formatWhen(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function ResearchHistoryPanel({
  rows,
  selectedConversationId,
  onSelectConversation,
}: {
  readonly rows: readonly ResearchHistoryRow[];
  readonly selectedConversationId: string | null;
  readonly onSelectConversation: (conversationId: string) => void;
}) {
  return (
    <section className="v2-history-panel" aria-labelledby="v2-history-title">
      <div className="v2-context-section-head">
        <div>
          <History aria-hidden />
          <strong id="v2-history-title">Research history</strong>
        </div>
        <span>{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <p className="v2-context-empty">Completed signed-in research queries will appear here.</p>
      ) : (
        <div className="v2-history-list">
          {rows.slice(0, 20).map((row) => {
            const active = row.conversationId === selectedConversationId;
            return (
              <button
                key={row.id}
                type="button"
                data-active={active ? "true" : "false"}
                disabled={!row.conversationId}
                onClick={() => row.conversationId && onSelectConversation(row.conversationId)}
              >
                <FileSearch aria-hidden />
                <span>
                  <strong>{row.query}</strong>
                  <small>
                    <Clock3 aria-hidden /> {formatWhen(row.createdAt)}
                    {row.citationCount > 0 ? ` · ${row.citationCount} sources` : ""}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
