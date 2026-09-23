"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { ToolApprovalPanel } from "@/components/ToolApprovalPanel";

type AgentRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "REVIEW";
type AgentRun = {
  id: string;
  provider: string;
  objective: string;
  status: AgentRunStatus;
  result: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
type AgentRunEvent = {
  id: string;
  type: string;
  status: AgentRunStatus | null;
  message: string;
  metadata: unknown | null;
  createdAt: string;
};
type Payload = {
  runs: AgentRun[];
  feature: {
    enabled: boolean;
    configured: boolean;
    ready: boolean;
    preferredProvider: "DEERFLOW" | "AUTOGPT" | null;
    providers: Record<string, { enabled: boolean; configured: boolean; healthy: boolean | null; ready: boolean }>;
  };
  usage: {
    billingPlan: string;
    monthlyAgentRunLimit: number;
    agentRunsUsed: number;
    agentRunsRemaining: number;
  };
};

type ApiError = { error?: { message?: string } };

const ACTIVE_STATUSES = new Set<AgentRunStatus>(["QUEUED", "RUNNING", "REVIEW"]);

function displayResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const output = (result as Record<string, unknown>).output;
    if (typeof output === "string" && output.trim()) return output;
  }
  try {
    return result == null ? "" : JSON.stringify(result, null, 2);
  } catch {
    return "The agent returned a result that cannot be displayed.";
  }
}

function artifactPaths(result: unknown): string[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const artifacts = (result as Record<string, unknown>).artifacts;
  if (!Array.isArray(artifacts)) return [];
  return Array.from(
    new Set(
      artifacts
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/\\/g, "/").replace(/^\/+/, ""))
        .filter((value) => value.startsWith("mnt/user-data/outputs/")),
    ),
  ).slice(0, 25);
}

function artifactHref(runId: string, path: string): string {
  const encoded = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `/api/agents/runs/${encodeURIComponent(runId)}/artifacts/${encoded}`;
}

function artifactName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "Artifact";
}

function statusClass(status: AgentRunStatus | null): string {
  if (status === "COMPLETED") return "border-emerald-600/20 bg-emerald-50 text-emerald-800 font-medium";
  if (status === "FAILED" || status === "TERMINATED") return "border-red-300 bg-red-50 text-red-800 font-medium";
  if (status === "REVIEW") return "border-amber-600/20 bg-amber-50 text-amber-800 font-medium";
  if (status === "RUNNING") return "border-[#3A0CA3]/20 bg-[rgba(58,12,163,0.08)] text-[#3A0CA3] font-medium";
  return "border-[rgba(17,17,21,0.1)] bg-[#FAF9F6] text-[#6B6A75]";
}

