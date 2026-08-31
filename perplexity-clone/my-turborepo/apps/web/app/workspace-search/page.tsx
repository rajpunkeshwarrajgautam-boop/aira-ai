"use client";

import {
  Brain,
  FileText,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Search as SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import styles from "./workspace-search.module.css";

type SearchResult = {
  readonly type: "conversation" | "message" | "memory" | "knowledge";
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly role?: string;
  readonly status?: string;
  readonly updatedAt?: string;
  readonly href: string;
};

function resultIcon(type: SearchResult["type"]) {
  if (type === "memory") return Brain;
  if (type === "knowledge") return FileText;
  if (type === "conversation") return MessagesSquare;
  return MessageSquare;
}

function relativeDate(value?: string): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "Now";
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

export default function WorkspaceSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setMessage(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/global-search?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = (await response.json()) as {
            results?: SearchResult[];
            error?: { message?: string };
          };
          if (!response.ok) throw new Error(data.error?.message ?? "Search failed.");
          setResults(data.results ?? []);
          setMessage(null);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setMessage(error instanceof Error ? error.message : "Search failed.");
          setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const resultKinds = useMemo(() => new Set(results.map((result) => result.type)).size, [results]);
  const hasQuery = query.trim().length >= 2;

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={styles.page}>
          <div className={styles.inner}>
            <header className={styles.header}>
              <p className={styles.eyebrow}>Workspace search</p>
              <h1 className={styles.title}>Find work across AIRA</h1>
              <p className={styles.description}>
                Search saved conversations, individual messages, long-term memory, and indexed file metadata from one place.
              </p>
            </header>

            <div className={styles.search}>
              <SearchIcon className={styles.searchIcon} aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search conversations, messages, memory, files…"
                className={styles.input}
                aria-label="Search AIRA workspace"
                aria-describedby="workspace-search-summary"
              />
              {loading ? <Loader2 className={styles.spinner} aria-hidden /> : null}
            </div>

            {message ? <p className={styles.error} role="alert">{message}</p> : null}

            <section className={styles.results} aria-label="Workspace search results">
              <div className={styles.summary} id="workspace-search-summary" aria-live="polite">
                <span>
                  {!hasQuery
                    ? "Type at least two characters"
                    : loading
                      ? "Searching your workspace…"
                      : `${results.length} ${results.length === 1 ? "match" : "matches"}${results.length ? ` across ${resultKinds} ${resultKinds === 1 ? "type" : "types"}` : ""}`}
                </span>
                <kbd>⌘K</kbd>
              </div>

              {results.length ? (
                <ul className={styles.list}>
                  {results.map((result) => {
                    const Icon = resultIcon(result.type);
                    return (
                      <li key={`${result.type}:${result.id}`} className={styles.row}>
                        <Link href={result.href} className={styles.result}>
                          <span className={styles.icon} aria-hidden><Icon className="size-4" /></span>
                          <span className={styles.copy}>
                            <span className={styles.resultTitle}>{result.title}</span>
                            <span className={styles.meta}>
                              <span className={styles.type}>{result.type}</span>
                              {result.role ? <span>{result.role}</span> : null}
                              {result.status ? <span>{result.status}</span> : null}
                            </span>
                            <span className={styles.snippet}>{result.snippet}</span>
                          </span>
                          <span className={styles.time}>{relativeDate(result.updatedAt)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className={styles.empty}>
                  <strong>{hasQuery && !loading ? "No matching workspace content" : "Search your AIRA workspace"}</strong>
                  <span>{hasQuery && !loading ? "Try a broader phrase or search a different workspace term." : "Conversation, memory, and available knowledge results will appear here."}</span>
                </div>
              )}
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
