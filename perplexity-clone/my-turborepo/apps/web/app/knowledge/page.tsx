"use client";

import { FileText, Loader2, RefreshCw, Search, UploadCloud } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { cn } from "@/lib/cn";
import styles from "./knowledge.module.css";

type AssetStatus = "UPLOADING" | "QUEUED" | "PROCESSING" | "READY" | "FAILED";
type Asset = {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: AssetStatus;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};
type Filter = "ALL" | "READY" | "PROCESSING" | "FAILED";

const PROCESSING_STATES: readonly AssetStatus[] = ["UPLOADING", "QUEUED", "PROCESSING"];

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function dateLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(timestamp));
}

function matchesFilter(asset: Asset, filter: Filter): boolean {
  if (filter === "ALL") return true;
  if (filter === "PROCESSING") return PROCESSING_STATES.includes(asset.status);
  return asset.status === filter;
}

function statusClass(status: AssetStatus): string {
  if (status === "READY") return styles.ready ?? "";
  if (status === "FAILED") return styles.failed ?? "";
  return styles.processing ?? "";
}

export default function KnowledgePage() {
  const searchParams = useSearchParams();
  const highlightedAsset = searchParams.get("asset");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/knowledge/library", {
        cache: "no-store",
        credentials: "include",
      });
      const data = (await response.json()) as { assets?: Asset[]; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Knowledge workspace unavailable.");
      setAssets(data.assets ?? []);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load knowledge assets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!assets.some((asset) => PROCESSING_STATES.includes(asset.status))) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [assets, refresh]);

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/knowledge", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Upload failed.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  const counts = useMemo(() => ({
    all: assets.length,
    ready: assets.filter((asset) => asset.status === "READY").length,
    processing: assets.filter((asset) => PROCESSING_STATES.includes(asset.status)).length,
    failed: assets.filter((asset) => asset.status === "FAILED").length,
  }), [assets]);

  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (!matchesFilter(asset, filter)) return false;
      if (!needle) return true;
      return `${asset.filename} ${asset.mimeType} ${asset.status}`.toLowerCase().includes(needle);
    });
  }, [assets, filter, query]);

  const filters: readonly { id: Filter; label: string; count: number }[] = [
    { id: "ALL", label: "All", count: counts.all },
    { id: "READY", label: "Ready", count: counts.ready },
    { id: "PROCESSING", label: "Processing", count: counts.processing },
    { id: "FAILED", label: "Failed", count: counts.failed },
  ];

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={styles.page}>
          <div className={styles.inner}>
            <header className={styles.header}>
              <div>
                <p className={styles.eyebrow}>Knowledge</p>
                <h1 className={styles.title}>Files AIRA can retrieve from</h1>
                <p className={styles.description}>
                  Upload supported documents into the real ingestion pipeline. Only READY assets participate in knowledge retrieval; processing and failures remain visible here.
                </p>
              </div>
              <div className={styles.headerActions}>
                <button type="button" onClick={() => void refresh()} disabled={loading} className={styles.button}>
                  <RefreshCw className={cn("size-3.5", loading && styles.spin)} aria-hidden /> Refresh
                </button>
              </div>
            </header>

            <section className={styles.dropzone} aria-label="Upload knowledge">
              <div className={styles.dropCopy}>
                <span className={styles.dropIcon}><UploadCloud className="size-5" aria-hidden /></span>
                <span>
                  <strong>Add knowledge</strong>
                  <span>PDF, DOCX, Markdown, text, CSV, JSON and supported images up to 20 MB.</span>
                </span>
              </div>
              <input
                ref={input}
                type="file"
                className={styles.hiddenInput}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <button type="button" disabled={uploading} onClick={() => input.current?.click()} className={styles.primary}>
                {uploading ? <Loader2 className={cn("size-4", styles.spin)} aria-hidden /> : <UploadCloud className="size-4" aria-hidden />}
                {uploading ? "Uploading…" : "Choose file"}
              </button>
            </section>

            {message ? <p className={styles.notice} role="alert">{message}</p> : null}

            <section className={styles.library} aria-label="Knowledge library">
              <div className={styles.libraryHeader}>
                <div className={styles.filters} role="group" aria-label="Filter knowledge assets">
                  {filters.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFilter(item.id)}
                      className={cn(styles.filter, filter === item.id && styles.filterActive)}
                      aria-pressed={filter === item.id}
                    >
                      {item.label} · {item.count}
                    </button>
                  ))}
                </div>
                <label className={styles.search}>
                  <Search aria-hidden />
                  <span className="sr-only">Search knowledge assets</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} className={styles.searchInput} placeholder="Filter files…" />
                </label>
              </div>

              <div className={styles.tableHeader} aria-hidden>
                <span>File</span><span>Status</span><span>Updated</span><span>Size</span>
              </div>

              {loading ? (
                <div className={styles.loading}><Loader2 className={cn("size-5", styles.spin)} aria-label="Loading knowledge assets" /></div>
              ) : visibleAssets.length ? (
                <div role="list">
                  {visibleAssets.map((asset) => (
                    <article key={asset.id} role="listitem" className={cn(styles.row, highlightedAsset === asset.id && styles.rowHighlighted)}>
                      <div className={styles.fileCell}>
                        <span className={styles.fileIcon}><FileText className="size-4" aria-hidden /></span>
                        <div className={styles.fileCopy}>
                          <div className={styles.filename} title={asset.filename}>{asset.filename}</div>
                          <div className={styles.fileMeta}>{asset.mimeType}</div>
                          {asset.errorMessage ? <div className={styles.errorText} title={asset.errorMessage}>{asset.errorMessage}</div> : null}
                        </div>
                      </div>
                      <div className={styles.cell}><span className={cn(styles.status, statusClass(asset.status))}>{asset.status}</span></div>
                      <div className={styles.cell}>{dateLabel(asset.updatedAt)}</div>
                      <div className={styles.cell}>{bytes(asset.sizeBytes)}</div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.empty}>
                  <div>
                    <strong>{assets.length ? "No files match this view" : "No knowledge assets yet"}</strong>
                    <span>{assets.length ? "Change the status filter or filename search." : "Upload a document to begin building AIRA knowledge."}</span>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
