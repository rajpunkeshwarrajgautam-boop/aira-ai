"use client";

import { FileText, Loader2, RefreshCw, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type Asset = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "UPLOADING" | "QUEUED" | "PROCESSING" | "READY" | "FAILED";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function KnowledgePage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setMessage(null);
    try {
      const response = await fetch("/api/knowledge", { cache: "no-store" });
      const data = (await response.json()) as { assets?: Asset[]; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Knowledge workspace is unavailable.");
      setAssets(data.assets ?? []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load knowledge assets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!assets.some((a) => a.status === "QUEUED" || a.status === "PROCESSING" || a.status === "UPLOADING")) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [assets, refresh]);

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/knowledge", { method: "POST", body: form });
      const data = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Upload failed.");
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-5 py-7 md:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#a98b43]">Knowledge</p><h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#f2f2ee] md:text-3xl">Files that AIRA can actually use</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#8b9098]">Upload documents into AIRA's existing ingestion pipeline. Ready assets can participate in semantic context retrieval during research.</p></div>
              <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#111419] px-3 py-2 text-xs font-medium text-[#abb0b7] hover:bg-[#15191f]"><RefreshCw className="size-3.5" />Refresh</button>
            </div>

            <section className="mb-5 rounded-2xl border border-dashed border-white/[0.12] bg-[#0f1216] p-5 md:p-7">
              <div className="flex flex-col items-center justify-center py-7 text-center">
                <span className="mb-4 grid size-12 place-items-center rounded-xl border border-[#c9a84c]/20 bg-[#c9a84c]/[0.07] text-[#d0b25c]"><UploadCloud className="size-5" /></span>
                <h2 className="text-base font-semibold text-[#efefeb]">Add knowledge</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#7d828a]">PDF, DOCX, Markdown, text, CSV, JSON, PNG, JPEG and WebP up to 20 MB. Audio/video are accepted only when advanced ingestion is configured.</p>
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
                <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#d0ae55] px-4 py-2.5 text-sm font-semibold text-[#111214] hover:bg-[#dfbd63] disabled:opacity-40">{uploading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}Choose file</button>
              </div>
            </section>

            {message ? <div className="mb-5 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] px-4 py-3 text-sm leading-6 text-amber-100">{message}</div> : null}

            <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1216]">
              <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4"><div><h2 className="text-sm font-semibold text-[#ededeb]">Library</h2><p className="mt-1 text-xs text-[#72777f]">{assets.length} assets</p></div></div>
              {loading ? <div className="grid place-items-center py-16"><Loader2 className="size-5 animate-spin text-[#9a8142]" /></div> : assets.length ? (
                <ul className="divide-y divide-white/[0.06]">
                  {assets.map((asset) => (
                    <li key={asset.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <span className="grid size-10 place-items-center rounded-xl bg-[#171a1f] text-[#9ca1a8]"><FileText className="size-4" /></span>
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[#e8e9e6]">{asset.filename}</p><p className="mt-1 text-xs text-[#6e737b]">{asset.mimeType} · {formatBytes(asset.sizeBytes)}</p>{asset.errorMessage ? <p className="mt-1 text-xs text-red-300">{asset.errorMessage}</p> : null}</div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${asset.status === "READY" ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300" : asset.status === "FAILED" ? "border-red-400/20 bg-red-400/[0.07] text-red-300" : "border-[#c9a84c]/20 bg-[#c9a84c]/[0.06] text-[#d1b35d]"}`}>{asset.status}</span>
                    </li>
                  ))}
                </ul>
              ) : <div className="px-6 py-16 text-center text-sm text-[#686d75]">No knowledge assets yet.</div>}
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
