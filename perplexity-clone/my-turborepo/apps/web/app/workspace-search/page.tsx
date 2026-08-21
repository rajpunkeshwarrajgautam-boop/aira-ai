"use client";

import { Brain, Loader2, MessageSquare, Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type SearchResult = {
  type: "conversation" | "message" | "memory";
  id: string;
  title: string;
  snippet: string;
  role?: string;
  updatedAt?: string;
  href: string;
};

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
        .then(async (r) => {
          const data = (await r.json()) as { results?: SearchResult[]; error?: { message?: string } };
          if (!r.ok) throw new Error(data.error?.message ?? "Search failed.");
          setResults(data.results ?? []);
          setMessage(null);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setMessage(e instanceof Error ? e.message : "Search failed.");
        })
        .finally(() => setLoading(false));
    }, 260);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-5 py-7 md:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-7"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#a98b43]">Global search</p><h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#f2f2ee] md:text-3xl">Find anything AIRA remembers</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#8b9098]">Search persisted conversation titles, individual messages, and long-term memory from one place.</p></div>
            <div className="relative mb-5"><SearchIcon className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6d7279]" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations and memory…" className="h-14 w-full rounded-2xl border border-white/[0.09] bg-[#101318] pl-11 pr-12 text-sm text-[#f0f0ed] outline-none placeholder:text-[#626770] focus:border-[#c9a84c]/45" />{loading ? <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-[#a98b43]" /> : null}</div>
            {message ? <div className="mb-4 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-4 py-3 text-sm text-red-200">{message}</div> : null}
            <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1216]">
              <div className="border-b border-white/[0.07] px-5 py-4 text-xs text-[#737880]">{query.trim().length >= 2 ? `${results.length} matches` : "Type at least two characters"}</div>
              {results.length ? <ul className="divide-y divide-white/[0.06]">{results.map((result) => {
                const Icon = result.type === "memory" ? Brain : MessageSquare;
                return <li key={`${result.type}:${result.id}`}><Link href={result.href} className="flex gap-4 px-5 py-4 transition hover:bg-white/[0.025]"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-[#171a1f] text-[#9ca1a8]"><Icon className="size-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium text-[#e9e9e6]">{result.title}</p><span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#777c84]">{result.type}</span>{result.role ? <span className="text-[10px] uppercase text-[#686d75]">{result.role}</span> : null}</div><p className="mt-1 line-clamp-2 text-sm leading-6 text-[#858a92]">{result.snippet}</p></div></Link></li>;
              })}</ul> : <div className="px-6 py-16 text-center text-sm text-[#686d75]">{query.trim().length >= 2 && !loading ? "No matches found." : "Search your AIRA workspace."}</div>}
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
