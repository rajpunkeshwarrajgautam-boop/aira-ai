"use client";

import {
	ArrowRight,
	Bot,
	Boxes,
	CheckCircle2,
	Compass,
	Copy,
	FileText,
	GitBranch,
	History,
	LayoutTemplate,
	Loader2,
	Play,
	Plus,
	RefreshCw,
	Search,
	Sparkles,
	Workflow,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

interface WorkflowNode {
	readonly id: string;
	readonly type: string;
	readonly name: string;
}

interface WorkflowEdge {
	readonly id: string;
	readonly sourceNodeId: string;
	readonly targetNodeId: string;
}

interface DagTemplate {
	readonly id: string;
	readonly name: string;
	readonly version: number;
	readonly description: string;
	readonly nodes: readonly WorkflowNode[];
	readonly edges: readonly WorkflowEdge[];
}

interface ResearchRecipe {
	readonly id: string;
	readonly title: string;
	readonly category: string;
	readonly description: string;
	readonly prompt: string;
	readonly mode: "auto" | "deep" | "smart" | "fast";
}

const RESEARCH_RECIPES: readonly ResearchRecipe[] = [
	{
		id: "recipe-deep-due-diligence",
		title: "Deep Technical Due Diligence",
		category: "Research",
		description: "Multi-hop verification of architecture claims, dependencies, benchmark veracity, and security boundaries.",
		prompt: "Conduct a rigorous technical due diligence on: [Subject]. Triangulate primary claims against independent verification and architectural constraints.",
		mode: "deep",
	},
	{
		id: "recipe-frontier-energy",
		title: "Frontier Energy & Compute Synthesis",
		category: "Frontier",
		description: "Analyze power grid constraints, geothermal and nuclear co-location, and datacenter scaling curves.",
		prompt: "Analyze the current constraints and tradeoffs between geothermal, SMR nuclear, and gigawatt-scale compute clustering for next-generation AI data centers.",
		mode: "smart",
	},
	{
		id: "recipe-sovereign-ai",
		title: "Sovereign AI Infrastructure Audit",
		category: "Architecture",
		description: "Executive evaluation of on-premises models, row-level tenant security, and air-gapped governance.",
		prompt: "Outline a complete sovereign AI deployment blueprint enforcing row-level security, encrypted local weights, and zero data leakage.",
		mode: "deep",
	},
	{
		id: "recipe-test-time-compute",
		title: "Test-Time Reasoning & Latency Tradeoffs",
		category: "Research",
		description: "Evaluate test-time compute scaling, tree-search rollouts, and standard inference economics.",
		prompt: "Compare test-time search and verification scaling versus standard pretraining scaling in modern reasoning models. Include latency and cost implications.",
		mode: "smart",
	},
];

export default function TemplatesPage() {
	const router = useRouter();
	const [dagTemplates, setDagTemplates] = useState<DagTemplate[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [query, setQuery] = useState("");
	const [activeCategory, setActiveCategory] = useState<"all" | "workflows" | "recipes">("all");
	const [copiedRecipeId, setCopiedRecipeId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const loadTemplates = useCallback(async (isRefresh = false) => {
		if (isRefresh) setRefreshing(true);
		else setLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/automation/routines", { cache: "no-store" });
			if (res.status === 401) {
				router.replace(`/signin?callbackUrl=${encodeURIComponent("/templates")}`);
				return;
			}
			if (!res.ok) {
				throw new Error("Could not load automation templates.");
			}
			const data = (await res.json()) as { templates?: DagTemplate[] };
			setDagTemplates(data.templates ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load templates.");
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, [router]);

	useEffect(() => {
		void loadTemplates();
	}, [loadTemplates]);

	const copyRecipe = (recipe: ResearchRecipe) => {
		void navigator.clipboard.writeText(recipe.prompt);
		setCopiedRecipeId(recipe.id);
		setTimeout(() => setCopiedRecipeId(null), 2000);
	};

	const filteredDags = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return dagTemplates;
		return dagTemplates.filter(
			(t) =>
				t.name.toLowerCase().includes(q) ||
				t.description.toLowerCase().includes(q) ||
				t.nodes.some((n) => n.name.toLowerCase().includes(q)),
		);
	}, [dagTemplates, query]);

	const filteredRecipes = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return RESEARCH_RECIPES;
		return RESEARCH_RECIPES.filter(
			(r) =>
				r.title.toLowerCase().includes(q) ||
				r.description.toLowerCase().includes(q) ||
				r.category.toLowerCase().includes(q),
		);
	}, [query]);

	const totalCount = dagTemplates.length + RESEARCH_RECIPES.length;

	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<main className="min-h-[calc(100dvh-72px)] bg-[#FAFAFA] px-4 py-8 sm:px-6 md:px-8">
					<div className="mx-auto max-w-[1280px]">
						{/* Header */}
						<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<div className="flex items-center gap-2 text-[12px] font-semibold tracking-wider text-[#71717A] uppercase">
									<LayoutTemplate className="size-3.5 text-[#18181B]" aria-hidden />
									<span>Template Gallery</span>
								</div>
								<h1 className="mt-1 text-2xl font-bold tracking-tight text-[#18181B] sm:text-3xl">
									Verified Templates & Routines
								</h1>
								<p className="mt-1 text-[13px] text-[#71717A]">
									Pre-configured automation DAGs, multi-agent pipelines, and high-impact research recipes.
								</p>
							</div>

							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => void loadTemplates(true)}
									disabled={loading || refreshing}
									aria-label="Refresh templates"
									className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E4E4E7] bg-white px-3 text-[13px] font-medium text-[#27272A] shadow-xs transition hover:bg-[#F4F4F5] disabled:opacity-50"
								>
									<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
									<span className="hidden sm:inline">Refresh</span>
								</button>
								<Link
									href="/workflows"
									className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#18181B] px-3.5 text-[13px] font-medium text-white shadow-xs transition hover:bg-[#27272A]"
								>
									<Workflow className="size-3.5" />
									<span>Workflow Builder</span>
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
									placeholder="Search templates, recipes, and automation routines…"
									className="h-9 w-full rounded-lg border border-transparent bg-[#F4F4F5] pl-9 pr-3 text-[13px] text-[#18181B] outline-none placeholder:text-[#A1A1AA] focus:border-[#D4D4D8] focus:bg-white"
								/>
							</div>

							<div className="flex items-center gap-1 border-t border-[#F4F4F5] pt-2 sm:border-t-0 sm:pt-0">
								<button
									type="button"
									onClick={() => setActiveCategory("all")}
									className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
										activeCategory === "all"
											? "bg-[#18181B] text-white"
											: "text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#18181B]"
									}`}
								>
									All ({totalCount})
								</button>
								<button
									type="button"
									onClick={() => setActiveCategory("workflows")}
									className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
										activeCategory === "workflows"
											? "bg-[#18181B] text-white"
											: "text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#18181B]"
									}`}
								>
									Automation DAGs ({dagTemplates.length})
								</button>
								<button
									type="button"
									onClick={() => setActiveCategory("recipes")}
									className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
										activeCategory === "recipes"
											? "bg-[#18181B] text-white"
											: "text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#18181B]"
									}`}
								>
									Research Recipes ({RESEARCH_RECIPES.length})
								</button>
							</div>
						</div>

						{/* Error Alert */}
						{error ? (
							<div className="mb-6 rounded-xl border border-red-200 bg-red-50/60 p-4 text-[13px] text-red-700">
								{error}
							</div>
						) : null}

						{/* Loading skeleton */}
						{loading ? (
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{[...Array(6)].map((_, i) => (
									<div
										key={i}
										className="h-44 animate-pulse rounded-xl border border-[#E4E4E7] bg-white p-5"
									/>
								))}
							</div>
						) : null}

						{/* Content */}
						{!loading && (
							<div className="space-y-8">
								{/* Automation DAG Templates */}
								{(activeCategory === "all" || activeCategory === "workflows") && (
									<div>
										<div className="mb-4 flex items-center justify-between">
											<div>
												<h2 className="text-[15px] font-semibold text-[#18181B]">
													Autonomous Workflow DAGs ({filteredDags.length})
												</h2>
												<p className="text-[12px] text-[#71717A]">
													Durable multi-step pipelines executable with persistent status and provenance.
												</p>
											</div>
										</div>

										{filteredDags.length === 0 ? (
											<div className="rounded-xl border border-dashed border-[#E4E4E7] bg-white p-8 text-center text-[13px] text-[#71717A]">
												No automation templates matching &ldquo;{query}&rdquo;
											</div>
										) : (
											<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
												{filteredDags.map((tpl) => (
													<div
														key={tpl.id}
														className="flex flex-col justify-between rounded-xl border border-[#E4E4E7] bg-white p-5 shadow-xs transition hover:border-[#D4D4D8] hover:shadow-sm"
													>
														<div>
															<div className="flex items-center justify-between gap-2">
																<span className="flex size-7 items-center justify-center rounded-md bg-[#F4F4F5] text-[#18181B]">
																	<Workflow className="size-3.5" />
																</span>
																<span className="rounded bg-[#F4F4F5] px-2 py-0.5 text-[11px] font-medium text-[#71717A]">
																	{tpl.nodes.length} nodes • v{tpl.version}
																</span>
															</div>

															<h3 className="mt-3 text-[14px] font-semibold text-[#18181B]">
																{tpl.name}
															</h3>
															<p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[#71717A]">
																{tpl.description}
															</p>

															{/* Steps preview */}
															<div className="mt-4 flex flex-wrap gap-1.5">
																{tpl.nodes.slice(0, 3).map((node) => (
																	<span
																		key={node.id}
																		className="inline-flex items-center gap-1 rounded bg-[#F4F4F5] px-2 py-0.5 text-[10px] font-medium text-[#52525B]"
																	>
																		<Zap className="size-2.5" />
																		{node.name}
																	</span>
																))}
																{tpl.nodes.length > 3 && (
																	<span className="rounded bg-[#F4F4F5] px-1.5 py-0.5 text-[10px] text-[#71717A]">
																		+{tpl.nodes.length - 3} more
																	</span>
																)}
															</div>
														</div>

														<div className="mt-5 border-t border-[#F4F4F5] pt-4">
															<Link
																href={`/workflows?template=${encodeURIComponent(tpl.id)}`}
																className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#E4E4E7] bg-white py-2 text-[12px] font-medium text-[#18181B] shadow-2xs transition hover:bg-[#F4F4F5]"
															>
																<span>Launch in Workflows</span>
																<ArrowRight className="size-3.5" />
															</Link>
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								)}

								{/* Research Recipes */}
								{(activeCategory === "all" || activeCategory === "recipes") && (
									<div>
										<div className="mb-4 flex items-center justify-between">
											<div>
												<h2 className="text-[15px] font-semibold text-[#18181B]">
													Grounded Research Recipes ({filteredRecipes.length})
												</h2>
												<p className="text-[12px] text-[#71717A]">
													Validated investigation templates configured for AIRA&apos;s multi-neural reasoning engine.
												</p>
											</div>
										</div>

										{filteredRecipes.length === 0 ? (
											<div className="rounded-xl border border-dashed border-[#E4E4E7] bg-white p-8 text-center text-[13px] text-[#71717A]">
												No research recipes matching &ldquo;{query}&rdquo;
											</div>
										) : (
											<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
												{filteredRecipes.map((recipe) => (
													<div
														key={recipe.id}
														className="flex flex-col justify-between rounded-xl border border-[#E4E4E7] bg-white p-5 shadow-xs transition hover:border-[#D4D4D8] hover:shadow-sm"
													>
														<div>
															<div className="flex items-center justify-between gap-2">
																<span className="rounded bg-[#F4F4F5] px-2 py-0.5 text-[11px] font-medium text-[#71717A]">
																	{recipe.category}
																</span>
																<span className="rounded bg-[#F4F4F5] px-2 py-0.5 font-mono text-[10px] uppercase text-[#71717A]">
																	Mode: {recipe.mode}
																</span>
															</div>

															<h3 className="mt-3 text-[14px] font-semibold text-[#18181B]">
																{recipe.title}
															</h3>
															<p className="mt-1 text-[12px] leading-relaxed text-[#71717A]">
																{recipe.description}
															</p>

															<div className="mt-3 rounded-lg border border-[#F4F4F5] bg-[#FAFAFA] p-3 text-[12px] font-mono text-[#52525B]">
																{recipe.prompt}
															</div>
														</div>

														<div className="mt-4 flex items-center justify-between border-t border-[#F4F4F5] pt-3">
															<button
																type="button"
																onClick={() => copyRecipe(recipe)}
																className="inline-flex items-center gap-1 text-[12px] font-medium text-[#71717A] hover:text-[#18181B]"
															>
																{copiedRecipeId === recipe.id ? (
																	<>
																		<CheckCircle2 className="size-3.5 text-emerald-600" />
																		<span className="text-emerald-600">Copied</span>
																	</>
																) : (
																	<>
																		<Copy className="size-3.5" />
																		<span>Copy Prompt</span>
																	</>
																)}
															</button>

															<Link
																href={`/?prompt=${encodeURIComponent(recipe.prompt)}&mode=${recipe.mode}`}
																className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#18181B] hover:underline"
															>
																<span>Run in Research</span>
																<ArrowRight className="size-3.5" />
															</Link>
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				</main>
			</AiraV2Frame>
		</div>
	);
}
