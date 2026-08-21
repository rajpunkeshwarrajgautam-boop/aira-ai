"use client";

import { CheckCircle2, Loader2, Settings2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type Integration = { id: string; label: string; configured: boolean; detail: string; model?: string };
type Status = { integrations: Integration[]; defaults: { primaryProvider: string; fallbackProvider: string } };

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/integrations/status", { cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json()) as Status & { error?: { message?: string } };
        if (!r.ok) throw new Error(data.error?.message ?? "Could not load integration status.");
        setStatus(data);
      })
      .catch((e: unknown) => setMessage(e instanceof Error ? e.message : "Could not load integration status."));
  }, []);

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-5 py-7 md:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#a98b43]">Settings</p><h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#f2f2ee] md:text-3xl">Runtime & integrations</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#8b9098]">A live view of the services actually configured on this AIRA deployment. Secrets remain server-side and are never returned to the browser.</p></div>
            {message ? <div className="mb-5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-4 py-3 text-sm text-red-200">{message}</div> : null}
            {!status ? <div className="grid place-items-center rounded-2xl border border-white/[0.08] bg-[#0f1216] py-20"><Loader2 className="size-5 animate-spin text-[#a98b43]" /></div> : (
              <>
                <section className="mb-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><div className="mb-4 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-[#181b20] text-[#c9a84c]"><Settings2 className="size-4" /></span><div><h2 className="text-sm font-semibold text-[#eeeeeb]">Model routing</h2><p className="mt-1 text-xs text-[#72777f]">Current server defaults</p></div></div><dl className="grid gap-3 text-sm"><div className="flex items-center justify-between rounded-lg bg-[#0b0e11] px-3 py-2.5"><dt className="text-[#777c84]">Primary</dt><dd className="font-medium text-[#d6d8d9]">{status.defaults.primaryProvider}</dd></div><div className="flex items-center justify-between rounded-lg bg-[#0b0e11] px-3 py-2.5"><dt className="text-[#777c84]">Fallback</dt><dd className="font-medium text-[#d6d8d9]">{status.defaults.fallbackProvider}</dd></div></dl></div>
                  <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><h2 className="text-sm font-semibold text-[#eeeeeb]">Configuration model</h2><p className="mt-2 text-sm leading-6 text-[#7d828a]">Provider credentials and infrastructure endpoints are deployment-level settings. This page intentionally exposes readiness and selected models without exposing API keys or private endpoint URLs.</p><p className="mt-3 text-xs leading-5 text-[#656a72]">This keeps integrations real and connected while preserving the server-side trust boundary.</p></div>
                </section>
                <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1216]">
                  <div className="border-b border-white/[0.07] px-5 py-4"><h2 className="text-sm font-semibold text-[#eeeeeb]">Connected services</h2><p className="mt-1 text-xs text-[#72777f]">Live configuration status from the current deployment</p></div>
                  <ul className="divide-y divide-white/[0.06]">{status.integrations.map((integration) => (
                    <li key={integration.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <span className={`grid size-9 place-items-center rounded-lg ${integration.configured ? "bg-emerald-400/[0.07] text-emerald-300" : "bg-[#171a1f] text-[#666c74]"}`}>{integration.configured ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}</span>
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-[#e9e9e6]">{integration.label}</p><p className="mt-1 text-xs text-[#747981]">{integration.detail}{integration.model ? ` · ${integration.model}` : ""}</p></div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${integration.configured ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300" : "border-white/[0.08] bg-[#12151a] text-[#747981]"}`}>{integration.configured ? "Connected" : "Not configured"}</span>
                    </li>
                  ))}</ul>
                </section>
              </>
            )}
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
