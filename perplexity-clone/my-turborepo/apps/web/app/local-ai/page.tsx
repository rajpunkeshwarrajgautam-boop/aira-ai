"use client";

import { Building2, CheckCircle2, Cpu, Loader2, Mail, RefreshCw, Send, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type RuntimeStatus = {
  enabled: boolean;
  configured: boolean;
  localFirst: boolean;
  required: boolean;
  model: string | null;
  health: { reachable: boolean; status: string; latencyMs: number | null; error?: string };
  models: string[];
  capabilities: Record<string, boolean>;
};

type Mode = "chat" | "lead" | "email";

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as { error?: { message?: string } } & Record<string, unknown>;
  if (!response.ok) throw new Error(data.error?.message ?? "Request failed.");
  return data;
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

  const loadStatus = useCallback(() => {
    setStatusError(null);
    void fetch("/api/local-ai/status", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as RuntimeStatus & { error?: { message?: string } };
        if (!response.ok) throw new Error(data.error?.message ?? "Could not load local AI status.");
        setStatus(data);
      })
      .catch((caught: unknown) => setStatusError(caught instanceof Error ? caught.message : "Could not load local AI status."));
  }, []);

  useEffect(() => loadStatus(), [loadStatus]);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      if (mode === "chat") {
        if (prompt.trim().length < 2) throw new Error("Enter a task for the local worker.");
        setResult(await postJson("/api/local-ai/chat", { prompt, useWorkspaceContext: true, useTools: true }));
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

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-5 py-7 md:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#a98b43]">Virexa local intelligence</p>
                <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#f2f2ee] md:text-3xl">Local AI Engine</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[#8b9098]">Run routine private work on MiniCPM through llama.cpp, search your AIRA memory and knowledge with tools, and fall back to stronger configured providers when the task is not suitable for the 1B worker.</p>
              </div>
              <button type="button" onClick={loadStatus} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.09] bg-[#111419] px-3 py-2 text-xs font-medium text-[#c8c9c6] hover:bg-[#171a1f]"><RefreshCw className="size-3.5" />Refresh status</button>
            </div>

            {statusError ? <div className="mb-5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-4 py-3 text-sm text-red-200">{statusError}</div> : null}

            <section className="mb-5 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5 lg:col-span-2">
                <div className="flex flex-wrap items-center gap-4">
                  <span className={`grid size-11 place-items-center rounded-xl ${reachable ? "bg-emerald-400/[0.08] text-emerald-300" : "bg-[#181b20] text-[#777c84]"}`}><Cpu className="size-5" /></span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[#eeeeeb]">{status?.model ?? "MiniCPM / llama.cpp"}</p><p className="mt-1 text-xs text-[#72777f]">{status ? `${status.health.status}${status.health.latencyMs !== null ? ` · ${status.health.latencyMs} ms health check` : ""}` : "Checking runtime…"}</p></div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${reachable ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300" : "border-white/[0.08] bg-[#12151a] text-[#747981]"}`}>{reachable ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{reachable ? "Local runtime online" : "Local runtime offline"}</span>
                </div>
                {status?.health.error ? <p className="mt-4 rounded-lg bg-[#0b0e11] px-3 py-2 text-xs leading-5 text-[#858a92]">{status.health.error}</p> : null}
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#777c84]">Routing policy</p><dl className="mt-4 grid gap-2 text-xs"><div className="flex justify-between"><dt className="text-[#72777f]">Local first</dt><dd className="text-[#d4d6d7]">{status?.localFirst ? "On" : "Selective"}</dd></div><div className="flex justify-between"><dt className="text-[#72777f]">Cloud fallback</dt><dd className="text-[#d4d6d7]">{status?.required ? "Off" : "On"}</dd></div><div className="flex justify-between"><dt className="text-[#72777f]">Tool calling</dt><dd className="text-[#d4d6d7]">Enabled</dd></div><div className="flex justify-between"><dt className="text-[#72777f]">Workspace RAG</dt><dd className="text-[#d4d6d7]">Enabled</dd></div></dl></div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1216]">
              <div className="flex flex-wrap gap-2 border-b border-white/[0.07] px-4 py-3">
                {(["chat", "lead", "email"] as const).map((item) => <button key={item} type="button" onClick={() => { setMode(item); setResult(null); setError(null); }} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${mode === item ? "bg-[#201d15] text-[#d7b85d]" : "text-[#7f848c] hover:bg-[#15181d] hover:text-[#c9cbcc]"}`}>{item === "chat" ? <Cpu className="size-3.5" /> : item === "lead" ? <Building2 className="size-3.5" /> : <Mail className="size-3.5" />}{item === "chat" ? "Local workspace" : item === "lead" ? "Lead worker" : "Email triage"}</button>)}
              </div>

              <div className="grid gap-0 lg:grid-cols-[1.05fr_.95fr]">
                <div className="border-b border-white/[0.07] p-5 lg:border-b-0 lg:border-r">
                  {mode === "chat" ? <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={13} placeholder="Ask MiniCPM to summarize, extract, classify, rewrite, search Virexa memory, or work with your uploaded knowledge…" className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#0a0d10] px-4 py-3 text-sm leading-6 text-[#e7e8e5] outline-none placeholder:text-[#555b63] focus:border-[#a98b43]/40" /> : null}
                  {mode === "lead" ? <div className="grid gap-3"><div className="grid gap-3 sm:grid-cols-2"><input value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} placeholder="Lead name" className="rounded-lg border border-white/[0.08] bg-[#0a0d10] px-3 py-2.5 text-sm text-[#e7e8e5] outline-none" /><input value={lead.company} onChange={(e) => setLead({ ...lead, company: e.target.value })} placeholder="Company" className="rounded-lg border border-white/[0.08] bg-[#0a0d10] px-3 py-2.5 text-sm text-[#e7e8e5] outline-none" /><input value={lead.role} onChange={(e) => setLead({ ...lead, role: e.target.value })} placeholder="Role" className="rounded-lg border border-white/[0.08] bg-[#0a0d10] px-3 py-2.5 text-sm text-[#e7e8e5] outline-none" /><input value={lead.source} onChange={(e) => setLead({ ...lead, source: e.target.value })} placeholder="Source" className="rounded-lg border border-white/[0.08] bg-[#0a0d10] px-3 py-2.5 text-sm text-[#e7e8e5] outline-none" /></div><textarea value={lead.notes} onChange={(e) => setLead({ ...lead, notes: e.target.value })} rows={8} placeholder="Paste prospect notes, bio, requirements, or CRM context…" className="resize-y rounded-xl border border-white/[0.08] bg-[#0a0d10] px-4 py-3 text-sm leading-6 text-[#e7e8e5] outline-none placeholder:text-[#555b63]" /></div> : null}
                  {mode === "email" ? <div className="grid gap-3"><input value={email.from} onChange={(e) => setEmail({ ...email, from: e.target.value })} placeholder="From" className="rounded-lg border border-white/[0.08] bg-[#0a0d10] px-3 py-2.5 text-sm text-[#e7e8e5] outline-none" /><input value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} placeholder="Subject" className="rounded-lg border border-white/[0.08] bg-[#0a0d10] px-3 py-2.5 text-sm text-[#e7e8e5] outline-none" /><textarea value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} rows={8} placeholder="Paste the email body…" className="resize-y rounded-xl border border-white/[0.08] bg-[#0a0d10] px-4 py-3 text-sm leading-6 text-[#e7e8e5] outline-none placeholder:text-[#555b63]" /></div> : null}
                  <button type="button" disabled={loading} onClick={() => void run()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#c3a24a] px-4 py-2.5 text-sm font-semibold text-[#11110e] hover:bg-[#d0ae50] disabled:cursor-not-allowed disabled:opacity-50">{loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{loading ? "Running…" : "Run worker"}</button>
                  {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
                </div>
                <div className="min-h-[360px] bg-[#0b0e11] p-5"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#777c84]">Result</p>{result && typeof result === "object" && result !== null && "provider" in result ? <span className="rounded-full border border-white/[0.08] px-2 py-1 text-[10px] text-[#858a92]">{String((result as { provider?: unknown }).provider)}</span> : null}</div>{result ? <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[#d6d8d9]">{typeof result === "object" ? JSON.stringify(result, null, 2) : String(result)}</pre> : <p className="text-sm leading-6 text-[#656b73]">Run a task to see the local worker output, routing decision, model, and fallback information.</p>}</div>
              </div>
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
