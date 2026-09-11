import { z } from "zod";
import { MissionInput, type MissionInputType } from "../contracts/mission";
import { globalModelRegistry, type ModelCapabilityRecord } from "../contracts/model-registry";
import { globalSkillsStore, type InstallableSkill } from "./installable-skills-store";
import { classifyToolRisk, requiresApproval } from "../tool-gateway/policy";
import type { RiskClass } from "../agent-platform/types";

export interface PlannedTask {
	readonly id: string;
	readonly title: string;
	readonly objective: string;
	readonly agentRole: "ARCHITECT" | "RESEARCH" | "FRONTEND" | "BACKEND" | "SECURITY" | "VERIFICATION" | "DEVOPS";
	readonly modelId: string;
	readonly provider: string;
	readonly tools: readonly string[];
	readonly skills: readonly string[];
	readonly dependencies: readonly string[];
	readonly expectedDeliverables: readonly string[];
	readonly risk: RiskClass;
	readonly requiresHumanApproval: boolean;
	readonly estimatedDurationSeconds: number;
	readonly estimatedCostUsd: number;
}

export interface CapabilityPlan {
	readonly missionId: string;
	readonly objective: string;
	readonly effort: string;
	readonly requiredModalities: readonly string[];
	readonly selectedModels: readonly ModelCapabilityRecord[];
	readonly selectedSkills: readonly InstallableSkill[];
	readonly tasks: readonly PlannedTask[];
	readonly totalEstimatedCostUsd: number;
	readonly totalEstimatedDurationSeconds: number;
	readonly overallRisk: RiskClass;
	readonly requiresApprovalBeforeStart: boolean;
	readonly createdAt: string;
}

