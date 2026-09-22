"use client";

import {
	AlertTriangle,
	Eye,
	FileText,
	FolderOpen,
	Info,
	Loader2,
	RefreshCw,
	Sparkles,
	Trash2,
	UploadCloud,
	X,
} from "lucide-react";
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

type AssetDetail = Asset & {
	sampleText?: string;
	chunkCount?: number;
};

const bytes = (n: number) =>
	n < 1024
		? `${n} B`
		: n < 1048576
			? `${(n / 1024).toFixed(1)} KB`
			: `${(n / 1048576).toFixed(1)} MB`;

const ALLOWED_EXTENSIONS = [
	".pdf",
	".docx",
	".txt",
	".md",
	".csv",
	".json",
	".png",
	".jpg",
	".jpeg",
	".webp",
];
const MAX_BYTES = 20 * 1024 * 1024;

export default function KnowledgePage() {
	const [assets, setAssets] = useState<Asset[]>([]);
	const [loading, setLoading] = useState(true);
	const [uploading, setUploading] = useState(false);
	const [ingestionDisabled, setIngestionDisabled] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	// Preview drawer state
	const [previewAsset, setPreviewAsset] = useState<AssetDetail | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);

	// Delete confirmation modal state
	const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);
	const [deleting, setDeleting] = useState(false);

	const input = useRef<HTMLInputElement>(null);

	const refresh = useCallback(async () => {
		try {
			const r = await fetch("/api/knowledge/library", { cache: "no-store" });
			const d = (await r.json()) as {
				assets?: Asset[];
				error?: { code?: string; message?: string };
			};
			if (!r.ok) {
				if (d.error?.code === "MULTIMODAL_INGESTION_DISABLED" || r.status === 503) {
					setIngestionDisabled(true);
					setAssets([]);
					setError(null);
					return;
				}
				throw new Error(d.error?.message ?? "Knowledge workspace unavailable.");
			}
			setIngestionDisabled(false);
			setAssets(d.assets ?? []);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not load knowledge assets.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!assets.some((a) => ["UPLOADING", "QUEUED", "PROCESSING"].includes(a.status)))
			return;
		const t = window.setInterval(() => void refresh(), 5000);
		return () => window.clearInterval(t);
	}, [assets, refresh]);

	async function upload(file: File) {
		if (file.size > MAX_BYTES) {
			setError(`File "${file.name}" exceeds the 20 MB size limit.`);
			return;
		}
		setUploading(true);
		setMessage(null);
		setError(null);
		try {
			const form = new FormData();
			form.set("file", file);
			const r = await fetch("/api/knowledge", { method: "POST", body: form });
			const d = (await r.json()) as { error?: { message?: string } };
			if (!r.ok) throw new Error(d.error?.message ?? "Upload failed.");
			setMessage(`Successfully queued "${file.name}" for ingestion.`);
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Upload failed.");
		} finally {
			setUploading(false);
			if (input.current) input.current.value = "";
		}
	}

	function handleDragEnter(e: React.DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(true);
	}

	function handleDragOver(e: React.DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(true);
	}

	function handleDragLeave(e: React.DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (e.currentTarget.contains(e.relatedTarget as Node)) return;
		setIsDragging(false);
	}

	function handleDrop(e: React.DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);
		const files = e.dataTransfer.files;
		if (files && files.length > 0 && files[0]) {
			const file = files[0];
			void upload(file);
		}
	}

	async function openPreview(asset: Asset) {
		setPreviewAsset(asset);
		setPreviewLoading(true);
		try {
			const res = await fetch(`/api/knowledge/assets/${encodeURIComponent(asset.id)}`, {
				cache: "no-store",
			});
			if (res.ok) {
				const data = (await res.json()) as { asset: AssetDetail };
				setPreviewAsset(data.asset);
			}
		} catch {
			// keep basic asset info on error
		} finally {
			setPreviewLoading(false);
		}
	}

	async function confirmDelete() {
		if (!assetToDelete) return;
		setDeleting(true);
		try {
			const res = await fetch(`/api/knowledge/assets/${encodeURIComponent(assetToDelete.id)}`, {
				method: "DELETE",
			});
			if (!res.ok) {
				const data = (await res.json()) as { error?: { message?: string } };
				throw new Error(data.error?.message ?? "Deletion failed.");
			}
			setMessage(`"${assetToDelete.filename}" deleted successfully.`);
			if (previewAsset?.id === assetToDelete.id) {
				setPreviewAsset(null);
			}
			setAssetToDelete(null);
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not delete asset.");
		} finally {
			setDeleting(false);
		}
	}

	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-5 py-7 text-[#111115] md:px-8">
					<div className="mx-auto max-w-6xl">
						{/* Header */}
						<div className="mb-7 flex flex-wrap items-end justify-between gap-4">
							<div>
								<div className="flex items-center gap-2 text-xs font-semibold text-[#3A0CA3]">
									<FolderOpen className="size-3.5" aria-hidden /> Knowledge
								</div>
								<h1 className="mt-2 text-2xl font-semibold tracking-[-.025em] text-[#111115] md:text-3xl">
									Documents & Context Library
								</h1>
								<p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B6A75]">
									Upload documents into AIRA&apos;s ingestion queue — files that AIRA can actually use. Ready assets participate in
									semantic knowledge retrieval, providing verified citations during research.
								</p>
							</div>
							<button
								type="button"
								onClick={() => void refresh()}
								className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.08)] bg-white px-3.5 py-2 text-xs font-semibold text-[#111115] shadow-2xs transition hover:bg-[#FAF9F6]"
							>
								<RefreshCw className="size-3.5 text-[#3A0CA3]" />
								Refresh
							</button>
						</div>

						{/* Ingestion Status or Drag and Drop Zone */}
						{ingestionDisabled ? (
							<section className="mb-6 rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-6 shadow-xs">
								<div className="flex items-start gap-4">
									<span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] text-[#3A0CA3]">
										<FolderOpen className="size-5" />
									</span>
									<div className="min-w-0 flex-1">
										<h2 className="text-sm font-semibold text-[#111115]">
											Document ingestion is not enabled on this deployment
										</h2>
										<p className="mt-1 text-xs leading-5 text-[#6B6A75]">
											Multimodal and local document upload requires a configured embedding model and vector index. Research continues to leverage verified web sources, real-time live retrieval, and persistent user memory.
										</p>
									</div>
								</div>
							</section>
						) : (
							<section
								onDragEnter={handleDragEnter}
								onDragOver={handleDragOver}
								onDragLeave={handleDragLeave}
								onDrop={handleDrop}
								className={`mb-6 rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
									isDragging
										? "border-[#3A0CA3] bg-[rgba(58,12,163,0.06)]"
										: "border-[rgba(17,17,21,0.14)] bg-white shadow-xs hover:border-[#3A0CA3]/40 hover:bg-[#FAF9F6]"
								}`}
							>
								<UploadCloud
									className={`mx-auto size-8 transition ${
										isDragging ? "text-[#3A0CA3] scale-110" : "text-[#3A0CA3]"
									}`}
								/>
								<h2 className="mt-3 text-base font-semibold text-[#111115]">
									{isDragging ? "Drop your file here" : "Add knowledge assets"}
								</h2>
								<p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-[#6B6A75] sm:text-sm">
									Drag and drop files here, or click to browse. Supports PDF, DOCX, Markdown, TXT,
									CSV, JSON, and images up to 20 MB.
								</p>
								<input
									ref={input}
									type="file"
									accept={ALLOWED_EXTENSIONS.join(",")}
									className="hidden"
									onChange={(e) => {
										const f = e.target.files?.[0];
										if (f) void upload(f);
									}}
								/>
								<div className="mt-5 flex items-center justify-center gap-3">
									<button
										type="button"
										disabled={uploading}
										onClick={() => input.current?.click()}
										className="inline-flex items-center gap-2 rounded-xl bg-[#3A0CA3] px-5 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#2D0A82] active:scale-[0.98] disabled:opacity-40"
									>
										{uploading ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<UploadCloud className="size-4" />
										)}
										{uploading ? "Ingesting…" : "Choose File"}
									</button>
								</div>
							</section>
						)}

						{/* Notification Banners */}
						{message ? (
							<div
								role="status"
								className="mb-5 flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[.08] px-4 py-3 text-sm text-emerald-800"
							>
								<span>{message}</span>
								<button
									type="button"
									onClick={() => setMessage(null)}
									className="text-emerald-700 hover:text-emerald-900"
								>
									<X className="size-4" />
								</button>
							</div>
						) : null}
						{error ? (
							<div
								role="alert"
								className="mb-5 flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-800"
							>
								<span>{error}</span>
								<button
									type="button"
									onClick={() => setError(null)}
									className="text-red-600 hover:text-red-900"
								>
									<X className="size-4" />
								</button>
							</div>
						) : null}

						{/* Asset Library */}
						<section className="overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs">
							<div className="flex items-center justify-between border-b border-[rgba(17,17,21,0.08)] px-5 py-4">
								<div>
									<h2 className="text-sm font-semibold text-[#111115]">Active Documents</h2>
									<p className="mt-0.5 text-xs text-[#6B6A75]">{assets.length} stored assets</p>
								</div>
							</div>

							{loading ? (
								<div className="grid place-items-center py-16">
									<Loader2 className="size-5 animate-spin text-[#3A0CA3]" />
								</div>
							) : assets.length ? (
								<ul className="divide-y divide-[rgba(17,17,21,0.06)]">
									{assets.map((a) => (
										<li
											key={a.id}
											className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 transition hover:bg-[#FAF9F6]"
										>
											<div className="flex min-w-0 flex-1 items-center gap-3.5">
												<span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]">
													<FileText className="size-5" />
												</span>
												<div className="min-w-0 flex-1">
													<p className="truncate text-sm font-semibold text-[#111115]">
														{a.filename}
													</p>
													<p className="mt-0.5 text-xs text-[#6B6A75]">
														{a.mimeType} · {bytes(a.sizeBytes)} ·{" "}
														{new Date(a.createdAt).toLocaleDateString()}
													</p>
													{a.errorMessage ? (
														<p className="mt-1 text-xs text-red-600">{a.errorMessage}</p>
													) : null}
												</div>
											</div>

											<div className="flex items-center gap-2.5">
												<span
													className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
														a.status === "READY"
															? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800"
															: a.status === "FAILED"
																? "border-red-500/20 bg-red-500/10 text-red-800"
																: "border-[rgba(58,12,163,0.2)] bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]"
													}`}
												>
													{a.status}
												</span>

												{/* Preview button */}
												<button
													type="button"
													onClick={() => void openPreview(a)}
													className="grid size-8 place-items-center rounded-lg border border-[rgba(17,17,21,0.08)] text-[#6B6A75] transition hover:bg-[#FAF9F6] hover:text-[#111115]"
													title="Inspect asset details and extracted text"
													aria-label={`Inspect ${a.filename}`}
												>
													<Eye className="size-3.5" />
												</button>

												{/* Delete button */}
												<button
													type="button"
													onClick={() => setAssetToDelete(a)}
													className="grid size-8 place-items-center rounded-lg border border-[rgba(17,17,21,0.08)] text-[#6B6A75] transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-700"
													title="Delete asset"
													aria-label={`Delete ${a.filename}`}
												>
													<Trash2 className="size-3.5" />
												</button>
											</div>
										</li>
									))}
								</ul>
							) : (
								<div className="py-16 text-center text-sm text-[#6B6A75]">
									<Info className="mx-auto mb-2 size-5 text-[#8F8E98]" />
									{ingestionDisabled
										? "No local knowledge assets. Document ingestion is disabled on this deployment."
										: "No knowledge assets uploaded yet. Add documents above to augment research queries."}
								</div>
							)}
						</section>

						{/* Educational Info Card */}
						<div className="mt-8 grid gap-4 sm:grid-cols-3">
							<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
								<p className="flex items-center gap-2 text-xs font-semibold text-[#111115]">
									<Sparkles className="size-3.5 text-[#3A0CA3]" />
									Semantic Embedding
								</p>
								<p className="mt-1 text-xs leading-5 text-[#6B6A75]">
									Documents are securely chunked and indexed into pgvector embeddings for rapid semantic
									retrieval.
								</p>
							</div>
							<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
								<p className="flex items-center gap-2 text-xs font-semibold text-[#111115]">
									<FileText className="size-3.5 text-[#3A0CA3]" />
									Lexical Fallback
								</p>
								<p className="mt-1 text-xs leading-5 text-[#6B6A75]">
									Exact term matching ensures technical strings, IDs, and code snippets are never lost
									during retrieval.
								</p>
							</div>
							<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
								<p className="flex items-center gap-2 text-xs font-semibold text-[#111115]">
									<AlertTriangle className="size-3.5 text-[#3A0CA3]" />
									Tenant Isolation
								</p>
								<p className="mt-1 text-xs leading-5 text-[#6B6A75]">
									All chunks and storage keys are strictly bound to your authenticated user ID with
									Row-Level Security.
								</p>
							</div>
						</div>
					</div>

					{/* Asset Preview Drawer */}
					{previewAsset ? (
						<div
							className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-xs"
							onClick={() => setPreviewAsset(null)}
						>
							<div
								className="h-full w-full max-w-xl overflow-y-auto border-l border-[rgba(17,17,21,0.08)] bg-white p-6 shadow-2xl text-[#111115]"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="flex items-center justify-between border-b border-[rgba(17,17,21,0.08)] pb-4">
									<div className="min-w-0 flex-1">
										<h3 className="truncate text-base font-semibold text-[#111115]">
											{previewAsset.filename}
										</h3>
										<p className="mt-0.5 text-xs text-[#6B6A75]">
											{previewAsset.mimeType} · {bytes(previewAsset.sizeBytes)}
										</p>
									</div>
									<button
										type="button"
										onClick={() => setPreviewAsset(null)}
										className="grid size-8 place-items-center rounded-lg border border-[rgba(17,17,21,0.08)] text-[#6B6A75] hover:bg-[#FAF9F6] hover:text-[#111115]"
										aria-label="Close preview"
									>
										<X className="size-4" />
									</button>
								</div>

								<div className="mt-5 space-y-4">
									<div>
										<p className="text-xs font-semibold text-[#3A0CA3]">
											Status
										</p>
										<p className="mt-1 text-xs text-[#111115]">{previewAsset.status}</p>
									</div>

									<div>
										<p className="text-xs font-semibold text-[#3A0CA3]">
											Indexed Chunks
										</p>
										<p className="mt-1 text-xs text-[#111115]">
											{previewLoading
												? "Loading…"
												: previewAsset.chunkCount !== undefined
													? `${previewAsset.chunkCount} chunk(s)`
													: "Standard index"}
										</p>
									</div>

									<div>
										<p className="text-xs font-semibold text-[#3A0CA3]">
											Extracted Text Preview
										</p>
										<div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-4 text-xs leading-6 text-[#111115]">
											{previewLoading ? (
												<div className="flex items-center gap-2 text-[#6B6A75]">
													<Loader2 className="size-4 animate-spin text-[#3A0CA3]" />
													Loading preview content…
												</div>
											) : previewAsset.sampleText ? (
												<pre className="whitespace-pre-wrap font-mono text-[11px]">
													{previewAsset.sampleText}
												</pre>
											) : (
												<p className="text-[#6B6A75] italic">
													No textual preview available yet. File is in{" "}
													{previewAsset.status} state.
												</p>
											)}
										</div>
									</div>

									<div className="border-t border-[rgba(17,17,21,0.08)] pt-4 text-xs text-[#6B6A75]">
										<p>Asset ID: {previewAsset.id}</p>
										<p className="mt-1">
											Uploaded: {new Date(previewAsset.createdAt).toLocaleString()}
										</p>
									</div>
								</div>
							</div>
						</div>
					) : null}

					{/* Delete Confirmation Modal */}
					{assetToDelete ? (
						<div
							className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
							onClick={() => !deleting && setAssetToDelete(null)}
						>
							<div
								className="w-full max-w-md rounded-2xl border border-red-500/20 bg-white p-6 shadow-2xl text-[#111115]"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="flex items-center gap-3 text-red-600">
									<AlertTriangle className="size-5" />
									<h3 className="text-base font-semibold text-[#111115]">Delete Knowledge Asset</h3>
								</div>
								<p className="mt-3 text-xs leading-6 text-[#6B6A75]">
									Are you sure you want to delete{" "}
									<strong className="text-[#111115]">{assetToDelete.filename}</strong>? This action
									will permanently remove all stored chunks and semantic embeddings.
								</p>
								<div className="mt-6 flex justify-end gap-3">
									<button
										type="button"
										disabled={deleting}
										onClick={() => setAssetToDelete(null)}
										className="rounded-xl border border-[rgba(17,17,21,0.12)] px-4 py-2 text-xs font-semibold text-[#111115] hover:bg-[#FAF9F6] disabled:opacity-50"
									>
										Cancel
									</button>
									<button
										type="button"
										disabled={deleting}
										onClick={() => void confirmDelete()}
										className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
									>
										{deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
										{deleting ? "Deleting…" : "Delete"}
									</button>
								</div>
							</div>
						</div>
					) : null}
				</main>
			</AiraV2Frame>
		</div>
	);
}
