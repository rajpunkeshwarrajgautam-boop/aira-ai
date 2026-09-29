import {
	globalModelRegistry,
	type ModelCapabilityRecord,
	type ModelModality,
} from "@/lib/contracts/model-registry";

export type RoutingTaskType = "research" | "coding" | "browser" | "general" | "multimodal";
export type RoutingComplexity = "low" | "medium" | "high";
export type RoutingProviderTier = "free" | "pro";

export interface RoutingSignals {
	readonly taskType: RoutingTaskType;
	readonly complexity: RoutingComplexity;
	readonly modality: ModelModality;
	readonly estimatedTokens: number;
	readonly latencySensitive: boolean;
	readonly requiresToolCalling: boolean;
	readonly requiresStructuredOutput: boolean;
	readonly minContextWindow?: number;
}

export interface RoutingDecision {
	readonly selectedModel: ModelCapabilityRecord;
	readonly estimatedCostUsd: number;
	readonly reasoning: string;
	readonly benchmarkScore: number;
	readonly fallbackModels: readonly ModelCapabilityRecord[];
}

export interface RuntimeRoutingDecision {
	readonly providerTier: RoutingProviderTier;
	readonly requestedProvider: "omniroute" | "nvidia";
	readonly requestedModel: string;
	readonly routingProfile?: "auto" | "auto/smart" | "auto/coding" | "auto/fast";
	readonly signals: RoutingSignals;
	readonly reasons: readonly string[];
	readonly explicitModelOverride: boolean;
	readonly modelDecision?: RoutingDecision;
}

const CODING_PATTERN =
	/\b(code|coding|debug|debugging|bug|typescript|javascript|python|sql|refactor|implement|implementation|compile|compiler|stack trace|exception|function|api|docker|kubernetes|git|github|next\.?js|react|database|schema|migration|unit test|integration test|pull request|repository)\b/i;
const BROWSER_PATTERN =
	/\b(open|click|navigate|browse|browser|log\s*in|login|sign\s*in|fill(?:\s+out)?|submit|upload|download|book|checkout|visit)\b/i;
const RESEARCH_PATTERN =
	/\b(research|compare|comparison|analyse|analyze|analysis|investigate|latest|current|sources?|market|competitor|competitive|due diligence|evidence|benchmark|landscape|find out|state of the art|survey)\b/i;
const TOOL_PATTERN =
	/\b(send|email|create|update|delete|publish|post|schedule|book|upload|download|add to|move|rename|open|click|navigate|fill|submit|run|execute|deploy)\b/i;
const HIGH_COMPLEXITY_PATTERN =
	/\b(comprehensive|architecture|architect|trade[- ]?offs?|root cause|multi[- ]?step|end[- ]?to[- ]?end|strategy|strategic|plan and execute|deep research|due diligence|threat model|production[- ]grade|system design|migration plan|incident analysis)\b/i;
const STRUCTURED_PATTERN =
	/\b(json|schema|table|matrix|structured|csv|sql|typescript type|zod|interface|contract)\b/i;

function countStepSignals(query: string): number {
	const listMarkers = query.match(/(?:^|\n)\s*(?:\d+[.)]|[-*])\s+/g)?.length ?? 0;
	const sequencing = query.match(/\b(?:then|after that|next|finally|and then)\b/gi)?.length ?? 0;
	return listMarkers + sequencing;
}

function inferTaskType(query: string, mode: "standard" | "deep", modality: ModelModality): RoutingTaskType {
	if (modality === "vision" || modality === "audio") return "multimodal";
	if (CODING_PATTERN.test(query)) return "coding";
	if (BROWSER_PATTERN.test(query) && TOOL_PATTERN.test(query)) return "browser";
	if (mode === "deep" || RESEARCH_PATTERN.test(query)) return "research";
	return "general";
}

function inferComplexity(query: string, mode: "standard" | "deep", taskType: RoutingTaskType): RoutingComplexity {
	const length = query.trim().length;
	const words = query.trim().split(/\s+/).filter(Boolean).length;
	const steps = countStepSignals(query);

	if (
		mode === "deep" ||
		length >= 900 ||
		words >= 150 ||
		steps >= 4 ||
		HIGH_COMPLEXITY_PATTERN.test(query)
	) {
		return "high";
	}

	if (
		length >= 260 ||
		words >= 45 ||
		steps >= 2 ||
		taskType === "research" ||
		taskType === "coding"
	) {
		return "medium";
	}

	return "low";
}

