/**
 * Prompt Caching utilities for AIRA AI.
 * Enforces a stable prefix ordering to maximize KV-cache reuse on providers
 * supporting prefix caching (e.g. Anthropic, OpenAI, DeepSeek, vLLM).
 *
 * Cache Order:
 * 1. Stable Core Identity & Invariants (Static across all requests)
 * 2. Stable Mode Instructions (Static per mode)
 * 3. Static Tool Definitions & Schemas
 * 4. Dynamic Runtime Metadata (Per-turn/session state)
 * 5. Retrieved Context / Data (Per-query RAG)
 * 6. Dynamic Conversation Turns (Append-only)
 */

export interface CacheablePromptBlock {
	readonly id: string;
	readonly content: string;
	readonly cacheControl?: { readonly type: "ephemeral" };
	readonly isStatic: boolean;
}

export function structureCacheableBlocks(params: {
	coreBlock: string;
	modeBlock: string;
	toolBlock?: string;
	runtimeBlock?: string;
}): CacheablePromptBlock[] {
	const blocks: CacheablePromptBlock[] = [
		{
			id: "aira_core_invariants",
			content: params.coreBlock,
			cacheControl: { type: "ephemeral" },
			isStatic: true,
		},
		{
			id: "aira_mode_policy",
			content: params.modeBlock,
			cacheControl: { type: "ephemeral" },
			isStatic: true,
		},
	];

	if (params.toolBlock?.trim()) {
		blocks.push({
			id: "aira_tool_definitions",
			content: params.toolBlock,
			cacheControl: { type: "ephemeral" },
			isStatic: true,
		});
	}

	if (params.runtimeBlock?.trim()) {
		blocks.push({
			id: "aira_dynamic_runtime",
			content: params.runtimeBlock,
			isStatic: false,
		});
	}

	return blocks;
}
