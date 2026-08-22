"use client";

import { Check, Loader2, Play, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type Provider = { id: "openai" | "nvidia" | "omniroute"; label: string; configured: boolean; model: string };
type Result = { providerId: string; ok: boolean; text?: string; latencyMs?: number; error?: string };

export default function ComparePage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/compare", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? "Sign in to use model comparison." : "Could not load model providers.");
        return r.json() as Promise<{ providers: Provider[] }>;
      })
      .then((data) => {
        setProviders(data.providers);
        setSelected(data.providers.filter((p) => p.configured).slice(0, 2).map((p) => p.id));
      })
      .catch((e: unknown) => setMessage(e instanceof Error ? e.message : "Could not load providers."));
  }, []);

  const readyCount = useMemo(() => providers.filter((p) => p.configured).length, [providers]);

  async function runComparison() {
    if (prompt.trim().length < 2 || selected.length < 2) return;
    setLoading(true);
    setMessage(null);
    setResults([]);
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), providers: selected }),
      });
      const data = (await response.json()) as { results?: Result[]; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Comparison failed.");
      setResults(data.results ?? []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Comparison failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-5 py-7 md:px-8">
          <div className="mx-auto max-w-[1500px]">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#a98b43]">Evaluation lab</p>
                <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#f2f2ee] md:text-3xl">Compare models side by side</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#8b9098]">Send the same prompt to AIRA&apos;s configured providers, including OmniRoute&apos;s smart gateway, and compare independent responses, latency, and model identity.</p>
              </div>
              <div className="rounded-full border border-white/[0.08] bg-[#111419] px-3 py-1.5 text-xs text-[#8b9098]">{readyCount} providers ready</div>
            </div>

            <section className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-4 md:p-5">
              <div className="mb-4 flex flex-wrap gap-2">
                {providers.map((provider) => {
                  const checked = selected.includes(provider.id);
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      disabled={!provider.configured || loading}
                      onClick={() => setSelected((current) => checked ? current.filter((id) => id !== provider.id) : [...current, provider.id].slice(-3))}
                      className={`flex min-w-[190px] items-center justify-between rounded-xl border px-3 py-3 text-left transition ${checked ? "border-[#c9a84c]/45 bg-[#c9a84c]/[0.08]" : "border-white/[0.08] bg-[#14171c] hover:border-white/[0.14]"} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      <span><strong className="block text-sm font-medium text-[#eeeeea]">{provider.label}</strong><small className="mt-1 block max-w-[160px] truncate text-[11px] text-[#7d828a]">{provider.model}</small></span>
                      {checked ? <Check className="size-4 text-[#d1b35d]" /> : <span className={`size-2 rounded-full ${provider.configured ? "bg-emerald-500" : "bg-[#555b64]"}`} />}
                    </button>
                  );
                })}
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                placeholder="Enter one prompt to test across models…"
                className="w-full resize-y rounded-xl border border-white/[0.09] bg-[#0b0d10] px-4 py-3 text-sm leading-6 text-[#f0f0ec] outline-none placeholder:text-[#5e636b] focus:border-[#c9a84c]/45"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-[#6f747c]">Select at least two configured providers.</p>
                <button type="button" onClick={() => void runComparison()} disabled={loading || selected.length < 2 || prompt.trim().length < 2} className="inline-flex items-center gap-2 rounded-xl bg-[#d0ae55] px-4 py-2.5 text-sm font-semibold text-[#111214] transition hover:bg-[#dfbd63] disabled:opacity-40">
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Compare
                </button>
              </div>
              {message ? <p className="mt-3 rounded-lg border border-red-400/15 bg-red-400/[0.06] px-3 py-2 text-sm text-red-200">{message}</p> : null}
            </section>

            <section className="mt-5 grid gap-4 xl:grid-cols-3">
              {results.map((result) => {
                const provider = providers.find((p) => p.id === result.providerId);
                return (
                  <article key={result.providerId} className="min-h-[360px] rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5">
                    <header className="mb-4 flex items-start justify-between gap-3 border-b border-white/[0.07] pb-4">
                      <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-[#191d23] text-[#c9a84c]"><Scale className="size-4" /></span><div><h2 className="text-sm font-semibold text-[#f0f0ed]">{provider?.label ?? result.providerId}</h2><p className="mt-0.5 text-[11px] text-[#70757d]">{provider?.model}</p></div></div>
                      {result.latencyMs ? <span className="text-[11px] tabular-nums text-[#70757d]">{(result.latencyMs / 1000).toFixed(1)}s</span> : null}
                    </header>
                    {result.ok ? <div className="whitespace-pre-wrap text-sm leading-7 text-[#cfd1d3]">{result.text}</div> : <p className="text-sm leading-6 text-red-200">{result.error}</p>}
                  </article>
                );
              })}
              {!results.length && !loading ? <div className="xl:col-span-3 rounded-2xl border border-dashed border-white/[0.09] px-6 py-16 text-center text-sm text-[#666c74]">Comparison results appear here.</div> : null}
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