export function inferRoutingSignals(input: {
	readonly query: string;
	readonly mode?: "standard" | "deep";
	readonly modality?: ModelModality;
}): RoutingSignals {
	const mode = input.mode ?? "standard";
	const modality = input.modality ?? "text";
	const taskType = inferTaskType(input.query, mode, modality);
	const complexity = inferComplexity(input.query, mode, taskType);
	const estimatedTokens = Math.max(
		800,
		Math.min(16_000, Math.ceil(input.query.length / 3.5) + (complexity === "high" ? 3_000 : complexity === "medium" ? 1_800 : 900)),
	);
	const requiresToolCalling = taskType === "browser" || TOOL_PATTERN.test(input.query);
	const requiresStructuredOutput = STRUCTURED_PATTERN.test(input.query) || taskType === "coding";
	const latencySensitive = complexity === "low" && taskType === "general";
	const minContextWindow =
		input.query.length >= 12_000 ? 64_000 :
		input.query.length >= 6_000 ? 32_000 :
		undefined;

	return {
		taskType,
		complexity,
		modality,
		estimatedTokens,
		latencySensitive,
		requiresToolCalling,
		requiresStructuredOutput,
		...(minContextWindow ? { minContextWindow } : {}),
	};
}

function scoreModelForTask(
	model: ModelCapabilityRecord,
	params: {
		readonly taskType: RoutingTaskType;
		readonly complexity: RoutingComplexity;
		readonly estimatedTokens: number;
		readonly latencySensitive?: boolean;
		readonly maxBudgetUsd?: number;
	},
): { score: number; estimatedCost: number } {
	const estimatedCost = (params.estimatedTokens / 1_000_000) * model.inputCostPerMillionUsd;
	const qualityWeight =
		params.complexity === "high" ? 1.35 :
		params.complexity === "medium" ? 1 :
		0.65;

	let score = model.benchmarkQualityScore * qualityWeight;

	if (params.taskType === "coding") {
		if (model.toolCalling) score += 8;
		if (model.structuredOutput) score += 10;
		score += Math.min(8, model.contextWindow / 16_000);
	}

	if (params.taskType === "research") {
		score += Math.min(10, model.contextWindow / 16_000);
		score += model.benchmarkQualityScore * 0.12;
	}

	if (params.taskType === "browser") {
		if (model.toolCalling) score += 12;
		score -= model.p95LatencyMs / 70;
	}

	if (params.taskType === "multimodal" && model.modalities.includes("vision")) {
		score += 20;
	}

	if (params.taskType === "general" && params.complexity === "low") {
		score -= model.p95LatencyMs / 45;
		score -= model.inputCostPerMillionUsd * 8;
	}

	if (params.latencySensitive) {
		score -= model.p95LatencyMs / 50;
	}

	if (params.maxBudgetUsd !== undefined && params.maxBudgetUsd > 0) {
		if (estimatedCost > params.maxBudgetUsd) {
			const overageRatio = estimatedCost / params.maxBudgetUsd;
			score -= Math.min(140, overageRatio * 30);
		} else {
			score += 6;
		}
	}

	return { score, estimatedCost };
}

export class MeasuredIntelligentRouter {
	inferSignals(input: {
		readonly query: string;
		readonly mode?: "standard" | "deep";
		readonly modality?: ModelModality;
	}): RoutingSignals {
		return inferRoutingSignals(input);
	}

