"use client";

import {
	BarChart3,
	ChevronLeft,
	ChevronRight,
	Clock,
	Copy,
	Download,
	Eye,
	FileCode,
	FileSpreadsheet,
	FileText,
	GitCommit,
	GitFork,
	Layers,
	Play,
	Presentation,
	Search,
	ShieldCheck,
	Table,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { type StoredArtifact, type ArtifactFormat, globalArtifactEngine } from "@/lib/artifacts/engine";

export function ArtifactWorkspace() {
	const [artifacts, setArtifacts] = useState<StoredArtifact[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedVersion, setSelectedVersion] = useState<number>(1);
	const [activeTab, setActiveTab] = useState<"PREVIEW" | "TABLE_STATS" | "PROVENANCE" | "VERSIONS">("PREVIEW");
	const [searchQuery, setSearchQuery] = useState("");
	const [filterFormat, setFilterFormat] = useState<string>("ALL");
	const [slideIndex, setSlideIndex] = useState(0);

	// Load artifacts or seed initial examples
	useEffect(() => {
		const load = async () => {
			try {
				const res = await fetch("/api/artifacts");
				if (res.ok) {
					const data = (await res.json()) as { artifacts: StoredArtifact[] };
					if (data.artifacts && data.artifacts.length > 0) {
						setArtifacts(data.artifacts);
						setSelectedId(data.artifacts[0]!.id);
						setSelectedVersion(data.artifacts[0]!.currentVersion);
						return;
					}
				}
			} catch {
				// Fallback to sample seed artifacts
			}

			// Seed comprehensive multi-format samples for immediate verification
			const sampleReport = globalArtifactEngine.createArtifact({
				userId: "demo_user",
				name: "Q3 AI Market Analysis.md",
				format: "MARKDOWN",
				content: "# Q3 Executive AI Performance & Model Landscape\n\n## Overview\nAIRA autonomous workflows demonstrated a 4.2x latency reduction compared to manual orchestration.\n\n| Model | Latency (ms) | Quality Score | Cost / 1M |\n|---|---|---|---|\n| meta/llama-3.3-70b | 1150 | 92 | $0.70 |\n| meta/llama-3.2-11b | 850 | 86 | $0.35 |\n| deepseek-r1 | 2400 | 95 | $0.55 |\n\n### Recommendation\nRoute latency-sensitive reasoning through 11b vision models with selective escalation to 70b.",
				provenance: {
					runId: "run_sample_1",
					agentRole: "RESEARCH",
					inputChecksum: "sha_sample_1",
					generator: "AIRA Research Swarm",
				},
				tags: ["market-research", "quarterly"],
			});

			const sampleSheet = globalArtifactEngine.createArtifact({
				userId: "demo_user",
				name: "Model Economics.csv",
				format: "CSV",
				content: "Model,Provider,TokensPerSecond,CostPerMillionUsd,ReliabilityPct\nLlama-3.3-70B,NVIDIA,84,0.70,99.9\nLlama-3.2-11B,NVIDIA,142,0.35,99.8\nNemotron-4-340B,NVIDIA,38,1.80,99.5\nOmniRoute-Auto,AIRA,115,0.45,99.99",
				provenance: {
					runId: "run_sample_2",
					parentArtifactId: sampleReport.id,
					agentRole: "DATA_ENGINEER",
					inputChecksum: "sha_sample_2",
					generator: "AIRA Spreadsheet Engine",
				},
				tags: ["economics", "benchmarks"],
			});

			const sampleDeck = globalArtifactEngine.createArtifact({
				userId: "demo_user",
				name: "Autonomous Platform Architecture.pptx",
				format: "PPTX_DECK",
				content: JSON.stringify({
					title: "AIRA Autonomous Platform Architecture",
					slides: [
						{
							title: "The Vision: Outcome-Driven AI",
							bullets: [
								"From prompt-response chats to autonomous deliverable engines",
								"Multi-agent task decomposition with strict budget limits",
								"Cryptographically verifiable evidence chains",
							],
							speakerNotes: "Emphasize why outcomes matter more than raw generation speed.",
						},
						{
							title: "Core System Topology",
							bullets: [
								"Central Tool Gateway with allow/ask/deny permissions",
								"Dynamic Capability Planner selecting specialized models",
								"Automated Quality Verifier running against acceptance criteria",
							],
							speakerNotes: "Highlight how safety boundaries remain enforced centrally.",
						},
					],
				}),
				provenance: {
					runId: "run_sample_3",
					parentArtifactId: sampleSheet.id,
					agentRole: "ARCHITECT",
					inputChecksum: "sha_sample_3",
					generator: "AIRA Presentation Engine",
				},
				tags: ["slides", "architecture"],
			});

			setArtifacts([sampleReport, sampleSheet, sampleDeck]);
			setSelectedId(sampleReport.id);
			setSelectedVersion(sampleReport.currentVersion);
		};

		void load();
	}, []);

	const selectedArtifact = useMemo(
		() => artifacts.find((a) => a.id === selectedId) ?? null,
		[artifacts, selectedId],
	);

	const activeVersionObj = useMemo(
		() => selectedArtifact?.versions.find((v) => v.version === selectedVersion) ?? selectedArtifact?.versions[0] ?? null,
		[selectedArtifact, selectedVersion],
	);

	const filteredArtifacts = useMemo(() => {
		return artifacts.filter((a) => {
			if (filterFormat !== "ALL" && a.format !== filterFormat) return false;
			if (searchQuery && !a.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
			return true;
		});
	}, [artifacts, filterFormat, searchQuery]);

	// Table stats calculation for CSV / JSON (Gate 73)
	const tableData = useMemo(() => {
		if (!activeVersionObj || (selectedArtifact?.format !== "CSV" && selectedArtifact?.format !== "JSON")) return null;
		return globalArtifactEngine.computeTableStats(activeVersionObj.content);
	}, [activeVersionObj, selectedArtifact]);

	// Provenance Lineage calculation (Gate 123)
	const lineage = useMemo(() => {
		if (!selectedArtifact) return [];
		return globalArtifactEngine.getProvenanceLineage("demo_user", selectedArtifact.id);
	}, [selectedArtifact]);

	const handleDownload = () => {
		if (!activeVersionObj || !selectedArtifact) return;
		const blob = new Blob([activeVersionObj.content], { type: selectedArtifact.mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = selectedArtifact.name;
		a.click();
		URL.revokeObjectURL(url);
	};

	// Parse PPTX deck if selected
	const parsedDeck = useMemo(() => {
		if (selectedArtifact?.format !== "PPTX_DECK" || !activeVersionObj) return null;
		try {
			return JSON.parse(activeVersionObj.content) as {
				title: string;
				slides: Array<{ title: string; bullets: string[]; speakerNotes?: string }>;
			};
		} catch {
			return null;
		}
	}, [selectedArtifact, activeVersionObj]);

	return (
		<div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
			{/* Top Header */}
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div className="flex items-center gap-2">
						<h1 className="text-xl font-semibold tracking-tight text-content-primary">Artifact Workspace</h1>
						<span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
							Gate 65 & 66 Certified
						</span>
					</div>
					<p className="text-[13px] text-content-tertiary">
						Inspect, validate, preview, and track the cryptographic provenance of generated deliverables.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
				{/* Left Sidebar: Artifacts Library */}
				<div className="space-y-4 lg:col-span-4">
					<div className="rounded-xl border border-white/[0.08] bg-[#0e1424]/80 p-4 backdrop-blur">
						{/* Search & Filter */}
						<div className="relative">
							<Search className="absolute left-2.5 top-2.5 size-3.5 text-content-tertiary" />
							<input
								type="text"
								placeholder="Search deliverables…"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="w-full rounded-lg border border-white/[0.1] bg-[#090d16] py-1.5 pl-8 pr-3 text-[12px] text-content-primary placeholder-content-tertiary focus:border-amber-400/50 focus:outline-none"
							/>
						</div>

						<div className="mt-3 flex gap-1 overflow-x-auto pb-1 text-[11px]">
							{(["ALL", "MARKDOWN", "CSV", "PPTX_DECK", "HTML"] as const).map((fmt) => (
								<button
									key={fmt}
									type="button"
									onClick={() => setFilterFormat(fmt)}
									className={`rounded px-2 py-0.5 whitespace-nowrap transition ${
										filterFormat === fmt ? "bg-amber-400/20 text-amber-300 font-medium" : "text-content-tertiary hover:text-content-secondary"
									}`}
								>
									{fmt}
								</button>
							))}
						</div>

						{/* Artifact List */}
						<div className="mt-3 space-y-1.5">
							{filteredArtifacts.map((art) => {
								const isSelected = art.id === selectedId;
								return (
									<button
										key={art.id}
										type="button"
										onClick={() => {
											setSelectedId(art.id);
											setSelectedVersion(art.currentVersion);
										}}
										className={`w-full rounded-lg border p-2.5 text-left transition ${
											isSelected
												? "border-amber-400/40 bg-amber-400/[0.08]"
												: "border-white/[0.05] bg-[#090d16]/50 hover:border-white/[0.1] hover:bg-[#090d16]"
										}`}
									>
										<div className="flex items-center justify-between">
											<span className="truncate text-[12px] font-medium text-content-primary">
												{art.name}
											</span>
											<span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-content-tertiary">
												v{art.currentVersion}
											</span>
										</div>
										<div className="mt-1 flex items-center gap-2 text-[10px] text-content-tertiary">
											<span>{art.format}</span>
											<span>·</span>
											<span>{art.tags.join(", ") || "deliverable"}</span>
										</div>
									</button>
								);
							})}
						</div>
					</div>
				</div>

				{/* Right Panel: Interactive Viewer & Workspaces */}
				<div className="space-y-4 lg:col-span-8">
					{selectedArtifact && activeVersionObj ? (
						<div className="rounded-xl border border-white/[0.08] bg-[#0e1424]/90 p-5 shadow-sm backdrop-blur">
							{/* Artifact Control Bar */}
							<div className="flex flex-col gap-3 border-b border-white/[0.08] pb-4 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<div className="flex items-center gap-2">
										<h2 className="text-[14px] font-semibold text-content-primary">{selectedArtifact.name}</h2>
										<span className="rounded bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
											Score: {activeVersionObj.validation.score}/100
										</span>
									</div>
									<p className="text-[11px] text-content-tertiary">
										Generated by {activeVersionObj.provenance.generator} · {activeVersionObj.sizeBytes} bytes
									</p>
								</div>

								{/* Navigation Tabs */}
								<div className="flex items-center gap-1 rounded-lg border border-white/[0.1] bg-[#090d16] p-1 text-[11px]">
									<button
										type="button"
										onClick={() => setActiveTab("PREVIEW")}
										className={`rounded px-2.5 py-1 transition ${activeTab === "PREVIEW" ? "bg-amber-400/20 text-amber-300 font-medium" : "text-content-tertiary hover:text-content-primary"}`}
									>
										Preview
									</button>
									{(selectedArtifact.format === "CSV" || selectedArtifact.format === "JSON") && (
										<button
											type="button"
											onClick={() => setActiveTab("TABLE_STATS")}
											className={`rounded px-2.5 py-1 transition ${activeTab === "TABLE_STATS" ? "bg-amber-400/20 text-amber-300 font-medium" : "text-content-tertiary hover:text-content-primary"}`}
										>
											Table Stats
										</button>
									)}
									<button
										type="button"
										onClick={() => setActiveTab("PROVENANCE")}
										className={`rounded px-2.5 py-1 transition ${activeTab === "PROVENANCE" ? "bg-amber-400/20 text-amber-300 font-medium" : "text-content-tertiary hover:text-content-primary"}`}
									>
										Lineage Graph
									</button>
									<button
										type="button"
										onClick={() => setActiveTab("VERSIONS")}
										className={`rounded px-2.5 py-1 transition ${activeTab === "VERSIONS" ? "bg-amber-400/20 text-amber-300 font-medium" : "text-content-tertiary hover:text-content-primary"}`}
									>
										Versions ({selectedArtifact.versions.length})
									</button>
								</div>

								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={handleDownload}
										className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-[11px] font-medium text-content-primary transition hover:bg-white/[0.1]"
									>
										<Download className="size-3" /> Download
									</button>
								</div>
							</div>

							{/* Main Tab Content */}
							<div className="mt-4">
								{/* 1. PREVIEW TAB */}
								{activeTab === "PREVIEW" && (
									<div>
										{selectedArtifact.format === "MARKDOWN" && (
											<div className="prose prose-invert max-w-none text-[13px] leading-relaxed">
												<ReactMarkdown remarkPlugins={[remarkGfm]}>
													{activeVersionObj.content}
												</ReactMarkdown>
											</div>
										)}

										{selectedArtifact.format === "CSV" && tableData && (
											<div className="overflow-x-auto">
												<table className="w-full text-left text-[11px]">
													<thead className="border-b border-white/[0.1] text-content-tertiary">
														<tr>
															{tableData.columns.map((c) => (
																<th key={c} className="p-2 font-medium">
																	{c}
																</th>
															))}
														</tr>
													</thead>
													<tbody className="divide-y divide-white/[0.05]">
														{activeVersionObj.content
															.trim()
															.split(/\r?\n/)
															.slice(1)
															.map((line, idx) => (
																<tr key={idx} className="hover:bg-white/[0.02]">
																	{line.split(",").map((val, cIdx) => (
																		<td key={cIdx} className="p-2 text-content-secondary">
																			{val.trim()}
																		</td>
																	))}
																</tr>
															))}
													</tbody>
												</table>
											</div>
										)}

										{selectedArtifact.format === "PPTX_DECK" && parsedDeck && (
											<div className="space-y-4">
												{/* Slide Carousel */}
												<div className="flex min-h-64 flex-col justify-between rounded-xl border border-white/[0.1] bg-[#090d16] p-6">
													<div>
														<div className="flex items-center justify-between text-[11px] text-content-tertiary">
															<span>{parsedDeck.title}</span>
															<span>
																Slide {slideIndex + 1} of {parsedDeck.slides.length}
															</span>
														</div>
														<h3 className="mt-4 text-lg font-semibold text-content-primary">
															{parsedDeck.slides[slideIndex]?.title}
														</h3>
														<ul className="mt-4 space-y-2 text-[13px] text-content-secondary">
															{parsedDeck.slides[slideIndex]?.bullets.map((b, i) => (
																<li key={i} className="flex items-start gap-2">
																	<span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
																	<span>{b}</span>
																</li>
															))}
														</ul>
													</div>

													{parsedDeck.slides[slideIndex]?.speakerNotes && (
														<div className="mt-6 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-content-tertiary">
															<strong className="block text-content-secondary">Speaker Notes:</strong>
															{parsedDeck.slides[slideIndex]?.speakerNotes}
														</div>
													)}
												</div>

												<div className="flex items-center justify-between">
													<button
														type="button"
														disabled={slideIndex === 0}
														onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
														className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] px-3 py-1.5 text-[11px] text-content-secondary disabled:opacity-30"
													>
														<ChevronLeft className="size-3.5" /> Previous Slide
													</button>
													<button
														type="button"
														disabled={slideIndex === parsedDeck.slides.length - 1}
														onClick={() => setSlideIndex((i) => Math.min(parsedDeck.slides.length - 1, i + 1))}
														className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] px-3 py-1.5 text-[11px] text-content-secondary disabled:opacity-30"
													>
														Next Slide <ChevronRight className="size-3.5" />
													</button>
												</div>
											</div>
										)}
									</div>
								)}

								{/* 2. TABLE STATS TAB (Gate 73) */}
								{activeTab === "TABLE_STATS" && tableData && (
									<div className="space-y-4">
										<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
											<div className="rounded-lg border border-white/[0.08] bg-[#090d16] p-3">
												<span className="text-[10px] text-content-tertiary">Total Rows</span>
												<p className="mt-0.5 text-base font-semibold text-content-primary">
													{tableData.rowCount}
												</p>
											</div>
											<div className="rounded-lg border border-white/[0.08] bg-[#090d16] p-3">
												<span className="text-[10px] text-content-tertiary">Total Columns</span>
												<p className="mt-0.5 text-base font-semibold text-content-primary">
													{tableData.columns.length}
												</p>
											</div>
										</div>

										<h4 className="text-[12px] font-semibold text-content-primary">Column Metrics & Statistics</h4>
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											{tableData.columns.map((col) => {
												const stat = tableData.stats[col];
												return (
													<div
														key={col}
														className="rounded-lg border border-white/[0.06] bg-[#090d16] p-3 text-[11px]"
													>
														<div className="flex items-center justify-between font-medium text-content-primary">
															<span>{col}</span>
															<span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-amber-300">
																{stat?.isNumeric ? "Numeric" : "Categorical"}
															</span>
														</div>
														<div className="mt-2 space-y-1 text-content-tertiary">
															<div>Distinct Values: {stat?.distinct}</div>
															{stat?.isNumeric && (
																<>
																	<div>Sum: {stat.sum?.toFixed(2)}</div>
																	<div>Mean: {stat.avg?.toFixed(2)}</div>
																</>
															)}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								)}

								{/* 3. PROVENANCE LINEAGE TAB (Gate 123) */}
								{activeTab === "PROVENANCE" && (
									<div className="space-y-4">
										<h4 className="text-[12px] font-semibold text-content-primary">
											Cryptographic Provenance Lineage Graph
										</h4>
										<div className="space-y-3">
											{lineage.map((node, index) => (
												<div
													key={node.artifactId}
													className="relative rounded-lg border border-white/[0.08] bg-[#090d16] p-3.5 text-[12px]"
												>
													<div className="flex items-center justify-between">
														<span className="font-semibold text-content-primary">{node.name}</span>
														<span className="rounded bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
															v{node.version}
														</span>
													</div>
													<div className="mt-2 grid grid-cols-1 gap-1 text-[10px] text-content-tertiary sm:grid-cols-2">
														<div>Generator: {node.generator}</div>
														<div>Generated: {new Date(node.generatedAt).toLocaleTimeString()}</div>
														<div className="truncate font-mono sm:col-span-2">SHA-256: {node.checksum}</div>
													</div>
												</div>
											))}
										</div>
									</div>
								)}

								{/* 4. VERSIONS TAB */}
								{activeTab === "VERSIONS" && (
									<div className="space-y-2">
										{selectedArtifact.versions.map((v) => (
											<button
												key={v.version}
												type="button"
												onClick={() => setSelectedVersion(v.version)}
												className={`flex w-full items-center justify-between rounded-lg border p-3 text-left text-[12px] transition ${
													v.version === selectedVersion
														? "border-amber-400/30 bg-amber-400/10"
														: "border-white/[0.06] bg-[#090d16] hover:bg-white/[0.04]"
												}`}
											>
												<div>
													<span className="font-semibold text-content-primary">Version {v.version}</span>
													<p className="mt-0.5 text-[10px] text-content-tertiary">
														{new Date(v.createdAt).toLocaleString()} · {v.sizeBytes} bytes
													</p>
												</div>
												<span className="font-mono text-[10px] text-content-tertiary">
													{v.checksum.substring(0, 12)}…
												</span>
											</button>
										))}
									</div>
								)}
							</div>
						</div>
					) : (
						<div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] p-6 text-center text-content-tertiary">
							<Layers className="size-8 text-content-tertiary/40" />
							<p className="mt-2 text-[12px]">Select an artifact from the library to inspect.</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
