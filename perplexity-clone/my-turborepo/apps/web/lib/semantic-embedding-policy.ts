import { BillingPlan } from "@/generated/prisma/enums";

export type SemanticEmbeddingTier = "free" | "pro";
export type SemanticEmbeddingProviderId = "cloudflare" | "openai";
export type SemanticEmbeddingWorkload = "query" | "document";

export const SEMANTIC_EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_FREE_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const DEFAULT_PRO_EMBEDDING_MODEL = "text-embedding-3-small";

export interface SemanticEmbeddingRoute {
	readonly tier: SemanticEmbeddingTier;
	readonly providerId: SemanticEmbeddingProviderId;
	readonly baseURL?: string;
	readonly apiKey?: string;
	readonly model: string;
	readonly dimensions: number;
}

type EmbeddingEnvironment = Readonly<Record<string, string | undefined>>;

function value(env: EmbeddingEnvironment, name: string): string | undefined {
	const resolved = env[name]?.trim();
	return resolved || undefined;
}

function configuredDimensions(env: EmbeddingEnvironment, name: string): number | null {
	const raw = value(env, name);
	if (!raw) return SEMANTIC_EMBEDDING_DIMENSIONS;
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed === SEMANTIC_EMBEDDING_DIMENSIONS ? parsed : null;
}

export function semanticEmbeddingTierForBillingPlan(
	plan: BillingPlan | null | undefined,
): SemanticEmbeddingTier {
	return plan === BillingPlan.PRO || plan === BillingPlan.TEAM ? "pro" : "free";
}

export function semanticMemoryEnabled(env: EmbeddingEnvironment = process.env): boolean {
	return value(env, "SEMANTIC_MEMORY_ENABLED") === "true";
}

/**
 * Resolve the server-authoritative embedding route for one entitlement tier.
 * A missing/invalid route is represented as null so callers can degrade to
 * lexical memory. FREE never inherits any PRO or general OpenAI credential.
 */
export function resolveSemanticEmbeddingRoute(
	tier: SemanticEmbeddingTier,
	env: EmbeddingEnvironment = process.env,
): SemanticEmbeddingRoute | null {
	if (!semanticMemoryEnabled(env)) return null;

	if (tier === "free") {
		const providerId = value(env, "AIRA_FREE_EMBEDDING_PROVIDER") ?? "cloudflare";
		if (providerId !== "cloudflare") return null;
		const baseURL = value(env, "AIRA_FREE_EMBEDDING_BASE_URL");
		const apiKey = value(env, "AIRA_FREE_EMBEDDING_API_KEY");
		const dimensions = configuredDimensions(env, "AIRA_FREE_EMBEDDING_DIMENSIONS");
		if (!baseURL || !apiKey || dimensions === null) return null;
		return {
			tier,
			providerId,
			baseURL,
			apiKey,
			model: value(env, "AIRA_FREE_EMBEDDING_MODEL") ?? DEFAULT_FREE_EMBEDDING_MODEL,
			dimensions,
		};
	}

	const providerId = value(env, "AIRA_PRO_EMBEDDING_PROVIDER") ?? "openai";
	if (providerId !== "openai") return null;
	const dimensions = configuredDimensions(env, "AIRA_PRO_EMBEDDING_DIMENSIONS");
	const apiKey = value(env, "AIRA_PRO_EMBEDDING_API_KEY") ?? value(env, "AIRA_EMBEDDING_API_KEY");
	if (!apiKey || dimensions === null) return null;
	return {
		tier,
		providerId,
		baseURL: value(env, "AIRA_PRO_EMBEDDING_BASE_URL") ?? value(env, "AIRA_EMBEDDING_BASE_URL"),
		apiKey,
		model:
			value(env, "AIRA_PRO_EMBEDDING_MODEL") ??
			value(env, "AIRA_EMBEDDING_MODEL") ??
			DEFAULT_PRO_EMBEDDING_MODEL,
		dimensions,
	};
}

/**
 * Keep provider-specific input shaping explicit. Cloudflare's BGE endpoint
 * accepts normal text inputs, while richer providers currently do not require
 * AIRA-side query/document prefixes.
 */
export function formatSemanticEmbeddingInput(
	_route: Pick<SemanticEmbeddingRoute, "providerId" | "model">,
	text: string,
	_workload: SemanticEmbeddingWorkload,
): string {
	return text.trim();
}
