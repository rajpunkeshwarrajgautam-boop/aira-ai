import type { AiraPromptMode, ComposedAiraPrompt, SafePromptTelemetry } from "./types";

export const AIRA_SYSTEM_PROMPT_VERSION = "r4.1";

/**
 * Creates safe metadata for logging and observability.
 * STRICT SECURITY INVARIANT:
 * Never logs raw prompt text, private user queries, retrieved chunks,
 * memory content, API keys, credentials, or session tokens.
 */
export function createSafePromptTelemetry(params: {
	composedPrompt: ComposedAiraPrompt;
	provider?: string;
	model?: string;
}): SafePromptTelemetry {
	return {
		promptVersion: params.composedPrompt.version,
		mode: (params.composedPrompt.enabledLayers.find((l) =>
			["chat", "research", "work", "agent", "compare"].includes(l),
		) ?? "chat") as AiraPromptMode,
		provider: params.provider ?? "unknown",
		model: params.model ?? "unknown",
		enabledLayers: params.composedPrompt.enabledLayers,
		estimatedTokens: params.composedPrompt.estimatedTokens,
		timestamp: new Date().toISOString(),
	};
}