export class CapabilityPlanner {
	plan(mission: MissionInputType): CapabilityPlan {
		const objectiveLower = mission.objective.toLowerCase();
		const effort = mission.effort ?? "medium";

		// 1. Infer modalities
		const modalities: string[] = ["text"];
		const hasCodeDeliverable = (mission.expectedDeliverables ?? []).some((d) => d.type === "CODE_REPOSITORY");
		if (
			hasCodeDeliverable ||
			objectiveLower.includes("code") ||
			objectiveLower.includes("app") ||
			objectiveLower.includes("website") ||
			objectiveLower.includes("build") ||
			objectiveLower.includes("component") ||
			objectiveLower.includes("dashboard") ||
			objectiveLower.includes("bug")
		) {
			modalities.push("code");
		}
		if (objectiveLower.includes("image") || objectiveLower.includes("visual") || objectiveLower.includes("ui") || objectiveLower.includes("screenshot")) {
			modalities.push("vision");
		}

		// 2. Select model based on effort
		const allModels = globalModelRegistry.listAll();
		let selectedModel: ModelCapabilityRecord = allModels.find((m: ModelCapabilityRecord) => m.modelId.includes("nemotron") || m.modelId.includes("4o") || m.modelId.includes("llama")) ?? allModels[0]!;
		if (effort === "low") {
			selectedModel = allModels.find((m: ModelCapabilityRecord) => m.inputCostPerMillionUsd < 1) ?? selectedModel;
		} else if (effort === "exhaustive" || effort === "high") {
			selectedModel = allModels.reduce((best: ModelCapabilityRecord, m: ModelCapabilityRecord) => (m.benchmarkQualityScore > best.benchmarkQualityScore ? m : best), selectedModel);
		}

		// 3. Select matching skills from global store
		const allSkills = globalSkillsStore.listSkills(mission.userId);
		const matchingSkills = allSkills.filter((s) => {
			if (!s.enabled) return false;
			return s.keywords.some((k) => objectiveLower.includes(k.toLowerCase()));
		});

		// 4. Generate decomposed tasks based on objective
		const tasks: PlannedTask[] = [];
		const isDevelopment = modalities.includes("code") || objectiveLower.includes("build");
		const deliverableNames = (mission.expectedDeliverables ?? []).map((d) => d.title);

		if (isDevelopment) {
			tasks.push({
				id: "task_plan_architect",
				title: "Architecture & Interface Design",
				objective: `Analyze requirements and draft system interfaces for: ${mission.objective}`,
				agentRole: "ARCHITECT",
				modelId: selectedModel.modelId,
				provider: selectedModel.provider,
				tools: ["files", "web"],
				skills: matchingSkills.filter((s) => s.preferredRoles.includes("ARCHITECT")).map((s) => s.id),
				dependencies: [],
				expectedDeliverables: ["architecture_spec.md"],
				risk: "LOW",
				requiresHumanApproval: false,
				estimatedDurationSeconds: 60,
				estimatedCostUsd: 0.02,
			});

			tasks.push({
				id: "task_core_implementation",
				title: "Core Implementation & Integration",
				objective: `Implement functional deliverables and unit tests for: ${mission.objective}`,
				agentRole: "BACKEND",
				modelId: selectedModel.modelId,
				provider: selectedModel.provider,
				tools: ["files", "terminal", "git"],
				skills: matchingSkills.filter((s) => s.preferredRoles.includes("BACKEND") || s.preferredRoles.includes("FRONTEND")).map((s) => s.id),
				dependencies: ["task_plan_architect"],
				expectedDeliverables: deliverableNames.length ? deliverableNames : ["core_solution.ts"],
				risk: "MEDIUM",
				requiresHumanApproval: false,
				estimatedDurationSeconds: 180,
				estimatedCostUsd: 0.08,
			});

			tasks.push({
				id: "task_verification_quality",
				title: "Deliverable Quality & Acceptance Verification",
				objective: `Verify acceptance criteria and audit deliverables for: ${mission.objective}`,
				agentRole: "VERIFICATION",
				modelId: selectedModel.modelId,
				provider: selectedModel.provider,
				tools: ["files", "terminal"],
				skills: matchingSkills.filter((s) => s.preferredRoles.includes("VERIFICATION") || s.preferredRoles.includes("QA")).map((s) => s.id),
				dependencies: ["task_core_implementation"],
				expectedDeliverables: ["verification_report.json"],
				risk: "LOW",
				requiresHumanApproval: false,
				estimatedDurationSeconds: 60,
				estimatedCostUsd: 0.03,
			});
		} else {
			// Research or general outcome mission
			tasks.push({
				id: "task_research_evidence",
				title: "Evidence Gathering & Analysis",
				objective: `Research authoritative sources and gather evidence for: ${mission.objective}`,
				agentRole: "RESEARCH",
				modelId: selectedModel.modelId,
				provider: selectedModel.provider,
				tools: ["web", "files"],
				skills: matchingSkills.map((s) => s.id),
				dependencies: [],
				expectedDeliverables: ["research_synthesis.md"],
				risk: "LOW",
				requiresHumanApproval: false,
				estimatedDurationSeconds: 90,
				estimatedCostUsd: 0.04,
			});

			tasks.push({
				id: "task_deliverable_assembly",
				title: "Deliverable Synthesis & Formatting",
				objective: `Synthesize finished output and validate against acceptance criteria: ${mission.objective}`,
				agentRole: "ARCHITECT",
				modelId: selectedModel.modelId,
				provider: selectedModel.provider,
				tools: ["files"],
				skills: matchingSkills.map((s) => s.id),
				dependencies: ["task_research_evidence"],
				expectedDeliverables: deliverableNames.length ? deliverableNames : ["final_output.md"],
				risk: "LOW",
				requiresHumanApproval: false,
				estimatedDurationSeconds: 60,
				estimatedCostUsd: 0.03,
			});
		}

		const totalCost = tasks.reduce((sum, t) => sum + t.estimatedCostUsd, 0);
		const totalDuration = tasks.reduce((sum, t) => sum + t.estimatedDurationSeconds, 0);
		const overallRisk: RiskClass = tasks.some((t) => t.risk === "PROTECTED")
			? "PROTECTED"
			: tasks.some((t) => t.risk === "HIGH")
				? "HIGH"
				: tasks.some((t) => t.risk === "MEDIUM")
					? "MEDIUM"
					: "LOW";

		const requiresApprovalBeforeStart = requiresApproval(overallRisk) ||
			(mission.maxCostUsd !== undefined && totalCost > mission.maxCostUsd);

		return {
			missionId: mission.id,
			objective: mission.objective,
			effort,
			requiredModalities: modalities,
			selectedModels: [selectedModel],
			selectedSkills: matchingSkills,
			tasks,
			totalEstimatedCostUsd: totalCost,
			totalEstimatedDurationSeconds: totalDuration,
			overallRisk,
			requiresApprovalBeforeStart,
			createdAt: new Date().toISOString(),
		};
	}
}

export const globalCapabilityPlanner = new CapabilityPlanner();
