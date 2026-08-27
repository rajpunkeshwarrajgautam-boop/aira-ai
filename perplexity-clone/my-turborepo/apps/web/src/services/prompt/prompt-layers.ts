/**
 * AIRA prompt trust hierarchy.
 *
 * Every instruction that reaches a provider belongs to exactly one layer, and
 * the layer decides how much authority it carries. Lower ordinal wins: a
 * template can never restate its way past AIRA's core policy, and retrieved
 * content can never become an instruction at all.
 *
 * This module is deliberately dependency-free so it can be unit tested and
 * imported from both the runtime answer pipeline and the Prompt Studio APIs.
 */

export const PROMPT_LAYERS = [
	"aira-core",
	"runtime-invariants",
	"workspace-policy",
	"mode-policy",
	"agent-instructions",
	"template",
	"adaptive-task",
	"contextual-memory",
	"conversation-history",
	"external-content",
	"user-request",
] as const;

export type PromptLayerId = (typeof PROMPT_LAYERS)[number];

export interface PromptLayerDescriptor {
	readonly id: PromptLayerId;
	readonly rank: number;
	readonly label: string;
	/** Layers rendered as `system` messages carry instruction authority. */
	readonly channel: "system" | "history" | "user";
	/**
	 * Protected layers are authored by AIRA. Nothing a user, template, agent,
	 * document or webpage supplies may be emitted into them.
	 */
	readonly protected: boolean;
	readonly description: string;
}

const DESCRIPTORS: readonly PromptLayerDescriptor[] = [
	{
		id: "aira-core",
		rank: 0,
		label: "AIRA core",
		channel: "system",
		protected: true,
		description: "Identity, grounding, citation integrity and safety invariants.",
	},
	{
		id: "runtime-invariants",
		rank: 1,
		label: "Runtime invariants",
		channel: "system",
		protected: true,
		description: "Provider, tool-permission and data/instruction boundary rules.",
	},
	{
		id: "workspace-policy",
		rank: 2,
		label: "Workspace policy",
		channel: "system",
		protected: true,
		description: "Workspace or administrator policy applied to every request.",
	},
	{
		id: "mode-policy",
		rank: 3,
		label: "Mode policy",
		channel: "system",
		protected: true,
		description: "Research preset, depth and verification discipline for this mode.",
	},
	{
		id: "agent-instructions",
		rank: 4,
		label: "Agent instructions",
		channel: "system",
		protected: false,
		description: "Instructions from the agent definition running this request.",
	},
	{
		id: "template",
		rank: 5,
		label: "Prompt template",
		channel: "system",
		protected: false,
		description: "A published Prompt Studio template version selected by the user.",
	},
	{
		id: "adaptive-task",
		rank: 6,
		label: "Adaptive task instructions",
		channel: "system",
		protected: true,
		description: "Per-request shaping derived from the query itself.",
	},
	{
		id: "contextual-memory",
		rank: 7,
		label: "Contextual memory",
		channel: "system",
		protected: false,
		description: "Durable user state. Possibly partial or stale; never governing.",
	},
	{
		id: "conversation-history",
		rank: 8,
		label: "Conversation history",
		channel: "history",
		protected: false,
		description: "Prior turns, replayed in their original roles.",
	},
	{
		id: "external-content",
		rank: 9,
		label: "Retrieved / external content",
		channel: "user",
		protected: false,
		description: "Evidence, documents and tool output. Data, never instruction.",
	},
	{
		id: "user-request",
		rank: 10,
		label: "User request",
		channel: "user",
		protected: false,
		description: "The user's current message.",
	},
];

const BY_ID = new Map<PromptLayerId, PromptLayerDescriptor>(
	DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

export function promptLayerDescriptors(): readonly PromptLayerDescriptor[] {
	return DESCRIPTORS;
}

export function promptLayer(id: PromptLayerId): PromptLayerDescriptor {
	const descriptor = BY_ID.get(id);
	if (!descriptor) throw new Error(`Unknown prompt layer: ${id}`);
	return descriptor;
}

export function promptLayerRank(id: PromptLayerId): number {
	return promptLayer(id).rank;
}

/**
 * True when `candidate` may override `incumbent`. Only strictly higher-trust
 * layers win, so a template can never displace AIRA core or mode policy.
 */
export function layerOverrides(candidate: PromptLayerId, incumbent: PromptLayerId): boolean {
	return promptLayerRank(candidate) < promptLayerRank(incumbent);
}

export function isProtectedLayer(id: PromptLayerId): boolean {
	return promptLayer(id).protected;
}

/**
 * Layers whose content originates outside AIRA. Anything here is untrusted and
 * must be presented to the model as data.
 */
export const UNTRUSTED_LAYERS: readonly PromptLayerId[] = [
	"agent-instructions",
	"template",
	"contextual-memory",
	"conversation-history",
	"external-content",
	"user-request",
];

export function isUntrustedLayer(id: PromptLayerId): boolean {
	return UNTRUSTED_LAYERS.includes(id);
}
