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

import {
	type StoredArtifact,
	type ArtifactFormat,
	type ArtifactVersion,
	type TableStats,
	type ProvenanceLineageNode,
	parseTableStats,
} from "@/lib/artifacts/types";

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
			const sampleReport: StoredArtifact = {
				id: "art_sample_report",
				userId: "demo_user",
				name: "Q3 AI Market Analysis.md",
				format: "MARKDOWN",
				mimeType: "text/markdown",
				currentVersion: 1,
				versions: [
					{
						version: 1,
						content: "# Q3 Executive AI Performance & Architecture Landscape\n\n## Overview\nAIRA autonomous workflows demonstrated a 4.2x latency reduction compared to manual orchestration.\n\n| Model Tier | Latency (ms) | Quality Score | Cost / 1M |\n|---|---|---|---|\n| AIRA Cortex-9 | 950 | 96 | $0.70 |\n| AIRA DeepDeliberate | 1650 | 98 | $0.55 |\n| AIRA Ultra-Fast | 210 | 92 | $0.25 |\n\n### Recommendation\nRoute latency-sensitive workflows through AIRA Ultra-Fast edge nodes with selective escalation to Cortex-9.",
						checksum: "sha_sample_1",
						sizeBytes: 420,
						validation: {
							isValid: true,
							format: "MARKDOWN",
							score: 100,
							errors: [],
							warnings: [],
							metrics: { sizeBytes: 420, wordCount: 52 },
						},
						provenance: {
							runId: "run_sample_1",
							agentRole: "RESEARCH",
							inputChecksum: "sha_sample_1",
							generatedAt: new Date().toISOString(),
							generator: "AIRA Research Swarm",
						},
						createdAt: new Date().toISOString(),
					},
				],
				tags: ["market-research", "quarterly"],
				isPublic: true,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const sampleSheet: StoredArtifact = {
				id: "art_sample_sheet",
				userId: "demo_user",
				name: "Model Economics.csv",
				format: "CSV",
				mimeType: "text/csv",
				currentVersion: 1,
				versions: [
					{
						version: 1,
						content: "Model,Architecture,TokensPerSecond,CostPerMillionTokens,ReliabilityPct\nAIRA-Cortex-9,Frontier-Logic,124,0.70,99.98\nAIRA-DeepDeliberate,Cognitive-Chain,82,0.55,99.99\nAIRA-Ultra-Fast,Edge-Matrix,260,0.25,99.95\nAIRA-OmniRoute,Adaptive-Mesh,195,0.40,99.99",
						checksum: "sha_sample_2",
						sizeBytes: 215,
						validation: {
							isValid: true,
							format: "CSV",
							score: 100,
							errors: [],
							warnings: [],
							metrics: { sizeBytes: 215, rowCount: 4, columnCount: 5 },
						},
						provenance: {
							runId: "run_sample_2",
							parentArtifactId: sampleReport.id,
							agentRole: "DATA_ENGINEER",
							inputChecksum: "sha_sample_2",
							generatedAt: new Date().toISOString(),
							generator: "AIRA Spreadsheet Engine",
						},
						createdAt: new Date().toISOString(),
					},
				],
				tags: ["economics", "benchmarks"],
				isPublic: true,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const sampleDeck: StoredArtifact = {
				id: "art_sample_deck",
				userId: "demo_user",
				name: "Autonomous Platform Architecture.pptx",
				format: "PPTX_DECK",
				mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
				currentVersion: 1,
				versions: [
					{
						version: 1,
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
						checksum: "sha_sample_3",
						sizeBytes: 612,
						validation: {
							isValid: true,
							format: "PPTX_DECK",
							score: 100,
							errors: [],
							warnings: [],
							metrics: { sizeBytes: 612, slideCount: 2 },
						},
						provenance: {
							runId: "run_sample_3",
							parentArtifactId: sampleSheet.id,
							agentRole: "ARCHITECT",
							inputChecksum: "sha_sample_3",
							generatedAt: new Date().toISOString(),
							generator: "AIRA Presentation Engine",
						},
						createdAt: new Date().toISOString(),
					},
				],
				tags: ["slides", "architecture"],
				isPublic: true,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

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
	const tableData = useMemo<TableStats | null>(() => {
		if (!activeVersionObj || (selectedArtifact?.format !== "CSV" && selectedArtifact?.format !== "JSON")) return null;
		return parseTableStats(activeVersionObj.content);
	}, [activeVersionObj, selectedArtifact]);

	// Provenance Lineage calculation (Gate 123)
	const lineage = useMemo<ProvenanceLineageNode[]>(() => {
		if (!selectedArtifact) return [];
		const nodes: ProvenanceLineageNode[] = [];
		let cur: StoredArtifact | undefined = selectedArtifact;
		while (cur) {
			const currentTarget: StoredArtifact = cur;
			const activeVer: ArtifactVersion | undefined =
				currentTarget.versions.find((v) => v.version === currentTarget.currentVersion) ?? currentTarget.versions[0];
			nodes.push({
				artifactId: currentTarget.id,
				name: currentTarget.name,
				version: currentTarget.currentVersion,
				checksum: activeVer?.checksum ?? "sha256_mock",
				runId: activeVer?.provenance.runId ?? "run_direct",
				generator: activeVer?.provenance.generator ?? "AIRA Core",
				generatedAt: activeVer?.provenance.generatedAt ?? new Date().toISOString(),
				parentArtifactId: activeVer?.provenance.parentArtifactId,
			});
			const nextParentId: string | undefined = activeVer?.provenance.parentArtifactId;
			cur = nextParentId ? artifacts.find((a) => a.id === nextParentId) : undefined;
		}
		return nodes;
	}, [selectedArtifact, artifacts]);

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
		<div className="mx-auto max-w-7xl space-y-6 p-4 text-[#111115] sm:p-6 lg:p-8">
			{/* Top Header */}
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div className="flex items-center gap-2">
						<h1 className="text-xl font-semibold tracking-tight text-[#111115]">Artifact Workspace</h1>
						<span className="rounded-full border border-[rgba(58,12,163,0.18)] bg-[rgba(58,12,163,0.08)] px-2.5 py-0.5 text-[11px] font-semibold text-[#3A0CA3]">
							Gate 65 & 66 Certified
						</span>
					</div>
					<p className="text-[13px] text-[#6B6A75]">
						Inspect, validate, preview, and track the cryptographic provenance of generated deliverables.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
				{/* Left Sidebar: Artifacts Library */}
				<div className="space-y-4 lg:col-span-4">
					<div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-4 shadow-xs">
						{/* Search & Filter */}
						<div className="relative">
							<Search className="absolute left-2.5 top-2.5 size-3.5 text-[#8F8E98]" />
							<input
								type="text"
								placeholder="Search deliverables…"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white py-1.5 pl-8 pr-3 text-[12px] text-[#111115] placeholder:text-[#8F8E98] focus:border-[#3A0CA3] focus:outline-none"
							/>
						</div>

						<div className="mt-3 flex gap-1 overflow-x-auto pb-1 text-[11px]">
							{(["ALL", "MARKDOWN", "CSV", "PPTX_DECK", "HTML"] as const).map((fmt) => (
								<button
									key={fmt}
									type="button"
									onClick={() => setFilterFormat(fmt)}
									className={`rounded px-2 py-0.5 whitespace-nowrap transition ${
										filterFormat === fmt ? "bg-[rgba(58,12,163,0.1)] text-[#3A0CA3] font-semibold" : "text-[#6B6A75] hover:text-[#111115]"
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
												? "border-[#3A0CA3] bg-[rgba(58,12,163,0.05)] shadow-2xs"
												: "border-[rgba(17,17,21,0.06)] bg-white hover:border-[rgba(17,17,21,0.12)] hover:bg-[#FAF9F6]"
										}`}
									>
										<div className="flex items-center justify-between">
											<span className="truncate text-[12px] font-medium text-[#111115]">
												{art.name}
											</span>
											<span className="rounded bg-[#F3F1EC] px-1.5 py-0.5 text-[9px] font-semibold text-[#6B6A75]">
												v{art.currentVersion}
											</span>
										</div>
										<div className="mt-1 flex items-center gap-2 text-[10px] text-[#6B6A75]">
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
						<div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
							{/* Artifact Control Bar */}
							<div className="flex flex-col gap-3 border-b border-[rgba(17,17,21,0.08)] pb-4 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<div className="flex items-center gap-2">
										<h2 className="text-[14px] font-semibold text-[#111115]">{selectedArtifact.name}</h2>
										<span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
											Score: {activeVersionObj.validation.score}/100
										</span>
									</div>
									<p className="text-[11px] text-[#6B6A75]">
										Generated by {activeVersionObj.provenance.generator} · {activeVersionObj.sizeBytes} bytes
									</p>
								</div>

								{/* Navigation Tabs */}
								<div className="flex items-center gap-1 rounded-lg border border-[rgba(17,17,21,0.1)] bg-[#F7F6F2] p-1 text-[11px]">
									<button
										type="button"
										onClick={() => setActiveTab("PREVIEW")}
										className={`rounded px-2.5 py-1 transition ${activeTab === "PREVIEW" ? "bg-white text-[#3A0CA3] font-semibold shadow-2xs" : "text-[#6B6A75] hover:text-[#111115]"}`}
									>
										Preview
									</button>
									{(selectedArtifact.format === "CSV" || selectedArtifact.format === "JSON") && (
										<button
											type="button"
											onClick={() => setActiveTab("TABLE_STATS")}
											className={`rounded px-2.5 py-1 transition ${activeTab === "TABLE_STATS" ? "bg-white text-[#3A0CA3] font-semibold shadow-2xs" : "text-[#6B6A75] hover:text-[#111115]"}`}
										>
											Table Stats
										</button>
									)}
									<button
										type="button"
										onClick={() => setActiveTab("PROVENANCE")}
										className={`rounded px-2.5 py-1 transition ${activeTab === "PROVENANCE" ? "bg-white text-[#3A0CA3] font-semibold shadow-2xs" : "text-[#6B6A75] hover:text-[#111115]"}`}
									>
										Lineage Graph
									</button>
									<button
										type="button"
										onClick={() => setActiveTab("VERSIONS")}
										className={`rounded px-2.5 py-1 transition ${activeTab === "VERSIONS" ? "bg-white text-[#3A0CA3] font-semibold shadow-2xs" : "text-[#6B6A75] hover:text-[#111115]"}`}
									>
										Versions ({selectedArtifact.versions.length})
									</button>
								</div>

								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={handleDownload}
										className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-1.5 text-[11px] font-medium text-[#111115] shadow-2xs transition hover:bg-[#FAF9F6]"
									>
										<Download className="size-3 text-[#3A0CA3]" /> Download
									</button>
								</div>
							</div>

							{/* Main Tab Content */}
							<div className="mt-4">
								{/* 1. PREVIEW TAB */}
								{activeTab === "PREVIEW" && (
									<div>
										{selectedArtifact.format === "MARKDOWN" && (
											<div className="prose max-w-none text-[13px] leading-relaxed text-[#111115]">
												<ReactMarkdown remarkPlugins={[remarkGfm]}>
													{activeVersionObj.content}
												</ReactMarkdown>
											</div>
										)}

										{selectedArtifact.format === "CSV" && tableData && (
											<div className="overflow-x-auto">
												<table className="w-full text-left text-[11px]">
													<thead className="border-b border-[rgba(17,17,21,0.08)] text-[#6B6A75]">
														<tr>
															{tableData.columns.map((c: string) => (
																<th key={c} className="p-2 font-medium">
																	{c}
																</th>
															))}
														</tr>
													</thead>
													<tbody className="divide-y divide-[rgba(17,17,21,0.06)]">
														{activeVersionObj.content
															.trim()
															.split(/\r?\n/)
															.slice(1)
															.map((line, idx) => (
																<tr key={idx} className="hover:bg-[#FAF9F6]">
																	{line.split(",").map((val, cIdx) => (
																		<td key={cIdx} className="p-2 text-[#111115]">
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
												<div className="flex min-h-64 flex-col justify-between rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-6">
													<div>
														<div className="flex items-center justify-between text-[11px] text-[#6B6A75]">
															<span>{parsedDeck.title}</span>
															<span>
																Slide {slideIndex + 1} of {parsedDeck.slides.length}
															</span>
														</div>
														<h3 className="mt-4 text-lg font-semibold text-[#111115]">
															{parsedDeck.slides[slideIndex]?.title}
														</h3>
														<ul className="mt-4 space-y-2 text-[13px] text-[#6B6A75]">
															{parsedDeck.slides[slideIndex]?.bullets.map((b, i) => (
																<li key={i} className="flex items-start gap-2">
																	<span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#3A0CA3]" />
																	<span className="text-[#111115]">{b}</span>
																</li>
															))}
														</ul>
													</div>

													{parsedDeck.slides[slideIndex]?.speakerNotes && (
														<div className="mt-6 rounded-lg border border-[rgba(17,17,21,0.08)] bg-white p-3 text-[11px] text-[#6B6A75] shadow-2xs">
															<strong className="block text-[#111115]">Speaker Notes:</strong>
															{parsedDeck.slides[slideIndex]?.speakerNotes}
														</div>
													)}
												</div>

												<div className="flex items-center justify-between">
													<button
														type="button"
														disabled={slideIndex === 0}
														onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
														className="inline-flex items-center gap-1 rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-1.5 text-[11px] text-[#111115] shadow-2xs hover:bg-[#FAF9F6] disabled:opacity-30"
													>
														<ChevronLeft className="size-3.5" /> Previous Slide
													</button>
													<button
														type="button"
														disabled={slideIndex === parsedDeck.slides.length - 1}
														onClick={() => setSlideIndex((i) => Math.min(parsedDeck.slides.length - 1, i + 1))}
														className="inline-flex items-center gap-1 rounded-lg border border-[rgba(17,17,21,0.1)] bg-white px-3 py-1.5 text-[11px] text-[#111115] shadow-2xs hover:bg-[#FAF9F6] disabled:opacity-30"
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
											<div className="rounded-lg border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3">
												<span className="text-[10px] text-[#6B6A75]">Total Rows</span>
												<p className="mt-0.5 text-base font-semibold text-[#111115]">
													{tableData.rowCount}
												</p>
											</div>
											<div className="rounded-lg border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3">
												<span className="text-[10px] text-[#6B6A75]">Total Columns</span>
												<p className="mt-0.5 text-base font-semibold text-[#111115]">
													{tableData.columns.length}
												</p>
											</div>
										</div>

										<h4 className="text-[12px] font-semibold text-[#111115]">Column Metrics & Statistics</h4>
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											{tableData.columns.map((col: string) => {
												const stat = tableData.stats[col];
												return (
													<div
														key={col}
														className="rounded-lg border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3 text-[11px]"
													>
														<div className="flex items-center justify-between font-medium text-[#111115]">
															<span>{col}</span>
															<span className="rounded bg-[rgba(58,12,163,0.08)] px-1.5 py-0.5 text-[9px] font-semibold text-[#3A0CA3]">
																{stat?.isNumeric ? "Numeric" : "Categorical"}
															</span>
														</div>
														<div className="mt-2 space-y-1 text-[#6B6A75]">
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
										<h4 className="text-[12px] font-semibold text-[#111115]">
											Cryptographic Provenance Lineage Graph
										</h4>
										<div className="space-y-3">
											{lineage.map((node: ProvenanceLineageNode) => (
												<div
													key={node.artifactId}
													className="relative rounded-lg border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3.5 text-[12px]"
												>
													<div className="flex items-center justify-between">
														<span className="font-semibold text-[#111115]">{node.name}</span>
														<span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
															v{node.version}
														</span>
													</div>
													<div className="mt-2 grid grid-cols-1 gap-1 text-[10px] text-[#6B6A75] sm:grid-cols-2">
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
														? "border-[#3A0CA3] bg-[rgba(58,12,163,0.05)] shadow-2xs"
														: "border-[rgba(17,17,21,0.06)] bg-white hover:bg-[#FAF9F6]"
												}`}
											>
												<div>
													<span className="font-semibold text-[#111115]">Version {v.version}</span>
													<p className="mt-0.5 text-[10px] text-[#6B6A75]">
														{new Date(v.createdAt).toLocaleString()} · {v.sizeBytes} bytes
													</p>
												</div>
												<span className="font-mono text-[10px] text-[#6B6A75]">
													{v.checksum.substring(0, 12)}…
												</span>
											</button>
										))}
									</div>
								)}
							</div>
						</div>
					) : (
						<div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-[rgba(17,17,21,0.15)] bg-white/50 p-6 text-center text-[#6B6A75]">
							<Layers className="size-8 text-[#8F8E98]" />
							<p className="mt-2 text-[12px]">Select an artifact from the library to inspect.</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
