"use client";

import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, Wrench, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ToolState = {
  id: string;
  registered: boolean;
  available: boolean;
};

type ToolPayload = {
  tools: ToolState[];
  availableCount: number;
  registeredCount: number;
  checkedAt: string;
};

type ToolMeta = {
  label: string;
  category: string;
  description: string;
};

const TOOL_META: Record<string, ToolMeta> = {
  browser: { label: "Browser", category: "Web", description: "Controlled browser navigation and page interaction through AIRA's browser runtime." },
  terminal: { label: "Terminal", category: "Workspace", description: "Sandboxed command execution when a terminal runtime is configured and authorized." },
  git: { label: "Git", category: "Workspace", description: "Repository inspection and controlled Git operations through the Tool Gateway." },
  files: { label: "Files", category: "Native", description: "Read and write approved workspace files through AIRA's native file adapter." },
  memory: { label: "Memory", category: "Native", description: "Retrieve and update user-scoped AIRA memory through the native memory adapter." },
  web: { label: "Web Search", category: "Web", description: "Grounded web retrieval used by research and autonomous work." },
  github: { label: "GitHub", category: "Connected", description: "GitHub repository and development operations through the configured connector." },
  vercel: { label: "Vercel", category: "Connected", description: "Deployment and project operations through the configured Vercel connector." },
  supabase: { label: "Supabase", category: "Connected", description: "Database and platform operations through the configured Supabase connector." },
  mcp: { label: "MCP", category: "Connected", description: "Calls approved Model Context Protocol tools registered with AIRA." },
  gmail: { label: "Gmail", category: "Connected", description: "Authorized Gmail actions when the user has connected the service." },
  slack: { label: "Slack", category: "Connected", description: "Authorized Slack actions when the user has connected the service." },
  google_drive: { label: "Google Drive", category: "Connected", description: "Authorized Google Drive access when the user has connected the service." },
};

function metaFor(id: string): ToolMeta {
  return TOOL_META[id] ?? {
    label: id,
    category: "Gateway",
    description: "Registered AIRA Tool Gateway capability.",
  };
}

export function ToolsWorkspace() {
  const [payload, setPayload] = useState<ToolPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agent-platform/tools", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ToolPayload & { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not read Tool Gateway status.");
      setPayload(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read Tool Gateway status.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const rows = payload?.tools ?? [];
    return [...new Set(rows.map((tool) => metaFor(tool.id).category))];
  }, [payload]);

  return (
    <main className="min-h-[calc(100dvh-72px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">AIRA Command</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Tools</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">
              Live Tool Gateway capability state. A tool is marked available only when its registered adapter reports ready now.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.12)] bg-white px-4 py-2.5 text-sm font-semibold shadow-xs transition hover:bg-[#FAF9F6] disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh status
          </button>
        </header>

        {error ? (
          <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}

        {loading ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white">
            <Loader2 className="size-5 animate-spin text-[#3A0CA3]" aria-label="Loading tools" />
          </div>
        ) : payload ? (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
                <p className="text-xs text-[#6B6A75]">Registered adapters</p>
                <p className="mt-2 text-2xl font-semibold">{payload.registeredCount}</p>
              </div>
              <div className="rounded-2xl border border-emerald-600/15 bg-white p-4 shadow-xs">
                <p className="text-xs text-[#6B6A75]">Available now</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-700">{payload.availableCount}</p>
              </div>
              <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
                <p className="text-xs text-[#6B6A75]">Last probe</p>
                <p className="mt-2 text-sm font-medium">{new Date(payload.checkedAt).toLocaleString()}</p>
              </div>
            </section>

            {categories.map((category) => (
              <section key={category}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#6B6A75]">{category}</h2>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {payload.tools
                    .filter((tool) => metaFor(tool.id).category === category)
                    .map((tool) => {
                      const meta = metaFor(tool.id);
                      return (
                        <article key={tool.id} className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
                          <div className="flex items-start justify-between gap-3">
                            <span className="grid size-10 place-items-center rounded-xl bg-[#3A0CA3]/[0.07] text-[#3A0CA3]">
                              <Wrench className="size-4" aria-hidden />
                            </span>
                            <span className={tool.available
                              ? "inline-flex items-center gap-1 rounded-full border border-emerald-600/20 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800"
                              : "inline-flex items-center gap-1 rounded-full border border-amber-600/20 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800"}>
                              {tool.available ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                              {tool.available ? "Available" : "Unavailable"}
                            </span>
                          </div>
                          <h3 className="mt-4 text-sm font-semibold">{meta.label}</h3>
                          <p className="mt-1 text-xs leading-5 text-[#6B6A75]">{meta.description}</p>
                          <div className="mt-4 flex items-center gap-2 border-t border-[rgba(17,17,21,0.07)] pt-3 text-[10px] text-[#8F8E98]">
                            <ShieldCheck className="size-3.5" />
                            <span>Registered gateway adapter · {tool.id}</span>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </section>
            ))}
          </>
        ) : null}
      </div>
    </main>
  );
}