	selectRoute(params: {
		readonly taskType: RoutingTaskType;
		readonly complexity?: RoutingComplexity;
		readonly modality?: ModelModality;
		readonly estimatedTokens?: number;
		readonly latencySensitive?: boolean;
		readonly maxBudgetUsd?: number;
		readonly requiresToolCalling?: boolean;
		readonly requiresStructuredOutput?: boolean;
		readonly minContextWindow?: number;
		readonly allowedProviders?: readonly string[];
	}): RoutingDecision {
		const modality = params.modality ?? (params.taskType === "multimodal" ? "vision" : "text");
		const estimatedTokens = params.estimatedTokens ?? 2_000;
		const complexity = params.complexity ?? "medium";
		const allowedProviders = params.allowedProviders ? new Set(params.allowedProviders) : null;

		const eligible = globalModelRegistry.listAll().filter((model) => {
			if (model.healthStatus === "UNAVAILABLE") return false;
			if (allowedProviders && !allowedProviders.has(model.provider)) return false;
			if (!model.modalities.includes(modality)) return false;
			if (params.requiresToolCalling && !model.toolCalling) return false;
			if (params.requiresStructuredOutput && !model.structuredOutput) return false;
			if (params.minContextWindow && model.contextWindow < params.minContextWindow) return false;
			return true;
		});

		if (eligible.length === 0) {
			throw new Error(
				`No available models satisfy routing constraints (task=${params.taskType}, modality=${modality}).`,
			);
		}

		const scored = eligible.map((model) => {
			const taskScore = scoreModelForTask(model, {
				taskType: params.taskType,
				complexity,
				estimatedTokens,
				latencySensitive: params.latencySensitive,
				maxBudgetUsd: params.maxBudgetUsd,
			});
			return { model, ...taskScore };
		});

		scored.sort((a, b) => b.score - a.score);
		const selected = scored[0]!;
		const fallbacks = scored.slice(1).map((candidate) => candidate.model);

		return {
			selectedModel: selected.model,
			estimatedCostUsd: Number(selected.estimatedCost.toFixed(6)),
			reasoning:
				`Selected ${selected.model.provider}/${selected.model.modelId} for ${params.taskType}/${complexity} ` +
				`(taskScore=${selected.score.toFixed(2)}, quality=${selected.model.benchmarkQualityScore}, p95=${selected.model.p95LatencyMs}ms).`,
			benchmarkScore: selected.model.benchmarkQualityScore,
			fallbackModels: fallbacks,
		};
	}

	selectRuntimeRoute(params: {
		readonly query: string;
		readonly providerTier: RoutingProviderTier;
		readonly mode?: "standard" | "deep";
		readonly modality?: ModelModality;
		readonly explicitModel?: string;
		readonly maxBudgetUsd?: number;
	}): RuntimeRoutingDecision {
		const signals = this.inferSignals({
			query: params.query,
			mode: params.mode,
			modality: params.modality,
		});
		const explicit = params.explicitModel?.trim();

		if (explicit && explicit !== "auto") {
			return {
				providerTier: params.providerTier,
				requestedProvider: params.providerTier === "pro" ? "omniroute" : "nvidia",
				requestedModel: explicit,
				signals,
				reasons: ["Explicit user/model selection overrides automatic routing."],
				explicitModelOverride: true,
			};
		}

		if (params.providerTier === "pro") {
			let requestedModel: RuntimeRoutingDecision["requestedModel"] = "auto";
			let routingProfile: RuntimeRoutingDecision["routingProfile"] = "auto";
			const reasons: string[] = [];

			if (signals.modality === "vision") {
				requestedModel = "meta/llama-3.2-11b-vision-instruct";
				routingProfile = undefined;
				reasons.push("Vision input requires a verified multimodal model.");
			} else if (signals.taskType === "coding") {
				requestedModel = "auto/coding";
				routingProfile = "auto/coding";
				reasons.push("Coding intent maps to OmniRoute's validated coding profile.");
			} else if (signals.taskType === "research" || signals.complexity === "high") {
				requestedModel = "auto/smart";
				routingProfile = "auto/smart";
				reasons.push("Research/high-complexity intent maps to the quality-first smart profile.");
			} else if (signals.taskType === "browser" || signals.latencySensitive) {
				requestedModel = "auto/fast";
				routingProfile = "auto/fast";
				reasons.push("Interactive/browser or simple latency-sensitive work maps to the fast profile.");
			} else {
				reasons.push("Balanced medium-complexity work uses OmniRoute auto.");
			}

			return {
				providerTier: params.providerTier,
				requestedProvider: "omniroute",
				requestedModel,
				...(routingProfile ? { routingProfile } : {}),
				signals,
				reasons,
				explicitModelOverride: false,
			};
		}

		const modelDecision = this.selectRoute({
			taskType: signals.taskType,
			complexity: signals.complexity,
			modality: signals.modality,
			estimatedTokens: signals.estimatedTokens,
			latencySensitive: signals.latencySensitive,
			requiresToolCalling: signals.requiresToolCalling,
			requiresStructuredOutput: signals.requiresStructuredOutput,
			minContextWindow: signals.minContextWindow,
			maxBudgetUsd: params.maxBudgetUsd,
			allowedProviders: ["nvidia"],
		});

		return {
			providerTier: params.providerTier,
			requestedProvider: "nvidia",
			requestedModel: modelDecision.selectedModel.modelId,
			signals,
			reasons: [
				`Free-tier route selected from NVIDIA models using task, complexity, modality, latency, context, capability, and budget signals.`,
				modelDecision.reasoning,
			],
			explicitModelOverride: false,
			modelDecision,
		};
	}
}

export const globalIntelligentRouter = new MeasuredIntelligentRouter();