export default function RunsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [objective, setObjective] = useState("");
  const [provider, setProvider] = useState<"AUTO" | "DEERFLOW" | "AUTOGPT">("AUTO");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentRunEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => data?.runs.find((run) => run.id === selectedRunId) ?? null,
    [data, selectedRunId],
  );
  const selectedArtifacts = useMemo(
    () => (selectedRun ? artifactPaths(selectedRun.result) : []),
    [selectedRun],
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agents/runs?limit=50", { cache: "no-store" });
      const body = (await response.json()) as Payload & ApiError;
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load agent runs.");
      setData(body);
      setSelectedRunId((current) =>
        current && body.runs.some((run) => run.id === current) ? current : (body.runs[0]?.id ?? null),
      );
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load agent runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async (runId: string) => {
    setEventsLoading(true);
    try {
      const response = await fetch(`/api/agents/runs/${encodeURIComponent(runId)}/events?limit=60`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { events?: AgentRunEvent[] } & ApiError;
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load run activity.");
      setEvents(body.events ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load run activity.");
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedRunId) {
      setEvents([]);
      return;
    }
    void loadEvents(selectedRunId);
  }, [loadEvents, selectedRunId]);

  useEffect(() => {
    if (!data?.runs.some((run) => ACTIVE_STATUSES.has(run.status))) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [data, refresh]);

  useEffect(() => {
    if (!selectedRun || !ACTIVE_STATUSES.has(selectedRun.status)) return;
    const timer = window.setInterval(() => void loadEvents(selectedRun.id), 4000);
    return () => window.clearInterval(timer);
  }, [loadEvents, selectedRun]);

  async function startRun() {
    if (objective.trim().length < 3) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          objective: objective.trim(),
          ...(provider === "AUTO" ? {} : { provider }),
        }),
      });
      const body = (await response.json()) as { run?: AgentRun } & ApiError;
      if (!response.ok) throw new Error(body.error?.message ?? "Agent run could not be started.");
      setObjective("");
      if (body.run?.id) setSelectedRunId(body.run.id);
      await refresh();
      if (body.run?.id) await loadEvents(body.run.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agent run could not be started.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-5 py-7 text-[#111115] md:px-8">
          <div className="mx-auto max-w-[1500px]">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">Agent operations</p>
                <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#111115] md:text-3xl">Agent run center</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">
                  Launch autonomous objectives, inspect runtime readiness, and follow persisted lifecycle facts without inventing hidden execution steps.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                className="inline-flex items-center gap-2 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-xs font-medium text-[#111115] shadow-xs hover:bg-[#FAF9F6]"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Refresh
              </button>
            </div>

            {message ? (
              <div className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                {message}
              </div>
            ) : null}

            {loading || !data ? (
              <div className="grid place-items-center rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white py-20 shadow-xs">
                <Loader2 className="size-5 animate-spin text-[#3A0CA3]" aria-hidden />
              </div>
            ) : (
              <>
                <section className="mb-5 grid gap-4 lg:grid-cols-[1.4fr_.6fr]">
                  <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
                    <h2 className="text-sm font-semibold text-[#111115]">Start autonomous work</h2>
                    <textarea
                      value={objective}
                      onChange={(event) => setObjective(event.target.value.slice(0, 4_000))}
                      rows={4}
                      maxLength={4_000}
                      placeholder="Describe the objective, deliverable, constraints and stopping condition…"
                      className="mt-4 w-full rounded-xl border border-[rgba(17,17,21,0.12)] bg-white px-4 py-3 text-sm leading-6 text-[#111115] outline-none placeholder:text-[#8F8E98] focus:border-[#3A0CA3]"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <select
                        value={provider}
                        onChange={(event) => setProvider(event.target.value as typeof provider)}
                        className="rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-xs text-[#111115] outline-none focus:border-[#3A0CA3]"
                        aria-label="Agent runtime"
                      >
                        <option value="AUTO">Auto-select runtime</option>
                        <option value="DEERFLOW">DeerFlow</option>
                        <option value="AUTOGPT">AutoGPT</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void startRun()}
                        disabled={submitting || objective.trim().length < 3 || !data.feature.ready}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#3A0CA3] hover:bg-[#2D0A82] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition disabled:opacity-40"
                      >
                        {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
                        Start run
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
                    <h2 className="text-sm font-semibold text-[#111115]">Runtime</h2>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-4"><span className="text-[#6B6A75]">Status</span><span className={data.feature.ready ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{data.feature.ready ? "Ready" : "Unavailable"}</span></div>
                      <div className="flex items-center justify-between gap-4"><span className="text-[#6B6A75]">Preferred</span><span className="text-[#111115]">{data.feature.preferredProvider ?? "None"}</span></div>
                      <div className="flex items-center justify-between gap-4"><span className="text-[#6B6A75]">Plan</span><span className="text-[#111115]">{data.usage.billingPlan}</span></div>
                      <div className="flex items-center justify-between gap-4"><span className="text-[#6B6A75]">Runs left</span><span className="text-[#111115]">{data.usage.agentRunsRemaining} / {data.usage.monthlyAgentRunLimit}</span></div>
                    </div>
                  </div>
                </section>

                <section className="grid overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs lg:grid-cols-[minmax(300px,.72fr)_minmax(0,1.28fr)]">
                  <div className="border-b border-[rgba(17,17,21,0.08)] lg:border-b-0 lg:border-r">
                    <div className="border-b border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-5 py-4">
                      <h2 className="text-sm font-semibold text-[#111115]">Run history</h2>
                      <p className="mt-1 text-xs text-[#6B6A75]">{data.runs.length} persisted runs</p>
                    </div>
                    {data.runs.length ? (
                      <ul className="max-h-[680px] divide-y divide-[rgba(17,17,21,0.06)] overflow-auto">
                        {data.runs.map((run) => (
                          <li key={run.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedRunId(run.id)}
                              className={`flex w-full gap-3 px-5 py-4 text-left transition ${selectedRunId === run.id ? "bg-[#3A0CA3]/[0.06]" : "hover:bg-[#FAF9F6]"}`}
                            >
                              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]"><Bot className="size-4" aria-hidden /></span>
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-medium text-[#111115]">{run.provider}</span>
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusClass(run.status)}`}>{run.status}</span>
                                </span>
                                <span className="mt-1 block line-clamp-2 text-sm leading-5 text-[#6B6A75]">{run.objective}</span>
                                <time className="mt-2 block text-[10px] text-[#8F8E98]">{new Date(run.createdAt).toLocaleString()}</time>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="px-6 py-16 text-center text-sm text-[#8F8E98]">No agent runs yet.</div>
                    )}
                  </div>

                  <div className="min-w-0 p-5 md:p-6" aria-live="polite">
                    {selectedRun ? (
                      <div>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3A0CA3]">Objective</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#111115]">{selectedRun.objective}</p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusClass(selectedRun.status)}`}>{selectedRun.status}</span>
                        </div>

                        <div className="my-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-[rgba(17,17,21,0.08)] py-3 text-[11px] text-[#6B6A75]">
                          <span>Started {new Date(selectedRun.createdAt).toLocaleString()}</span>
                          {selectedRun.completedAt ? <span>Finished {new Date(selectedRun.completedAt).toLocaleString()}</span> : null}
                          <span>Runtime {selectedRun.provider}</span>
                        </div>

                        <ToolApprovalPanel
                          runId={selectedRun.id}
                          active={ACTIVE_STATUSES.has(selectedRun.status)}
                        />

                        <div>
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3A0CA3]">Lifecycle activity</p>
                            {eventsLoading ? <Loader2 className="size-3.5 animate-spin text-[#3A0CA3]" aria-label="Loading run activity" /> : null}
                          </div>
                          {events.length ? (
                            <ol className="space-y-3 border-l border-[rgba(17,17,21,0.12)] pl-4">
                              {events.map((event) => (
                                <li key={event.id} className="relative">
                                  <span className="absolute -left-[20.5px] top-1.5 size-2 rounded-full border border-white bg-[#3A0CA3]" aria-hidden />
                                  <div className="flex flex-wrap items-center gap-2">
                                    {event.status ? <span className={`rounded-full border px-2 py-0.5 text-[9px] ${statusClass(event.status)}`}>{event.status}</span> : null}
                                    <time className="text-[10px] text-[#8F8E98]">{new Date(event.createdAt).toLocaleString()}</time>
                                  </div>
                                  <p className="mt-1 text-xs leading-5 text-[#111115]">{event.message}</p>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-4 py-3 text-xs leading-5 text-[#6B6A75]">
                              No lifecycle events were recorded for this run. Older runs can predate lifecycle auditing; AIRA does not synthesize history that was never persisted.
                            </p>
                          )}
                        </div>

                        {selectedRun.status === "COMPLETED" ? (
                          <div className="mt-6">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3A0CA3]">Result</p>
                            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-4 font-sans text-sm leading-6 text-[#111115]">
                              {displayResult(selectedRun.result)}
                            </pre>
                            {selectedRun.provider === "DEERFLOW" && selectedArtifacts.length ? (
                              <div className="mt-5">
                                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3A0CA3]">Generated files</p>
                                <div className="flex flex-wrap gap-2">
                                  {selectedArtifacts.map((path) => (
                                    <a
                                      key={path}
                                      href={artifactHref(selectedRun.id, path)}
                                      download
                                      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-xs text-[#111115] shadow-xs hover:bg-[#FAF9F6]"
                                    >
                                      <Download className="size-3.5 shrink-0" aria-hidden />
                                      <span className="truncate">{artifactName(path)}</span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : selectedRun.errorMessage ? (
                          <div className="mt-6 flex gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
                            <AlertTriangle className="mt-1 size-4 shrink-0 text-red-600" aria-hidden />
                            <span>{selectedRun.errorMessage}</span>
                          </div>
                        ) : (
                          <div className="mt-6 flex items-center gap-3 rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-4 py-4 text-sm text-[#6B6A75]">
                            {selectedRun.status === "RUNNING" ? <Loader2 className="size-4 animate-spin text-[#3A0CA3]" aria-hidden /> : <Clock3 className="size-4 text-[#8F8E98]" aria-hidden />}
                            <span>{selectedRun.status === "RUNNING" ? "The runtime is working on this task." : "AIRA is retaining the last verified run state."}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid min-h-[360px] place-items-center text-center">
                        <div>
                          <CheckCircle2 className="mx-auto size-5 text-[#8F8E98]" aria-hidden />
                          <p className="mt-3 text-sm text-[#6B6A75]">Select a run to inspect its persisted lifecycle.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
