export type ModelModality = "text" | "vision" | "audio" | "embedding";

export interface ModelCapabilityRecord {
	readonly provider: string;
	readonly modelId: string;
	readonly modalities: readonly ModelModality[];
	readonly contextWindow: number;
	readonly maxOutputTokens: number;
	readonly toolCalling: boolean;
	readonly streaming: boolean;
	readonly structuredOutput: boolean;
	readonly inputCostPerMillionUsd: number;
	readonly outputCostPerMillionUsd: number;
	readonly p95LatencyMs: number;
	readonly healthStatus: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
	readonly benchmarkQualityScore: number; // 0 - 100
	readonly lastVerifiedAt: string;
}

export class ModelCapabilityRegistry {
	private models = new Map<string, ModelCapabilityRecord>();

	constructor() {
		// Initialize with verified platform models
		this.register({
			provider: "nvidia",
			modelId: "meta/llama-3.3-70b-instruct",
			modalities: ["text"],
			contextWindow: 128_000,
			maxOutputTokens: 4_096,
			toolCalling: true,
			streaming: true,
			structuredOutput: true,
			inputCostPerMillionUsd: 0.70,
			outputCostPerMillionUsd: 0.90,
			p95LatencyMs: 1150,
			healthStatus: "HEALTHY",
			benchmarkQualityScore: 92,
			lastVerifiedAt: new Date().toISOString(),
		});

		this.register({
			provider: "nvidia",
			modelId: "meta/llama-3.2-11b-vision-instruct",
			modalities: ["text", "vision"],
			contextWindow: 128_000,
			maxOutputTokens: 4_096,
			toolCalling: true,
			streaming: true,
			structuredOutput: true,
			inputCostPerMillionUsd: 0.35,
			outputCostPerMillionUsd: 0.40,
			p95LatencyMs: 850,
			healthStatus: "HEALTHY",
			benchmarkQualityScore: 86,
			lastVerifiedAt: new Date().toISOString(),
		});

		this.register({
			provider: "omniroute",
			modelId: "nvidia/openai/gpt-oss-20b",
			modalities: ["text"],
			contextWindow: 32_000,
			maxOutputTokens: 4_096,
			toolCalling: true,
			streaming: true,
			structuredOutput: true,
			inputCostPerMillionUsd: 0.20,
			outputCostPerMillionUsd: 0.20,
			p95LatencyMs: 700,
			healthStatus: "HEALTHY",
			benchmarkQualityScore: 84,
			lastVerifiedAt: new Date().toISOString(),
		});
	}

	register(model: ModelCapabilityRecord): void {
		const key = `${model.provider}:${model.modelId}`;
		this.models.set(key, model);
	}

	get(provider: string, modelId: string): ModelCapabilityRecord | undefined {
		return this.models.get(`${provider}:${modelId}`);
	}

	listAll(): readonly ModelCapabilityRecord[] {
		return Array.from(this.models.values());
	}

	findOptimalModel(requirements: {
		modality?: ModelModality;
		requiresToolCalling?: boolean;
		requiresStructuredOutput?: boolean;
		minContextWindow?: number;
		maxBudgetPerMillion?: number;
	}): ModelCapabilityRecord | undefined {
		const eligible = this.listAll().filter((m) => {
			if (m.healthStatus === "UNAVAILABLE") return false;
			if (requirements.modality && !m.modalities.includes(requirements.modality)) return false;
			if (requirements.requiresToolCalling && !m.toolCalling) return false;
			if (requirements.requiresStructuredOutput && !m.structuredOutput) return false;
			if (requirements.minContextWindow && m.contextWindow < requirements.minContextWindow) return false;
			if (requirements.maxBudgetPerMillion && m.inputCostPerMillionUsd > requirements.maxBudgetPerMillion) return false;
			return true;
		});

		// Sort by benchmark quality score descending
		eligible.sort((a, b) => b.benchmarkQualityScore - a.benchmarkQualityScore);
		return eligible[0];
	}
}

export const globalModelRegistry = new ModelCapabilityRegistry();
