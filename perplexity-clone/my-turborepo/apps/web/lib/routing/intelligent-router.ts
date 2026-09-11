import {
	globalModelRegistry,
	type ModelCapabilityRecord,
	type ModelModality,
} from "@/lib/contracts/model-registry";

export interface RoutingDecision {
	readonly selectedModel: ModelCapabilityRecord;
	readonly estimatedCostUsd: number;
	readonly reasoning: string;
	readonly benchmarkScore: number;
	readonly fallbackModels: readonly ModelCapabilityRecord[];
}

export class MeasuredIntelligentRouter {
	selectRoute(params: {
		taskType: "research" | "coding" | "browser" | "general" | "multimodal";
		modality?: ModelModality;
		estimatedTokens?: number;
		latencySensitive?: boolean;
		maxBudgetUsd?: number;
	}): RoutingDecision {
		const modality = params.modality ?? (params.taskType === "multimodal" ? "vision" : "text");
		const estimatedTokens = params.estimatedTokens ?? 2000;

		const eligible = globalModelRegistry.listAll().filter((m) => {
			if (m.healthStatus === "UNAVAILABLE") return false;
			return m.modalities.includes(modality);
		});

		if (eligible.length === 0) {
			throw new Error(`No available models matching modality: ${modality}`);
		}

		// Sort based on objective function: quality weight vs latency vs cost
		const scored = eligible.map((m) => {
			const estimatedCost = (estimatedTokens / 1_000_000) * m.inputCostPerMillionUsd;
			let score = m.benchmarkQualityScore;

			if (params.latencySensitive) {
				score -= m.p95LatencyMs / 100; // Penalize higher latency
			}
			if (params.maxBudgetUsd && estimatedCost > params.maxBudgetUsd) {
				score -= 50; // Heavily penalize over budget
			}
			return { model: m, score, estimatedCost };
		});

		scored.sort((a, b) => b.score - a.score);

		const selected = scored[0]!;
		const fallbacks = scored.slice(1).map((s) => s.model);

		return {
			selectedModel: selected.model,
			estimatedCostUsd: Number(selected.estimatedCost.toFixed(6)),
			reasoning: `Selected ${selected.model.provider}/${selected.model.modelId} (Score: ${selected.model.benchmarkQualityScore}, Latency: ${selected.model.p95LatencyMs}ms) for ${params.taskType}`,
			benchmarkScore: selected.model.benchmarkQualityScore,
			fallbackModels: fallbacks,
		};
	}
}

export const globalIntelligentRouter = new MeasuredIntelligentRouter();
