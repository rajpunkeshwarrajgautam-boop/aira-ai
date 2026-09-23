"use client";

import {
	Archive,
	ArrowUpRight,
	Clock,
	Compass,
	FileText,
	Filter,
	Layers,
	Library,
	Loader2,
	MessageSquare,
	Plus,
	RefreshCw,
	Search,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

interface ConversationItem {
	readonly id: string;
	readonly title: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

interface ArtifactItem {
	readonly id: string;
	readonly name: string;
	readonly format: string;
	readonly currentVersion: number;
	readonly updatedAt: string;
}

function formatRelativeTime(dateString: string): string {
	const date = new Date(dateString);
	if (Number.isNaN(date.getTime())) return "Recently";
	const diffMs = Date.now() - date.getTime();
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHours = Math.floor(diffMin / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays > 30) {
		return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
	}
	if (diffDays > 0) return `${diffDays}d ago`;
	if (diffHours > 0) return `${diffHours}h ago`;
	if (diffMin > 0) return `${diffMin}m ago`;
	return "Just now";
}

export default function LibraryPage() {
	const router = useRouter();
	const [conversations, setConversations] = useState<ConversationItem[]>([]);
	const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [query, setQuery] = useState("");
	const [activeTab, setActiveTab] = useState<"all" | "conversations" | "artifacts">("all");
	const [error, setError] = useState<string | null>(null);

	const loadData = useCallback(async (isRefresh = false) => {
		if (isRefresh) setRefreshing(true);
		else setLoading(true);
		setError(null);

		try {
			const [convRes, artRes] = await Promise.all([
				fetch("/api/conversations?limit=50", { cache: "no-store" }),
				fetch("/api/artifacts", { cache: "no-store" }).catch(() => null),
			]);

			if (convRes.status === 401) {
				router.replace(`/signin?callbackUrl=${encodeURIComponent("/library")}`);
				return;
			}

			if (!convRes.ok) {
				throw new Error("Could not load saved conversations.");
			}

			const convData = (await convRes.json()) as { conversations?: ConversationItem[] };
			setConversations(convData.conversations ?? []);

			if (artRes && artRes.ok) {
				const artData = (await artRes.json()) as { artifacts?: ArtifactItem[] };
				setArtifacts(artData.artifacts ?? []);
			} else {
				setArtifacts([]);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load library items.");
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, [router]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const filteredConversations = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return conversations;
		return conversations.filter((c) => c.title.toLowerCase().includes(q));
	}, [conversations, query]);

	const filteredArtifacts = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return artifacts;
		return artifacts.filter((a) => a.name.toLowerCase().includes(q) || a.format.toLowerCase().includes(q));
	}, [artifacts, query]);

	const totalItemsCount = conversations.length + artifacts.length;

	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<main className="min-h-[calc(100dvh-72px)] bg-[#FAFAFA] px-4 py-8 sm:px-6 md:px-8">
					<div className="mx-auto max-w-[1280px]">
						{/* Header */}
						<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<div className="flex items-center gap-2 text-[12px] font-semibold tracking-wider text-[#71717A] uppercase">
									<Library className="size-3.5 text-[#18181B]" aria-hidden />
									<span>Workspace Library</span>
								</div>
								<h1 className="mt-1 text-2xl font-bold tracking-tight text-[#18181B] sm:text-3xl">
									Research & Dossiers
								</h1>
								<p className="mt-1 text-[13px] text-[#71717A]">
									Inspect your persistent investigations, verified source threads, and durable deliverables.
								</p>
							</div>

							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => void loadData(true)}
									disabled={loading || refreshing}
									aria-label="Refresh library"
									className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E4E4E7] bg-white px-3 text-[13px] font-medium text-[#27272A] shadow-xs transition hover:bg-[#F4F4F5] disabled:opacity-50"
								>
									<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
									<span className="hidden sm:inline">Refresh</span>
								</button>
								<Link
									href="/"
									className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#18181B] px-3.5 text-[13px] font-medium text-white shadow-xs transition hover:bg-[#27272A]"
								>
									<Plus className="size-3.5" />
									<span>New Research</span>
								</Link>
							</div>
						</div>

						{/* Search & Filter Toolbar */}
						<div className="mb-6 flex flex-col gap-3 rounded-xl border border-[#E4E4E7] bg-white p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
							<div className="relative flex-1">
								<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#A1A1AA]" />
								<input
									type="search"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="Search dossiers, threads, and outputs…"
									className="h-9 w-full rounded-lg border border-transparent bg-[#F4F4F5] pl-9 pr-3 text-[13px] text-[#18181B] outline-none placeholder:text-[#A1A1AA] focus:border-[#D4D4D8] focus:bg-white"
								/>
							</div>

							<div className="flex items-center gap-1 border-t border-[#F4F4F5] pt-2 sm:border-t-0 sm:pt-0">
								<button
									type="button"
									onClick={() => setActiveTab("all")}
									className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
										activeTab === "all"
											? "bg-[#18181B] text-white"
											: "text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#18181B]"
									}`}
								>
									All ({totalItemsCount})
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("conversations")}
									className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
										activeTab === "conversations"
											? "bg-[#18181B] text-white"
											: "text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#18181B]"
									}`}
								>
									Dossiers ({conversations.length})
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("artifacts")}
									className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
										activeTab === "artifacts"
											? "bg-[#18181B] text-white"
											: "text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#18181B]"
									}`}
								>
									Outputs ({artifacts.length})
								</button>
							</div>
						</div>

						{/* Error Banner */}
						{error ? (
							<div className="mb-6 rounded-xl border border-red-200 bg-red-50/60 p-4 text-[13px] text-red-700">
								{error}
							</div>
						) : null}

						{/* Loading State */}
						{loading ? (
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{[...Array(6)].map((_, i) => (
									<div
										key={i}
										className="h-32 animate-pulse rounded-xl border border-[#E4E4E7] bg-white p-4"
									/>
								))}
							</div>
						) : null}

						{/* Content Grid */}
						{!loading && (
							<>
								{totalItemsCount === 0 ? (
									<div className="rounded-2xl border border-dashed border-[#E4E4E7] bg-white p-12 text-center">
										<div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#F4F4F5] text-[#71717A]">
											<Library className="size-6" />
										</div>
										<h2 className="mt-4 text-[15px] font-semibold text-[#18181B]">Your library is empty</h2>
										<p className="mx-auto mt-1 max-w-sm text-[13px] text-[#71717A]">
											Conduct grounded research or run tasks to populate your persistent library with verified intelligence.
										</p>
										<div className="mt-5">
											<Link
												href="/"
												className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#18181B] px-4 text-[13px] font-medium text-white shadow-xs transition hover:bg-[#27272A]"
											>
												<Plus className="size-3.5" />
												Start Research
											</Link>
										</div>
									</div>
								) : (
									<div className="space-y-6">
										{/* Conversations section */}
										{(activeTab === "all" || activeTab === "conversations") && (
											<div>
												{activeTab === "all" && (
													<div className="mb-3 flex items-center justify-between">
														<h2 className="text-[14px] font-semibold text-[#18181B]">
															Research Dossiers ({filteredConversations.length})
														</h2>
													</div>
												)}
												{filteredConversations.length === 0 ? (
													<p className="py-6 text-center text-[13px] text-[#71717A]">
														No dossiers matching &ldquo;{query}&rdquo;
													</p>
												) : (
													<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
														{filteredConversations.map((conv) => (
															<Link
																key={conv.id}
																href={`/?conversation=${encodeURIComponent(conv.id)}`}
																className="group flex flex-col justify-between rounded-xl border border-[#E4E4E7] bg-white p-4 shadow-xs transition hover:border-[#D4D4D8] hover:shadow-sm"
															>
																<div>
																	<div className="flex items-center justify-between gap-2">
																		<span className="flex size-7 items-center justify-center rounded-md bg-[#F4F4F5] text-[#71717A] group-hover:text-[#18181B]">
																			<MessageSquare className="size-3.5" />
																		</span>
																		<span className="flex items-center gap-1 text-[11px] text-[#A1A1AA]">
																			<Clock className="size-3" />
																			{formatRelativeTime(conv.updatedAt || conv.createdAt)}
																		</span>
																	</div>
																	<h3 className="mt-3 line-clamp-2 text-[14px] font-medium text-[#18181B] group-hover:text-[#000000]">
																		{conv.title || "Untitled Investigation"}
																	</h3>
																</div>
																<div className="mt-4 flex items-center justify-between border-t border-[#F4F4F5] pt-3 text-[12px] text-[#71717A]">
																	<span className="font-mono text-[11px] text-[#A1A1AA]">
																		{conv.id.slice(0, 8)}
																	</span>
																	<span className="flex items-center gap-1 font-medium group-hover:text-[#18181B]">
																		Open dossier
																		<ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
																	</span>
																</div>
															</Link>
														))}
													</div>
												)}
											</div>
										)}

										{/* Artifacts section */}
										{(activeTab === "all" || activeTab === "artifacts") && artifacts.length > 0 && (
											<div className="pt-2">
												{activeTab === "all" && (
													<div className="mb-3 flex items-center justify-between">
														<h2 className="text-[14px] font-semibold text-[#18181B]">
															Durable Outputs ({filteredArtifacts.length})
														</h2>
													</div>
												)}
												{filteredArtifacts.length === 0 ? (
													<p className="py-6 text-center text-[13px] text-[#71717A]">
														No outputs matching &ldquo;{query}&rdquo;
													</p>
												) : (
													<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
														{filteredArtifacts.map((art) => (
															<Link
																key={art.id}
																href={`/artifacts?id=${encodeURIComponent(art.id)}`}
																className="group flex flex-col justify-between rounded-xl border border-[#E4E4E7] bg-white p-4 shadow-xs transition hover:border-[#D4D4D8] hover:shadow-sm"
															>
																<div>
																	<div className="flex items-center justify-between gap-2">
																		<span className="flex size-7 items-center justify-center rounded-md bg-[#F4F4F5] text-[#71717A] group-hover:text-[#18181B]">
																			<Layers className="size-3.5" />
																		</span>
																		<span className="rounded bg-[#F4F4F5] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#71717A]">
																			{art.format}
																		</span>
																	</div>
																	<h3 className="mt-3 line-clamp-1 text-[14px] font-medium text-[#18181B] group-hover:text-[#000000]">
																		{art.name}
																	</h3>
																	<p className="mt-0.5 text-[11px] text-[#A1A1AA]">
																		Version {art.currentVersion} • {formatRelativeTime(art.updatedAt)}
																	</p>
																</div>
																<div className="mt-4 flex items-center justify-between border-t border-[#F4F4F5] pt-3 text-[12px] text-[#71717A]">
																	<span className="font-mono text-[11px] text-[#A1A1AA]">
																		{art.id.slice(0, 8)}
																	</span>
																	<span className="flex items-center gap-1 font-medium group-hover:text-[#18181B]">
																		Inspect
																		<ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
																	</span>
																</div>
															</Link>
														))}
													</div>
												)}
											</div>
										)}
									</div>
								)}
							</>
						)}
					</div>
				</main>
			</AiraV2Frame>
		</div>
	);
}
