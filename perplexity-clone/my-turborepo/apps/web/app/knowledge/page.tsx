"use client";

import {
	AlertTriangle,
	Eye,
	FileText,
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
				error?: { message?: string };
			};
			if (!r.ok) throw new Error(d.error?.message ?? "Knowledge workspace unavailable.");
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
				<main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-5 py-7 md:px-8">
					<div className="mx-auto max-w-6xl">
						{/* Header */}
						<div className="mb-7 flex flex-wrap items-end justify-between gap-4">
							<div>
								<p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#a98b43]">
									Knowledge
								</p>
								<h1 className="text-2xl font-semibold tracking-[-.025em] text-[#f2f2ee] md:text-3xl">
									Documents & Context Library
								</h1>
								<p className="mt-2 max-w-2xl text-sm leading-6 text-[#8b9098]">
									Upload documents into AIRA&apos;s ingestion queue — files that AIRA can actually use. Ready assets participate in
									semantic knowledge retrieval, providing verified citations during research.
								</p>
							</div>
							<button
								type="button"
								onClick={() => void refresh()}
								className="inline-flex items-center gap-2 rounded-xl border border-white/[.08] bg-[#111419] px-3.5 py-2 text-xs font-medium text-[#abb0b7] transition hover:border-white/[.16] hover:bg-white/[.04] hover:text-[#f0f0ed]"
							>
								<RefreshCw className="size-3.5" />
								Refresh
							</button>
						</div>

						{/* Drag and Drop Zone */}
						<section
							onDragEnter={handleDragEnter}
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
							className={`mb-6 rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
								isDragging
									? "border-[#c9a84c] bg-[#c9a84c]/[0.08]"
									: "border-white/[.12] bg-[#0f1216] hover:border-white/[.2]"
							}`}
						>
							<UploadCloud
								className={`mx-auto size-8 transition ${
									isDragging ? "text-[#e5c97b] scale-110" : "text-[#d0b25c]"
								}`}
							/>
							<h2 className="mt-3 text-base font-semibold text-[#efefeb]">
								{isDragging ? "Drop your file here" : "Add knowledge assets"}
							</h2>
							<p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-[#8e95a2] sm:text-sm">
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
									className="inline-flex items-center gap-2 rounded-xl bg-[#d0ae55] px-5 py-2.5 text-xs font-semibold text-[#111214] shadow-[0_4px_14px_rgba(208,174,85,.25)] transition hover:bg-[#dfbd63] active:scale-[0.98] disabled:opacity-40"
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

						{/* Notification Banners */}
						{message ? (
							<div
								role="status"
								className="mb-5 flex items-center justify-between rounded-xl border border-emerald-400/20 bg-emerald-400/[.06] px-4 py-3 text-sm text-emerald-200"
							>
								<span>{message}</span>
								<button
									type="button"
									onClick={() => setMessage(null)}
									className="text-emerald-400 hover:text-emerald-200"
								>
									<X className="size-4" />
								</button>
							</div>
						) : null}
						{error ? (
							<div
								role="alert"
								className="mb-5 flex items-center justify-between rounded-xl border border-red-400/20 bg-red-400/[.06] px-4 py-3 text-sm text-red-200"
							>
								<span>{error}</span>
								<button
									type="button"
									onClick={() => setError(null)}
									className="text-red-400 hover:text-red-200"
								>
									<X className="size-4" />
								</button>
							</div>
						) : null}

						{/* Asset Library */}
						<section className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#0f1216]">
							<div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
								<div>
									<h2 className="text-sm font-semibold text-[#ededeb]">Active Documents</h2>
									<p className="mt-0.5 text-xs text-[#8e95a2]">{assets.length} stored assets</p>
								</div>
							</div>

							{loading ? (
								<div className="grid place-items-center py-16">
									<Loader2 className="size-5 animate-spin text-[#9a8142]" />
								</div>
							) : assets.length ? (
								<ul className="divide-y divide-white/[.06]">
									{assets.map((a) => (
										<li
											key={a.id}
											className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 transition hover:bg-white/[.02]"
										>
											<div className="flex min-w-0 flex-1 items-center gap-3.5">
												<span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#171a1f] text-[#9ca1a8]">
													<FileText className="size-5 text-[#c9a84c]" />
												</span>
												<div className="min-w-0 flex-1">
													<p className="truncate text-sm font-medium text-[#e8e9e6]">
														{a.filename}
													</p>
													<p className="mt-0.5 text-xs text-[#8e95a2]">
														{a.mimeType} · {bytes(a.sizeBytes)} ·{" "}
														{new Date(a.createdAt).toLocaleDateString()}
													</p>
													{a.errorMessage ? (
														<p className="mt-1 text-xs text-red-300">{a.errorMessage}</p>
													) : null}
												</div>
											</div>

											<div className="flex items-center gap-2.5">
												<span
													className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
														a.status === "READY"
															? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
															: a.status === "FAILED"
																? "border-red-400/20 bg-red-400/10 text-red-300"
																: "border-[#c9a84c]/20 bg-[#c9a84c]/10 text-[#d1b35d]"
													}`}
												>
													{a.status}
												</span>

												{/* Preview button */}
												<button
													type="button"
													onClick={() => void openPreview(a)}
													className="grid size-8 place-items-center rounded-lg border border-white/[.08] text-[#8e95a2] transition hover:border-white/[.18] hover:bg-white/[.05] hover:text-[#e8e9e6]"
													title="Inspect asset details and extracted text"
													aria-label={`Inspect ${a.filename}`}
												>
													<Eye className="size-3.5" />
												</button>

												{/* Delete button */}
												<button
													type="button"
													onClick={() => setAssetToDelete(a)}
													className="grid size-8 place-items-center rounded-lg border border-white/[.08] text-[#8e95a2] transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
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
								<div className="py-16 text-center text-sm text-[#8e95a2]">
									<Info className="mx-auto mb-2 size-5 text-[#6e747f]" />
									No knowledge assets uploaded yet. Add documents above to augment research queries.
								</div>
							)}
						</section>

						{/* Educational Info Card */}
						<div className="mt-8 grid gap-4 sm:grid-cols-3">
							<div className="rounded-xl border border-white/[.06] bg-[#0c0e12] p-4">
								<p className="flex items-center gap-2 text-xs font-semibold text-[#f0f0ed]">
									<Sparkles className="size-3.5 text-[#c9a84c]" />
									Semantic Embedding
								</p>
								<p className="mt-1 text-xs leading-5 text-[#8e95a2]">
									Documents are securely chunked and indexed into pgvector embeddings for rapid semantic
									retrieval.
								</p>
							</div>
							<div className="rounded-xl border border-white/[.06] bg-[#0c0e12] p-4">
								<p className="flex items-center gap-2 text-xs font-semibold text-[#f0f0ed]">
									<FileText className="size-3.5 text-[#c9a84c]" />
									Lexical Fallback
								</p>
								<p className="mt-1 text-xs leading-5 text-[#8e95a2]">
									Exact term matching ensures technical strings, IDs, and code snippets are never lost
									during retrieval.
								</p>
							</div>
							<div className="rounded-xl border border-white/[.06] bg-[#0c0e12] p-4">
								<p className="flex items-center gap-2 text-xs font-semibold text-[#f0f0ed]">
									<AlertTriangle className="size-3.5 text-[#c9a84c]" />
									Tenant Isolation
								</p>
								<p className="mt-1 text-xs leading-5 text-[#8e95a2]">
									All chunks and storage keys are strictly bound to your authenticated user ID with
									Row-Level Security.
								</p>
							</div>
						</div>
					</div>

					{/* Asset Preview Drawer */}
					{previewAsset ? (
						<div
							className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm"
							onClick={() => setPreviewAsset(null)}
						>
							<div
								className="h-full w-full max-w-xl overflow-y-auto border-l border-white/[.09] bg-[#0d1015] p-6 shadow-2xl"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="flex items-center justify-between border-b border-white/[.08] pb-4">
									<div className="min-w-0 flex-1">
										<h3 className="truncate text-base font-semibold text-[#f0f0ed]">
											{previewAsset.filename}
										</h3>
										<p className="mt-0.5 text-xs text-[#8e95a2]">
											{previewAsset.mimeType} · {bytes(previewAsset.sizeBytes)}
										</p>
									</div>
									<button
										type="button"
										onClick={() => setPreviewAsset(null)}
										className="grid size-8 place-items-center rounded-lg border border-white/[.08] text-[#8e95a2] hover:text-[#f0f0ed]"
										aria-label="Close preview"
									>
										<X className="size-4" />
									</button>
								</div>

								<div className="mt-5 space-y-4">
									<div>
										<p className="text-[11px] font-semibold uppercase tracking-wider text-[#a98b43]">
											Status
										</p>
										<p className="mt-1 text-xs text-[#e0e0dc]">{previewAsset.status}</p>
									</div>

									<div>
										<p className="text-[11px] font-semibold uppercase tracking-wider text-[#a98b43]">
											Indexed Chunks
										</p>
										<p className="mt-1 text-xs text-[#e0e0dc]">
											{previewLoading
												? "Loading…"
												: previewAsset.chunkCount !== undefined
													? `${previewAsset.chunkCount} chunk(s)`
													: "Standard index"}
										</p>
									</div>

									<div>
										<p className="text-[11px] font-semibold uppercase tracking-wider text-[#a98b43]">
											Extracted Text Preview
										</p>
										<div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-white/[.08] bg-[#07090c] p-4 text-xs leading-6 text-[#cfd2d8]">
											{previewLoading ? (
												<div className="flex items-center gap-2 text-[#8e95a2]">
													<Loader2 className="size-4 animate-spin text-[#c9a84c]" />
													Loading preview content…
												</div>
											) : previewAsset.sampleText ? (
												<pre className="whitespace-pre-wrap font-mono text-[11px]">
													{previewAsset.sampleText}
												</pre>
											) : (
												<p className="text-[#8e95a2] italic">
													No textual preview available yet. File is in{" "}
													{previewAsset.status} state.
												</p>
											)}
										</div>
									</div>

									<div className="border-t border-white/[.07] pt-4 text-xs text-[#747a84]">
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
							className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
							onClick={() => !deleting && setAssetToDelete(null)}
						>
							<div
								className="w-full max-w-md rounded-2xl border border-red-500/20 bg-[#12151b] p-6 shadow-2xl"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="flex items-center gap-3 text-red-400">
									<AlertTriangle className="size-5" />
									<h3 className="text-base font-semibold text-[#f0f0ed]">Delete Knowledge Asset</h3>
								</div>
								<p className="mt-3 text-xs leading-6 text-[#8e95a2]">
									Are you sure you want to delete{" "}
									<strong className="text-[#f0f0ed]">{assetToDelete.filename}</strong>? This action
									will permanently remove all stored chunks and semantic embeddings.
								</p>
								<div className="mt-6 flex justify-end gap-3">
									<button
										type="button"
										disabled={deleting}
										onClick={() => setAssetToDelete(null)}
										className="rounded-xl border border-white/[.08] px-4 py-2 text-xs font-semibold text-[#d0d0cc] hover:bg-white/[.05] disabled:opacity-50"
									>
										Cancel
									</button>
									<button
										type="button"
										disabled={deleting}
										onClick={() => void confirmDelete()}
										className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
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
