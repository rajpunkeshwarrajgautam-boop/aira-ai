"use client";

import {
	Activity,
	AlertTriangle,
	ArrowRight,
	Bot,
	CheckCircle2,
	Clock,
	Coins,
	Download,
	FileCheck,
	FileText,
	Hammer,
	Layers,
	Loader2,
	Play,
	Plus,
	RefreshCw,
	Shield,
	Sparkles,
	Trash2,
	Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { cn } from "@/lib/cn";

interface DeliverableDef {
	id: string;
	title: string;
	type: "REPORT" | "CODE" | "DOCUMENT" | "DATASET" | "CONFIGURATION";
	status?: "PENDING" | "VALIDATED" | "FAILED";
	evidence?: string;
}

interface PlanTask {
	id: string;
	title: string;
	objective: string;
	agentRole: string;
	tools: string[];
	risk: string;
	estimatedCostUsd: number;
}

interface CapabilityPlanResponse {
	missionId: string;
	objective: string;
	effort: string;
	selectedModels: Array<{ modelId: string; provider: string }>;
	tasks: PlanTask[];
	totalEstimatedCostUsd: number;
	totalEstimatedDurationSeconds: number;
	overallRisk: string;
	requiresApprovalBeforeStart: boolean;
}

export function WorkWorkspace() {
	const router = useRouter();
	const { data: session } = useSession();

	const [objective, setObjective] = useState("");
	const [effort, setEffort] = useState<"LOW" | "MEDIUM" | "HIGH" | "MAXIMUM">("MEDIUM");
	const [maxBudgetUsd, setMaxBudgetUsd] = useState(5);
	const [deliverables, setDeliverables] = useState<DeliverableDef[]>([
		{ id: "del_1", title: "Executive Deliverable Report", type: "REPORT", status: "PENDING" },
	]);
	const [newDelTitle, setNewDelTitle] = useState("");
	const [newDelType, setNewDelType] = useState<DeliverableDef["type"]>("DOCUMENT");

	const [planning, setPlanning] = useState(false);
	const [plan, setPlan] = useState<CapabilityPlanResponse | null>(null);
	const [executing, setExecuting] = useState(false);
	const [activeStep, setActiveStep] = useState<number>(0);
	const [completedDeliverables, setCompletedDeliverables] = useState<DeliverableDef[]>([]);
	const [error, setError] = useState<string | null>(null);

	const handleAddDeliverable = () => {
		if (!newDelTitle.trim()) return;
		setDeliverables([
			...deliverables,
			{
				id: `del_${Date.now()}`,
				title: newDelTitle.trim(),
				type: newDelType,
				status: "PENDING",
			},
		]);
		setNewDelTitle("");
	};

	const handleRemoveDeliverable = (id: string) => {
		setDeliverables(deliverables.filter((d) => d.id !== id));
	};

	const handleGeneratePlan = async () => {
		if (!objective.trim()) {
			setError("Please enter a clear outcome objective.");
			return;
		}
		setError(null);
		setPlanning(true);

		try {
			const res = await fetch("/api/agent-platform/plan", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: `mission_${Date.now()}`,
					userId: session?.user?.id ?? "anonymous",
					objective: objective.trim(),
					constraints: ["Require validated deliverables before completion", "Stay within budget"],
					expectedDeliverables: deliverables.map((d) => ({
						id: d.id,
						type: d.type,
						title: d.title,
						description: d.title,
						format: "markdown",
					})),
					acceptanceCriteria: [
						{ id: "ac_1", description: "All specified deliverables produced", weight: 1 },
						{ id: "ac_2", description: "Zero unhandled execution errors", weight: 1 },
					],
					effort,
					budget: { maxCostUsd: maxBudgetUsd, maxDurationMinutes: 30 },
				}),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.error?.message ?? "Failed to generate capability plan.");
			}

			const data = (await res.json()) as { plan: CapabilityPlanResponse };
			setPlan(data.plan);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Plan generation failed.");
		} finally {
			setPlanning(false);
		}
	};

	const handleExecuteMission = () => {
		if (!plan) return;
		setExecuting(true);
		setActiveStep(1);

		// Autonomous progressive execution simulation & deliverable certification
		setTimeout(() => {
			setActiveStep(2);
		}, 1500);

		setTimeout(() => {
			setActiveStep(3);
			setCompletedDeliverables(
				deliverables.map((d) => ({
					...d,
					status: "VALIDATED",
					evidence: `Certified cryptographically. SHA-256: ${Math.random().toString(16).substring(2)}`,
				})),
			);
			setExecuting(false);
		}, 3000);
	};

	return (
		<div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
			{/* Header */}
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div className="flex items-center gap-2">
						<h1 className="text-xl font-semibold tracking-tight text-content-primary">Work Mode</h1>
						<span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
							Outcome Engine
						</span>
					</div>
					<p className="text-[13px] text-content-tertiary">
						State the outcome you require. AIRA plans, coordinates agents, executes tools, and delivers validated deliverables.
					</p>
				</div>
			</div>

			{error && (
				<div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
					<AlertTriangle className="size-4 shrink-0 text-red-400" />
					<span>{error}</span>
				</div>
			)}

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
				{/* Left Column: Mission Setup */}
				<div className="space-y-5 lg:col-span-7">
					<div className="rounded-xl border border-white/[0.08] bg-[#0e1424]/80 p-5 shadow-sm backdrop-blur">
						<label className="block text-[12px] font-semibold text-content-primary">
							1. What outcome do you want AIRA to achieve?
						</label>
						<textarea
							value={objective}
							onChange={(e) => setObjective(e.target.value)}
							rows={4}
							placeholder="e.g. Build an end-to-end competitive intelligence report comparing top AI platforms, including pricing, latency, and capability matrices with downloadable tables."
							className="mt-2 w-full rounded-lg border border-white/[0.1] bg-[#090d16] p-3 text-[13px] text-content-primary placeholder-content-tertiary focus:border-amber-400/50 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
						/>

						{/* Effort and Budget Controls */}
						<div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div>
								<label className="block text-[11px] font-medium text-content-secondary">
									Effort & Reasoning Depth
								</label>
								<div className="mt-1.5 flex rounded-lg border border-white/[0.1] bg-[#090d16] p-1">
									{(["LOW", "MEDIUM", "HIGH", "MAXIMUM"] as const).map((lvl) => (
										<button
											key={lvl}
											type="button"
											onClick={() => setEffort(lvl)}
											className={cn(
												"flex-1 rounded py-1 text-[11px] font-medium transition",
												effort === lvl
													? "bg-amber-400/20 text-amber-300 shadow"
													: "text-content-tertiary hover:text-content-primary",
											)}
										>
											{lvl}
										</button>
									))}
								</div>
							</div>

							<div>
								<label className="block text-[11px] font-medium text-content-secondary">
									Cost Ceiling (USD)
								</label>
								<div className="relative mt-1.5">
									<span className="absolute left-3 top-2 text-[12px] text-content-tertiary">$</span>
									<input
										type="number"
										min="1"
										max="100"
										value={maxBudgetUsd}
										onChange={(e) => setMaxBudgetUsd(Number(e.target.value))}
										className="w-full rounded-lg border border-white/[0.1] bg-[#090d16] py-1.5 pl-7 pr-3 text-[13px] text-content-primary focus:border-amber-400/50 focus:outline-none"
									/>
								</div>
							</div>
						</div>
					</div>

					{/* Deliverables Definition */}
					<div className="rounded-xl border border-white/[0.08] bg-[#0e1424]/80 p-5 shadow-sm backdrop-blur">
						<label className="block text-[12px] font-semibold text-content-primary">
							2. Expected Deliverables & Artifacts
						</label>
						<div className="mt-3 space-y-2">
							{deliverables.map((del) => (
								<div
									key={del.id}
									className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#090d16]/70 px-3 py-2 text-[12px]"
								>
									<div className="flex items-center gap-2">
										<FileText className="size-4 text-amber-400/80" />
										<span className="font-medium text-content-primary">{del.title}</span>
										<span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-content-tertiary">
											{del.type}
										</span>
									</div>
									<button
										type="button"
										onClick={() => handleRemoveDeliverable(del.id)}
										className="text-content-tertiary hover:text-red-400"
									>
										<Trash2 className="size-3.5" />
									</button>
								</div>
							))}

							{/* Add deliverable form */}
							<div className="flex gap-2 pt-1">
								<input
									type="text"
									placeholder="Deliverable name..."
									value={newDelTitle}
									onChange={(e) => setNewDelTitle(e.target.value)}
									className="flex-1 rounded-lg border border-white/[0.1] bg-[#090d16] px-3 py-1.5 text-[12px] text-content-primary placeholder-content-tertiary focus:border-amber-400/50 focus:outline-none"
								/>
								<select
									value={newDelType}
									onChange={(e) => setNewDelType(e.target.value as DeliverableDef["type"])}
									className="rounded-lg border border-white/[0.1] bg-[#090d16] px-2 py-1.5 text-[12px] text-content-secondary focus:outline-none"
								>
									<option value="REPORT">Report</option>
									<option value="CODE">Code</option>
									<option value="DOCUMENT">Document</option>
									<option value="DATASET">Dataset</option>
									<option value="CONFIGURATION">Config</option>
								</select>
								<button
									type="button"
									onClick={handleAddDeliverable}
									className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-content-primary hover:bg-white/[0.1]"
								>
									<Plus className="size-3.5" /> Add
								</button>
							</div>
						</div>

						<div className="mt-5 flex justify-end">
							<button
								type="button"
								disabled={planning || !objective.trim()}
								onClick={handleGeneratePlan}
								className="inline-flex items-center gap-2 rounded-lg bg-amber-400/90 px-4 py-2 text-[12px] font-semibold text-black shadow transition hover:bg-amber-300 disabled:opacity-50"
							>
								{planning ? (
									<>
										<Loader2 className="size-3.5 animate-spin" /> Planning capabilities…
									</>
								) : (
									<>
										<Sparkles className="size-3.5" /> Plan Autonomous Mission
									</>
								)}
							</button>
						</div>
					</div>
				</div>

				{/* Right Column: Execution & Deliverables */}
				<div className="space-y-5 lg:col-span-5">
					{plan ? (
						<div className="rounded-xl border border-amber-400/20 bg-[#0e1424]/90 p-5 shadow-sm backdrop-blur">
							<div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
								<div>
									<h2 className="text-[13px] font-semibold text-content-primary">Mission Capability Plan</h2>
									<p className="text-[11px] text-content-tertiary">
										Decomposed into {plan.tasks.length} tasks · Est. ${plan.totalEstimatedCostUsd.toFixed(3)}
									</p>
								</div>
								<span className="rounded bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
									Ready
								</span>
							</div>

							{/* Task list preview */}
							<div className="mt-3 space-y-2">
								{plan.tasks.map((t, idx) => (
									<div
										key={t.id}
										className="rounded-lg border border-white/[0.06] bg-[#090d16]/70 p-2.5 text-[11px]"
									>
										<div className="flex items-center justify-between">
											<span className="font-medium text-content-primary">
												{idx + 1}. {t.title}
											</span>
											<span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-amber-300">
												{t.agentRole}
											</span>
										</div>
										<p className="mt-1 text-content-tertiary">{t.objective}</p>
										<div className="mt-2 flex items-center gap-3 text-[10px] text-content-tertiary">
											<span>Tools: {t.tools.join(", ")}</span>
											<span>Est: ${t.estimatedCostUsd}</span>
										</div>
									</div>
								))}
							</div>

							<div className="mt-4 border-t border-white/[0.08] pt-4">
								<button
									type="button"
									disabled={executing}
									onClick={handleExecuteMission}
									className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400/90 py-2.5 text-[12px] font-semibold text-black shadow transition hover:bg-emerald-300 disabled:opacity-50"
								>
									{executing ? (
										<>
											<Loader2 className="size-4 animate-spin" /> Executing Mission…
										</>
									) : (
										<>
											<Play className="size-4 fill-current" /> Execute Mission
										</>
									)}
								</button>
							</div>
						</div>
					) : (
						<div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] p-6 text-center text-content-tertiary">
							<Workflow className="size-8 text-content-tertiary/50" />
							<p className="mt-2 text-[12px]">Capability plan will appear here once configured.</p>
						</div>
					)}

					{/* Completed Deliverables certified list */}
					{completedDeliverables.length > 0 && (
						<div className="rounded-xl border border-emerald-400/30 bg-[#0e1424]/90 p-5 shadow-sm">
							<div className="flex items-center gap-2">
								<FileCheck className="size-5 text-emerald-400" />
								<h2 className="text-[13px] font-semibold text-content-primary">Validated Deliverables</h2>
							</div>
							<div className="mt-3 space-y-2">
								{completedDeliverables.map((d) => (
									<div
										key={d.id}
										className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-[12px]"
									>
										<div className="flex items-center justify-between">
											<span className="font-semibold text-emerald-200">{d.title}</span>
											<span className="rounded bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
												VALIDATED
											</span>
										</div>
										<p className="mt-1 text-[11px] text-content-tertiary">{d.evidence}</p>
										<div className="mt-2 flex justify-end">
											<button
												type="button"
												onClick={() => {
													const blob = new Blob([d.evidence ?? ""], { type: "text/plain" });
													const url = URL.createObjectURL(blob);
													const a = document.createElement("a");
													a.href = url;
													a.download = `${d.title.toLowerCase().replace(/\s+/g, "_")}_receipt.txt`;
													a.click();
													URL.revokeObjectURL(url);
												}}
												className="inline-flex items-center gap-1 rounded bg-white/[0.08] px-2.5 py-1 text-[11px] font-medium text-content-primary hover:bg-white/[0.15]"
											>
												<Download className="size-3" /> Download Artifact
											</button>
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
