"use client";

import { Download, FilePlus2, FileText, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Version = { version: number; content: string; checksum: string; sizeBytes: number; createdAt: string; validation?: { isValid?: boolean; score?: number } };
type Artifact = { id: string; projectId?: string; name: string; format: string; mimeType: string; currentVersion: number; versions: Version[]; tags: string[]; createdAt: string; updatedAt: string };
type ApiError = { error?: { message?: string } };

async function readError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function VerifiedArtifactWorkspace() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("artifact");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [name, setName] = useState("AIRA verification note.md");
  const [format, setFormat] = useState<"MARKDOWN" | "TXT" | "JSON" | "CSV">("MARKDOWN");
  const [content, setContent] = useState("# AIRA artifact\n\nCreated from the authenticated artifact workspace.");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<unknown>(null);

  const selected = useMemo(() => artifacts.find((artifact) => artifact.id === selectedId) ?? null, [artifacts, selectedId]);
  const activeVersion = useMemo(() => selected?.versions.find((version) => version.version === selected.currentVersion) ?? selected?.versions[0] ?? null, [selected]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/artifacts", { cache: "no-store" });
      if (!response.ok) throw await readError(response);
      const body = (await response.json()) as { artifacts: Artifact[] };
      setArtifacts(body.artifacts);
      setSelectedId((current) => current && body.artifacts.some((artifact) => artifact.id === current) ? current : body.artifacts[0]?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Artifacts could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) { setProvenance(null); return; }
    void fetch(`/api/artifacts/${encodeURIComponent(selected.id)}/provenance`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => setProvenance(body))
      .catch(() => setProvenance(null));
  }, [selected]);

  async function createArtifact() {
    if (!name.trim() || !content.trim()) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          format,
          content,
          provenance: { runId: `workspace-${crypto.randomUUID()}`, inputChecksum: "direct_input", generator: "AIRA Artifact Workspace" },
          tags: ["workspace-created"],
        }),
      });
      if (!response.ok) throw await readError(response);
      const body = (await response.json()) as { artifact: Artifact };
      setArtifacts((current) => [body.artifact, ...current.filter((item) => item.id !== body.artifact.id)]);
      setSelectedId(body.artifact.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Artifact could not be created."); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-7">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3A0CA3]">Artifacts</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#111115]">Durable deliverables</h1>
            <p className="mt-1 max-w-3xl text-sm text-[#6B6A75]">Only authenticated server artifacts are shown. An empty library stays empty; no demo documents or fake checksums are injected.</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-xs font-medium text-[#111115] shadow-xs hover:bg-[#FAF9F6]">
            <RefreshCw className="size-3.5" />Refresh
          </button>
        </header>
        {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        <section className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
              <div className="flex items-center gap-2">
                <FilePlus2 className="size-4 text-[#3A0CA3]" />
                <h2 className="text-sm font-semibold text-[#111115]">Create durable artifact</h2>
              </div>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-3 w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] placeholder:text-[#8F8E98] outline-none focus:border-[#3A0CA3]" />
              <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} className="mt-2 w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] outline-none focus:border-[#3A0CA3]">
                <option>MARKDOWN</option>
                <option>TXT</option>
                <option>JSON</option>
                <option>CSV</option>
              </select>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} className="mt-2 w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 font-mono text-xs leading-5 text-[#111115] placeholder:text-[#8F8E98] outline-none focus:border-[#3A0CA3]" />
              <button type="button" onClick={() => void createArtifact()} disabled={busy || !name.trim() || !content.trim()} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#3A0CA3] hover:bg-[#2D0A82] px-3 py-2 text-sm font-semibold text-white shadow-xs transition disabled:opacity-40">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}Create
              </button>
            </div>
            <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-3 shadow-xs">
              <p className="px-2 py-2 text-[10px] uppercase tracking-[0.14em] text-[#6B6A75]">Library · {artifacts.length}</p>
              {loading ? (
                <div className="grid place-items-center py-10"><Loader2 className="size-4 animate-spin text-[#3A0CA3]" /></div>
              ) : artifacts.length ? (
                <div className="max-h-[520px] space-y-1 overflow-auto">
                  {artifacts.map((artifact) => (
                    <button key={artifact.id} type="button" onClick={() => setSelectedId(artifact.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${artifact.id === selectedId ? "border border-[#3A0CA3]/30 bg-[#3A0CA3]/[0.08] text-[#111115]" : "hover:bg-[#FAF9F6] text-[#111115]"}`}>
                      <p className="truncate text-sm font-medium">{artifact.name}</p>
                      <p className="mt-1 text-[10px] text-[#6B6A75]">{artifact.format} · v{artifact.currentVersion}</p>
                    </button>
                  ))}
                </div>
              ) : <p className="px-3 py-10 text-center text-sm text-[#8F8E98]">No artifacts yet.</p>}
            </div>
          </aside>
          <div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
            {!selected ? (
              <div className="grid min-h-[420px] place-items-center text-sm text-[#8F8E98]">Select or create an artifact.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-[#3A0CA3]" />
                      <h2 className="text-base font-semibold text-[#111115]">{selected.name}</h2>
                    </div>
                    <p className="mt-1 text-xs text-[#6B6A75]">{selected.mimeType} · {selected.format} · version {selected.currentVersion}</p>
                  </div>
                  <a href={`/api/artifacts/${encodeURIComponent(selected.id)}/download?version=${selected.currentVersion}`} className="inline-flex items-center gap-2 rounded-lg bg-[#3A0CA3] hover:bg-[#2D0A82] px-3 py-2 text-xs font-semibold text-white shadow-xs transition">
                    <Download className="size-3.5" />Download real bytes
                  </a>
                </div>
                {activeVersion ? (
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-[rgba(17,17,21,0.06)] bg-[#FAF9F6] p-3">
                      <p className="text-[10px] uppercase text-[#6B6A75]">Checksum</p>
                      <p className="mt-1 break-all font-mono text-[10px] text-[#111115]">{activeVersion.checksum}</p>
                    </div>
                    <div className="rounded-xl border border-[rgba(17,17,21,0.06)] bg-[#FAF9F6] p-3">
                      <p className="text-[10px] uppercase text-[#6B6A75]">Size</p>
                      <p className="mt-1 text-sm font-semibold text-[#111115]">{activeVersion.sizeBytes.toLocaleString()} bytes</p>
                    </div>
                    <div className="rounded-xl border border-[rgba(17,17,21,0.06)] bg-[#FAF9F6] p-3">
                      <p className="text-[10px] uppercase text-[#6B6A75]">Validation</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-[#111115]">
                        <ShieldCheck className="size-3.5 text-emerald-600" />
                        {activeVersion.validation?.isValid === false ? "Invalid" : "Recorded"}
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-4">
                    <h3 className="text-xs font-semibold text-[#111115]">Preview / source payload</h3>
                    <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[#111115]">{activeVersion?.content ?? "Binary-only artifact. Use Download real bytes."}</pre>
                  </div>
                  <div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-4">
                    <h3 className="text-xs font-semibold text-[#111115]">Provenance</h3>
                    <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-[#6B6A75]">{provenance ? JSON.stringify(provenance, null, 2) : "No provenance response available."}</pre>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
