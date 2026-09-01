"use client";

import { Check, Copy, Loader2, Play, Scale, Star } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { cn } from "@/lib/cn";
import styles from "./compare.module.css";

type ProviderId = "openai" | "nvidia" | "self-hosted";
type Provider = {
  readonly id: ProviderId;
  readonly label: string;
  readonly configured: boolean;
  readonly model: string;
};
type Result = {
  readonly providerId: ProviderId;
  readonly ok: boolean;
  readonly text?: string;
  readonly latencyMs?: number;
  readonly error?: string;
};

export default function ComparePage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<ProviderId[]>([]);
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [preferredId, setPreferredId] = useState<ProviderId | null>(null);
  const [copiedId, setCopiedId] = useState<ProviderId | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/compare", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as { providers?: Provider[]; error?: { message?: string } } | null;
        if (!response.ok) {
          throw new Error(data?.error?.message ?? (response.status === 401 ? "Sign in to use model comparison." : "Could not load model providers."));
        }
        return data?.providers ?? [];
      })
      .then((loadedProviders) => {
        setProviders(loadedProviders);
        setSelected(loadedProviders.filter((provider) => provider.configured).slice(0, 2).map((provider) => provider.id));
        setMessage(null);
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load providers."));
  }, []);

  const readyCount = useMemo(() => providers.filter((provider) => provider.configured).length, [providers]);

  async function runComparison() {
    if (prompt.trim().length < 2 || selected.length < 2) return;
    setLoading(true);
    setMessage(null);
    setResults([]);
    setPreferredId(null);
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), providers: selected }),
      });
      const data = (await response.json()) as { results?: Result[]; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Comparison failed.");
      setResults(data.results ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Comparison failed.");
    } finally {
      setLoading(false);
    }
  }

  async function copyResult(result: Result) {
    if (!result.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopiedId(result.providerId);
    window.setTimeout(() => setCopiedId((current) => current === result.providerId ? null : current), 1400);
  }

  const resultGridStyle = { "--compare-columns": Math.max(1, results.length) } as CSSProperties;

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={styles.page}>
          <div className={styles.inner}>
            <header className={styles.header}>
              <div>
                <p className={styles.eyebrow}>Model Lab</p>
                <h1 className={styles.title}>Compare configured providers</h1>
                <p className={styles.description}>
                  Send one prompt to the real providers configured for AIRA. Compare independent outputs, actual provider/model identity, measured request latency, and failures without invented cost or benchmark data.
                </p>
              </div>
              <span className={styles.ready}>{readyCount} {readyCount === 1 ? "provider" : "providers"} ready</span>
            </header>

            <section className={styles.control} aria-label="Comparison controls">
              <div className={styles.providers} role="group" aria-label="Select providers to compare">
                {providers.map((provider) => {
                  const checked = selected.includes(provider.id);
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      disabled={!provider.configured || loading}
                      onClick={() => setSelected((current) => checked
                        ? current.filter((id) => id !== provider.id)
                        : [...current, provider.id].slice(-3))}
                      className={cn(styles.provider, checked && styles.providerSelected)}
                      aria-pressed={checked}
                    >
                      <span className={styles.providerCopy}>
                        <strong>{provider.label}</strong>
                        <small title={provider.model}>{provider.model}</small>
                      </span>
                      <span className={styles.providerState} aria-label={provider.configured ? "Configured" : "Not configured"}>
                        {checked ? <Check className="size-4" aria-hidden /> : <span className={cn(styles.dot, !provider.configured && styles.dotOff)} />}
                      </span>
                    </button>
                  );
                })}
              </div>

              <label>
                <span className="sr-only">Prompt to compare across providers</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={5}
                  placeholder="Enter one prompt to test across models…"
                  className={styles.prompt}
                />
              </label>

              <div className={styles.controlFooter}>
                <span className={styles.hint}>Select at least two configured providers. Responses are generated independently.</span>
                <button
                  type="button"
                  onClick={() => void runComparison()}
                  disabled={loading || selected.length < 2 || prompt.trim().length < 2}
                  className={styles.run}
                >
                  {loading ? <Loader2 className={cn("size-4", styles.spin)} aria-hidden /> : <Play className="size-4" aria-hidden />}
                  {loading ? "Comparing…" : "Compare"}
                </button>
              </div>

              {message ? <p className={styles.error} role="alert">{message}</p> : null}
            </section>

            {results.length ? (
              <section className={styles.results} style={resultGridStyle} aria-label="Model comparison results">
                {results.map((result) => {
                  const provider = providers.find((item) => item.id === result.providerId);
                  const preferred = preferredId === result.providerId;
                  return (
                    <article key={result.providerId} className={cn(styles.result, preferred && styles.resultPreferred)}>
                      <header className={styles.resultHeader}>
                        <div className={styles.resultIdentity}>
                          <span className={styles.resultIcon}><Scale className="size-4" aria-hidden /></span>
                          <div>
                            <h2>{provider?.label ?? result.providerId}</h2>
                            <p title={provider?.model}>{provider?.model ?? "Configured model"}</p>
                          </div>
                        </div>
                        <div className={styles.metrics}>
                          {preferred ? <span className={styles.preferred}>Preferred</span> : null}
                          {typeof result.latencyMs === "number" ? <span>{(result.latencyMs / 1000).toFixed(1)}s</span> : null}
                        </div>
                      </header>

                      <div className={cn(styles.resultBody, !result.ok && styles.resultError)}>
                        {result.ok ? (result.text || "No response text returned.") : (result.error || "Provider request failed.")}
                      </div>

                      <footer className={styles.resultFooter}>
                        <button
                          type="button"
                          onClick={() => setPreferredId((current) => current === result.providerId ? null : result.providerId)}
                          className={styles.copy}
                          aria-pressed={preferred}
                        >
                          <Star className="size-3.5" aria-hidden /> {preferred ? "Preferred" : "Prefer"}
                        </button>
                        {result.ok && result.text ? (
                          <button type="button" onClick={() => void copyResult(result)} className={styles.copy}>
                            <Copy className="size-3.5" aria-hidden /> {copiedId === result.providerId ? "Copied" : "Copy"}
                          </button>
                        ) : <span className={styles.selectHint}>No output to copy</span>}
                      </footer>
                    </article>
                  );
                })}
              </section>
            ) : (
              <div className={styles.empty}>{loading ? "Waiting for provider responses…" : "Run a comparison to evaluate real configured providers side by side."}</div>
            )}
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
