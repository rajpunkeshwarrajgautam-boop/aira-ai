"use client";

import { ArrowUpRight, CheckCircle2, Loader2, RefreshCw, Settings2, ShieldCheck, Wrench, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type Integration = { id: string; label: string; configured: boolean; detail: string; model?: string };
type Status = { integrations: Integration[]; defaults: { primaryProvider: string; fallbackProvider: string; omniRouteModel?: string } };
type ToolStatus = {
  id: string;
  label: string;
  description: string;
  category: string;
  permission: string;
  sideEffecting: boolean;
  timeoutMs: number;
  cancellable: boolean;
  audit: "required" | "standard";
  availability: { state: string; detail: string };
};
type ToolsPayload = {
  tools: ToolStatus[];
  permissionPolicy: { modes: string[]; auto: string; ask: string; plan_only: string };
};

const INTEGRATION_DESTINATIONS: Readonly<Record<string, { href: string; label: string }>> = {
  omniroute: { href: "/omniroute", label: "Open OmniRoute" },
  openai: { href: "/compare", label: "Open Compare" },
  nvidia: { href: "/compare", label: "Open Compare" },
  exa: { href: "/", label: "Open Research" },
  knowledge: { href: "/knowledge", label: "Open Knowledge" },
  deerflow: { href: "/agents", label: "Open Agents" },
  autogpt: { href: "/agents", label: "Open Agents" },
};

function toolStateLabel(state: string): string {
  if (state === "AVAILABLE") return "Available";
  if (state === "CONFIGURED") return "Configured";
  if (state === "AUTH_REQUIRED") return "Auth required";
  if (state === "PERMISSION_REQUIRED") return "Permission required";
  if (state === "UNAVAILABLE") return "Unavailable";
  return "Not configured";
}

function toolStateReady(state: string): boolean {
  return state === "AVAILABLE" || state === "CONFIGURED";
}

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tools, setTools] = useState<ToolsPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [statusResponse, toolsResponse] = await Promise.all([
        fetch("/api/integrations/status", { cache: "no-store" }),
        fetch("/api/tools", { cache: "no-store" }),
      ]);
      const data = (await statusResponse.json()) as Status & { error?: { message?: string } };
      const toolData = (await toolsResponse.json()) as ToolsPayload & { error?: { message?: string } };
      if (!statusResponse.ok) throw new Error(data.error?.message ?? "Could not load integration status.");
      if (!toolsResponse.ok) throw new Error(toolData.error?.message ?? "Could not load tool registry status.");
      setStatus(data);
      setTools(toolData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load runtime status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-5 py-7 md:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#a98b43]">Settings</p><h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#f2f2ee] md:text-3xl">Runtime & integrations</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#8b9098]">A live view of the services and agent tools configured on this AIRA deployment. Secrets remain server-side and are never returned to the browser.</p></div>
              <button type="button" onClick={() => void loadStatus()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#111419] px-3 py-2 text-xs font-medium text-[#abb0b7] transition hover:bg-[#171a1f] disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />Refresh status</button>
            </div>

            {message ? <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-4 py-3 text-sm text-red-200" role="alert"><span>{message}</span><button type="button" onClick={() => void loadStatus()} className="rounded-lg border border-red-300/15 px-3 py-1.5 text-xs font-semibold transition hover:bg-red-300/[0.07]">Retry</button></div> : null}

            {loading && !status ? <div className="grid place-items-center rounded-2xl border border-white/[0.08] bg-[#0f1216] py-20"><Loader2 className="size-5 animate-spin text-[#a98b43]" /></div> : status ? (
              <>
                <section className="mb-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><div className="mb-4 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-[#181b20] text-[#c9a84c]"><Settings2 className="size-4" /></span><div><h2 className="text-sm font-semibold text-[#eeeeeb]">Model routing</h2><p className="mt-1 text-xs text-[#72777f]">Current server defaults</p></div></div><dl className="grid gap-3 text-sm"><div className="flex items-center justify-between rounded-lg bg-[#0b0e11] px-3 py-2.5"><dt className="text-[#777c84]">Primary</dt><dd className="font-medium text-[#d6d8d9]">{status.defaults.primaryProvider}</dd></div><div className="flex items-center justify-between rounded-lg bg-[#0b0e11] px-3 py-2.5"><dt className="text-[#777c84]">Fallback</dt><dd className="font-medium text-[#d6d8d9]">{status.defaults.fallbackProvider}</dd></div>{status.defaults.omniRouteModel ? <div className="flex items-center justify-between rounded-lg bg-[#0b0e11] px-3 py-2.5"><dt className="text-[#777c84]">OmniRoute mode</dt><dd className="font-medium text-[#d6d8d9]">{status.defaults.omniRouteModel}</dd></div> : null}</dl><Link href="/omniroute" className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[#d0b25c] transition hover:text-[#e0c36d]">Open routing gateway <ArrowUpRight className="size-3.5" /></Link></div>
                  <div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><h2 className="text-sm font-semibold text-[#eeeeeb]">Configuration model</h2><p className="mt-2 text-sm leading-6 text-[#7d828a]">OmniRoute credentials and infrastructure endpoints stay deployment-level settings. AIRA exposes readiness, selected routing mode, live models, and inference tests without exposing API keys or private endpoint URLs.</p><p className="mt-3 text-xs leading-5 text-[#656a72]">AIRA keeps its safety, citation, publication, and agent layers while OmniRoute handles provider selection and upstream failover.</p></div>
                </section>

                <section id="integrations" className="mb-5 scroll-mt-24 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1216]">
                  <div className="border-b border-white/[0.07] px-5 py-4"><h2 className="text-sm font-semibold text-[#eeeeeb]">Connected services</h2><p className="mt-1 text-xs text-[#72777f]">Live configuration status from the current deployment</p></div>
                  <ul className="divide-y divide-white/[0.06]">{status.integrations.map((integration) => {
                    const destination = INTEGRATION_DESTINATIONS[integration.id];
                    return (
                      <li key={integration.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                        <span className={`grid size-9 place-items-center rounded-lg ${integration.configured ? "bg-emerald-400/[0.07] text-emerald-300" : "bg-[#171a1f] text-[#666c74]"}`}>{integration.configured ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}</span>
                        <div className="min-w-0 flex-1"><p className="text-sm font-medium text-[#e9e9e6]">{integration.label}</p><p className="mt-1 text-xs text-[#747981]">{integration.detail}{integration.model ? ` · ${integration.model}` : ""}</p></div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${integration.configured ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300" : "border-white/[0.08] bg-[#12151a] text-[#747981]"}`}>{integration.configured ? "Connected" : "Not configured"}</span>
                        {destination ? <Link href={destination.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-[10px] font-medium text-[#aeb2b8] transition hover:border-[#c9a84c]/30 hover:text-[#d8bd70]">{destination.label}<ArrowUpRight className="size-3" /></Link> : null}
                      </li>
                    );
                  })}</ul>
                </section>

                {tools ? <section id="tools" className="scroll-mt-24 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1216]">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4"><div><div className="flex items-center gap-2"><Wrench className="size-4 text-[#c9a84c]" /><h2 className="text-sm font-semibold text-[#eeeeeb]">Agent tool registry</h2></div><p className="mt-1 text-xs text-[#72777f]">Server-owned tool metadata, permissions and truthful activation state</p></div><div className="flex items-center gap-2 text-[11px] text-[#787d85]"><ShieldCheck className="size-3.5" />Auto mode only auto-executes read tools</div></div>
                  <ul className="divide-y divide-white/[0.06]">{tools.tools.map((tool) => {
                    const ready = toolStateReady(tool.availability.state);
                    return <li key={tool.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <span className={`grid size-9 place-items-center rounded-lg ${ready ? "bg-emerald-400/[0.07] text-emerald-300" : "bg-[#171a1f] text-[#666c74]"}`}>{ready ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}</span>
                      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-[#e9e9e6]">{tool.label}</p><span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-[#858a92]">{tool.permission}</span>{tool.audit === "required" ? <span className="rounded-md bg-amber-300/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-amber-200/80">Audited</span> : null}</div><p className="mt-1 text-xs text-[#747981]">{tool.description}</p><p className="mt-1 text-[11px] leading-5 text-[#62676f]">{tool.availability.detail}</p></div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${ready ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300" : "border-white/[0.08] bg-[#12151a] text-[#747981]"}`}>{toolStateLabel(tool.availability.state)}</span>
                    </li>;
                  })}</ul>
                  <div className="border-t border-white/[0.07] px-5 py-4 text-xs leading-5 text-[#6f747c]">Permission modes: <span className="font-medium text-[#aeb2b8]">auto</span>, <span className="font-medium text-[#aeb2b8]">ask</span>, and <span className="font-medium text-[#aeb2b8]">plan_only</span>. Configured means credentials/endpoints are present; it deliberately does not claim live health until invocation or runtime verification.</div>
                </section> : null}
              </>
            ) : null}
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
