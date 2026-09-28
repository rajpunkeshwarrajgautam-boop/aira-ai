export type ReasoningEffort = "low" | "medium" | "high";

export type ComposerModelProfileId = "auto" | "fast" | "deep" | "smart";

export interface ReasoningEffortCapability {
	readonly supported: boolean;
	readonly reason?: string;
}

const UNSUPPORTED_REASON =
	"Reasoning effort is not available for this model. Aira will use the model's supported reasoning behavior automatically.";

/**
 * The current composer exposes product-level routing profiles rather than a
 * provider/model pair with a verified native reasoning-effort contract.
 * Keep this mapping conservative: never send an unsupported effort parameter
 * merely because a product label sounds like a reasoning model.
 */
export const REASONING_EFFORT_CAPABILITIES: Readonly<
	Record<ComposerModelProfileId, ReasoningEffortCapability>
> = {
	auto: { supported: false, reason: UNSUPPORTED_REASON },
	fast: { supported: false, reason: UNSUPPORTED_REASON },
	deep: { supported: false, reason: UNSUPPORTED_REASON },
	smart: { supported: false, reason: UNSUPPORTED_REASON },
};

export function reasoningEffortCapability(model: string): ReasoningEffortCapability {
	if (model in REASONING_EFFORT_CAPABILITIES) {
		return REASONING_EFFORT_CAPABILITIES[model as ComposerModelProfileId];
	}
	return { supported: false, reason: UNSUPPORTED_REASON };
}

export function supportedReasoningEffort(
	model: string,
	effort: ReasoningEffort,
): ReasoningEffort | undefined {
	return reasoningEffortCapability(model).supported ? effort : undefined;
}
