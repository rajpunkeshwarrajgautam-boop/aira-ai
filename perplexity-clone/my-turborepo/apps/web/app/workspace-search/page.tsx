"use client";

import { Brain, Boxes, FileText, FolderOpen, Loader2, MessageSquare, Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type SearchResult = {
  type: "conversation" | "message" | "memory" | "project" | "artifact" | "knowledge";
  id: string;
  title: string;
  snippet: string;
  role?: string;
  updatedAt?: string;
  href: string;
};

function iconFor(type: SearchResult["type"]) {
  if (type === "memory") return Brain;
  if (type === "project") return Boxes;
  if (type === "artifact") return FileText;
  if (type === "knowledge") return FolderOpen;
  return MessageSquare;
}

export default function WorkspaceSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setMessage(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/global-search?q=${encodeURIComponent(q)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const data = (await response.json()) as { results?: SearchResult[]; error?: { message?: string } };
          if (!response.ok) throw new Error(data.error?.message ?? "Search failed.");
          setResults(data.results ?? []); setMessage(null);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setMessage(cause instanceof Error ? cause.message : "Search failed.");
        })
        .finally(() => setLoading(false));
    }, 260);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-5 py-7 text-[#111115] md:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-7">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">Global search</p>
              <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#111115] md:text-3xl">Find persisted AIRA work</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">Search conversations, individual messages, memory, projects, durable artifacts and knowledge assets from one authenticated endpoint.</p>
            </div>
            <div className="relative mb-5">
              <SearchIcon className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#8F8E98]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversations, projects, artifacts, memory and knowledge…"
                className="h-14 w-full rounded-2xl border border-[rgba(17,17,21,0.12)] bg-white pl-11 pr-12 text-sm text-[#111115] shadow-xs outline-none placeholder:text-[#8F8E98] focus:border-[#3A0CA3]"
              />
              {loading ? <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-[#3A0CA3]" /> : null}
            </div>
            {message ? <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</div> : null}
            <section className="overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs">
              <div className="border-b border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-5 py-4 text-xs font-medium text-[#6B6A75]">
                {query.trim().length >= 2 ? `${results.length} matches` : "Type at least two characters"}
              </div>
              {results.length ? (
                <ul className="divide-y divide-[rgba(17,17,21,0.06)]">
                  {results.map((result) => {
                    const Icon = iconFor(result.type);
                    return (
                      <li key={`${result.type}:${result.id}`}>
                        <Link href={result.href} className="flex gap-4 px-5 py-4 transition hover:bg-[#FAF9F6]">
                          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]">
                            <Icon className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium text-[#111115]">{result.title}</p>
                              <span className="rounded-full border border-[rgba(17,17,21,0.1)] bg-[#FAF9F6] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#6B6A75]">{result.type}</span>
                              {result.role ? <span className="text-[10px] uppercase text-[#8F8E98]">{result.role}</span> : null}
                            </div>
                            <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#6B6A75]">{result.snippet}</p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="px-6 py-16 text-center text-sm text-[#8F8E98]">
                  {query.trim().length >= 2 && !loading ? "No matches found." : "Search your AIRA workspace."}
                </div>
              )}
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
