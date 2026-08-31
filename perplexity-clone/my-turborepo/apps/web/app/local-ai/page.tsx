"use client";

import { Building2, CheckCircle2, Cpu, Loader2, Mail, RefreshCw, Send, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { cn } from "@/lib/cn";
import styles from "./local-ai.module.css";

type RuntimeStatus = {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly localFirst: boolean;
  readonly required: boolean;
  readonly model: string | null;
  readonly health: { readonly reachable: boolean; readonly status: string; readonly latencyMs: number | null; readonly error?: string };
  readonly models: string[];
  readonly capabilities: Record<string, boolean>;
};

type Mode = "chat" | "lead" | "email";

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as ({ error?: { message?: string } } & Record<string, unknown>) | null;
  if (!response.ok) throw new Error(data?.error?.message ?? "Request failed.");
  return data;
}

function renderResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function LocalAiPage() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("chat");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [lead, setLead] = useState({ name: "", company: "", role: "", source: "", notes: "" });
  const [email, setEmail] = useState({ from: "", subject: "", body: "" });

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const response = await fetch("/api/local-ai/status", { credentials: "include", cache: "no-store" });
      const data = (await response.json().catch(() => null)) as (RuntimeStatus & { error?: { message?: string } }) | null;
      if (!response.ok || !data) throw new Error(data?.error?.message ?? "Could not load local AI status.");
      setStatus(data);
    } catch (caught) {
      setStatus(null);
      setStatusError(caught instanceof Error ? caught.message : "Could not load local AI status.");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      if (mode === "chat") {
        if (prompt.trim().length < 2) throw new Error("Enter a task for the local worker.");
        setResult(await postJson("/api/local-ai/chat", { prompt: prompt.trim(), useWorkspaceContext: true, useTools: true }));
      } else if (mode === "lead") {
        if (lead.notes.trim().length < 2) throw new Error("Add lead notes to qualify the prospect.");
        setResult(await postJson("/api/local-ai/business/lead", lead));
      } else {
        if (email.body.trim().length < 2) throw new Error("Paste an email body to triage it.");
        setResult(await postJson("/api/local-ai/business/email", email));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Local AI request failed.");
    } finally {
      setLoading(false);
    }
  };

  const reachable = Boolean(status?.health.reachable);
  const resultProvider = result && typeof result === "object" && "provider" in result
    ? String((result as { provider?: unknown }).provider ?? "")
    : null;

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={styles.page}>
          <div className={styles.inner}>
            <header className={styles.header}>
              <div>
                <p className={styles.eyebrow}>Private intelligence</p>
                <h1 className={styles.title}>Local AI Engine</h1>
                <p className={styles.description}>
                  Run supported private work through the configured llama.cpp worker. This surface reports the real local runtime state and invokes the existing chat, lead-qualification and email-triage endpoints without exposing runtime credentials.
                </p>
              </div>
              <button type="button" onClick={() => void loadStatus()} className={styles.button}>
                <RefreshCw className="size-3.5" aria-hidden /> Refresh status
              </button>
            </header>

            {statusError ? <p className={styles.statusError} role="alert">{statusError}</p> : null}

            <section className={styles.statusGrid} aria-label="Local runtime status">
              <article className={styles.panel}>
                <div className={styles.runtime}>
                  <span className={cn(styles.runtimeIcon, reachable && styles.runtimeOnline)}>
                    <Cpu className="size-5" aria-hidden />
                  </span>
                  <div className={styles.runtimeCopy}>
                    <strong>{status?.model ?? "Configured local model"}</strong>
                    <span>{status ? `${status.health.status}${status.health.latencyMs !== null ? ` · ${status.health.latencyMs} ms health latency` : ""}` : "Checking runtime…"}</span>
                  </div>
                  <span className={cn(styles.badge, reachable && styles.badgeOn)}>
                    {reachable ? <CheckCircle2 className="size-3.5" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
                    {reachable ? "Online" : status?.configured ? "Offline" : "Not configured"}
                  </span>
                </div>
                {status?.health.error ? <p className={styles.healthError}>{status.health.error}</p> : null}
              </article>

              <article className={styles.panel}>
                <p className={styles.policyTitle}>Routing policy</p>
                <dl className={styles.facts}>
                  <div className={styles.fact}><dt>Local first</dt><dd>{status?.localFirst ? "On" : "Selective"}</dd></div>
                  <div className={styles.fact}><dt>Cloud fallback</dt><dd>{status?.required ? "Off" : "Allowed"}</dd></div>
                  <div className={styles.fact}><dt>Configured</dt><dd>{status?.configured ? "Yes" : "No"}</dd></div>
                  <div className={styles.fact}><dt>Advertised capabilities</dt><dd>{status ? Object.values(status.capabilities).filter(Boolean).length : "—"}</dd></div>
                </dl>
              </article>
            </section>

            <section className={styles.workspace} aria-label="Local AI workers">
              <div className={styles.tabs} role="tablist" aria-label="Local AI work mode">
                {(["chat", "lead", "email"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={mode === item}
                    onClick={() => { setMode(item); setResult(null); setError(null); }}
                    className={cn(styles.tab, mode === item && styles.tabActive)}
                  >
                    {item === "chat" ? <Cpu className="size-3.5" aria-hidden /> : item === "lead" ? <Building2 className="size-3.5" aria-hidden /> : <Mail className="size-3.5" aria-hidden />}
                    {item === "chat" ? "Local workspace" : item === "lead" ? "Lead worker" : "Email triage"}
                  </button>
                ))}
              </div>

              <div className={styles.split}>
                <div className={styles.inputPane}>
                  {mode === "chat" ? (
                    <label>
                      <span className="sr-only">Local AI task</span>
                      <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        rows={12}
                        placeholder="Ask the local worker to summarize, extract, classify, rewrite, use workspace context, or call supported tools…"
                        className={styles.textarea}
                      />
                    </label>
                  ) : null}

                  {mode === "lead" ? (
                    <div className={styles.fieldGrid}>
                      <div className={styles.fieldGrid2}>
                        <input value={lead.name} onChange={(event) => setLead({ ...lead, name: event.target.value })} placeholder="Lead name" className={styles.input} aria-label="Lead name" />
                        <input value={lead.company} onChange={(event) => setLead({ ...lead, company: event.target.value })} placeholder="Company" className={styles.input} aria-label="Company" />
                        <input value={lead.role} onChange={(event) => setLead({ ...lead, role: event.target.value })} placeholder="Role" className={styles.input} aria-label="Role" />
                        <input value={lead.source} onChange={(event) => setLead({ ...lead, source: event.target.value })} placeholder="Source" className={styles.input} aria-label="Source" />
                      </div>
                      <textarea value={lead.notes} onChange={(event) => setLead({ ...lead, notes: event.target.value })} rows={8} placeholder="Prospect notes, bio, requirements, or CRM context…" className={styles.textarea} aria-label="Lead notes" />
                    </div>
                  ) : null}

                  {mode === "email" ? (
                    <div className={styles.fieldGrid}>
                      <input value={email.from} onChange={(event) => setEmail({ ...email, from: event.target.value })} placeholder="From" className={styles.input} aria-label="Email sender" />
                      <input value={email.subject} onChange={(event) => setEmail({ ...email, subject: event.target.value })} placeholder="Subject" className={styles.input} aria-label="Email subject" />
                      <textarea value={email.body} onChange={(event) => setEmail({ ...email, body: event.target.value })} rows={8} placeholder="Paste the email body…" className={styles.textarea} aria-label="Email body" />
                    </div>
                  ) : null}

                  <button type="button" disabled={loading || !reachable} onClick={() => void run()} className={styles.primary}>
                    {loading ? <Loader2 className={cn("size-4", styles.spin)} aria-hidden /> : <Send className="size-4" aria-hidden />}
                    {loading ? "Running…" : "Run worker"}
                  </button>
                  {error ? <p className={styles.error} role="alert">{error}</p> : null}
                </div>

                <div className={styles.resultPane}>
                  <div className={styles.resultHeader}>
                    <span>Result</span>
                    {resultProvider ? <span className={styles.provider}>{resultProvider}</span> : null}
                  </div>
                  {result ? <pre className={styles.result}>{renderResult(result)}</pre> : <p className={styles.empty}>Run a supported task to inspect the worker output and any routing information returned by the server.</p>}
                </div>
              </div>
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
