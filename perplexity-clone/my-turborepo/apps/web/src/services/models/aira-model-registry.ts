export const AIRA_MODEL_TIERS = ["edge", "core", "pro", "ultra", "apex"] as const;
export type AiraModelTier = (typeof AIRA_MODEL_TIERS)[number];

export const AIRA_MODEL_RELEASE_STATES = [
	"experiment",
	"candidate",
	"release-candidate",
	"production",
	"retired",
] as const;
export type AiraModelReleaseState = (typeof AIRA_MODEL_RELEASE_STATES)[number];

export const AIRA_MODEL_EVIDENCE_STATES = [
	"NOT_TESTED",
	"BASELINE",
	"IMPROVED",
	"CLASS_LEADING",
	"FRONTIER_COMPETITIVE",
	"FRONTIER_LEADING",
] as const;
export type AiraModelEvidenceState = (typeof AIRA_MODEL_EVIDENCE_STATES)[number];

export interface AiraModelDefinition {
	readonly id: `aira/${AiraModelTier}`;
	readonly label: string;
	readonly tier: AiraModelTier;
	readonly parameterClass: string;
	readonly candidateBase: string | null;
	readonly releaseState: AiraModelReleaseState;
	readonly evidenceState: AiraModelEvidenceState;
	/**
	 * AIRA-native models are exposed only when the configured OmniRoute gateway
	 * actually discovers the exact model id. The registry is not an availability
	 * assertion and must never make an undeployed model appear usable in the UI.
	 */
	readonly exposure: "omniroute-discovered-only";
}

export const AIRA_MODEL_REGISTRY: readonly AiraModelDefinition[] = [
	{
		id: "aira/edge",
		label: "AIRA Edge",
		tier: "edge",
		parameterClass: "1B-4B",
		candidateBase: null,
		releaseState: "experiment",
		evidenceState: "NOT_TESTED",
		exposure: "omniroute-discovered-only",
	},
	{
		id: "aira/core",
		label: "AIRA Core",
		tier: "core",
		parameterClass: "7B-10B",
		candidateBase: "Qwen/Qwen3.5-9B-Base",
		releaseState: "experiment",
		evidenceState: "NOT_TESTED",
		exposure: "omniroute-discovered-only",
	},
	{
		id: "aira/pro",
		label: "AIRA Pro",
		tier: "pro",
		parameterClass: "12B-16B",
		candidateBase: null,
		releaseState: "experiment",
		evidenceState: "NOT_TESTED",
		exposure: "omniroute-discovered-only",
	},
	{
		id: "aira/ultra",
		label: "AIRA Ultra",
		tier: "ultra",
		parameterClass: "30B-35B or efficient equivalent",
		candidateBase: null,
		releaseState: "experiment",
		evidenceState: "NOT_TESTED",
		exposure: "omniroute-discovered-only",
	},
	{
		id: "aira/apex",
		label: "AIRA Apex",
		tier: "apex",
		parameterClass: "frontier-scale dense/MoE/hybrid; architecture not locked",
		candidateBase: null,
		releaseState: "experiment",
		evidenceState: "NOT_TESTED",
		exposure: "omniroute-discovered-only",
	},
] as const;

const BY_ID = new Map(AIRA_MODEL_REGISTRY.map((model) => [model.id, model] as const));

export function getAiraModelDefinition(id: string): AiraModelDefinition | undefined {
	return BY_ID.get(id as AiraModelDefinition["id"]);
}

export function getDiscoveredAiraModels(discoveredModelIds: readonly string[]): readonly AiraModelDefinition[] {
	const discovered = new Set(discoveredModelIds);
	return AIRA_MODEL_REGISTRY.filter((model) => discovered.has(model.id));
}
