import { AIRA_RESEARCH_VERIFICATION_DISCIPLINE } from "../../lib/agents/execution-discipline";
import { CORE_ASSISTANT_BEHAVIOR } from "./chat-prompt-policy";

export type ResearchPresetId = "general" | "academic" | "startup" | "coding" | "shopping";

export interface ResearchPreset {
	readonly id: ResearchPresetId;
	readonly label: string;
	readonly description: string;
	readonly systemPromptModifier: string;
	readonly citationStrictness: "standard" | "high" | "informational";
	readonly answerStyle: "balanced" | "formal" | "business" | "technical" | "comparison";
	readonly preferredDepth: "standard" | "deep";
}

export const RESEARCH_PRESETS: Record<ResearchPresetId, ResearchPreset> = {
	general: {
		id: "general",
		label: "General",
		description: "Default balanced answer for everyday questions.",
		systemPromptModifier: "Provide a balanced, helpful, and concise answer.",
		citationStrictness: "standard",
		answerStyle: "balanced",
		preferredDepth: "standard",
	},
	academic: {
		id: "academic",
		label: "Academic",
		description: "Formal tone with stronger emphasis on methodology and citations.",
		systemPromptModifier:
			"Use a formal academic tone. Explain methodology where appropriate. Ensure all major claims are strictly supported by citations. Avoid unsupported speculation.",
		citationStrictness: "high",
		answerStyle: "formal",
		preferredDepth: "deep",
	},
	startup: {
		id: "startup",
		label: "Startup",
		description: "Focused on markets, risks, and business model insights.",
		systemPromptModifier:
			"Focus on market opportunities, competitive risks, business model viability, and strategic insights. Use a professional business tone.",
		citationStrictness: "standard",
		answerStyle: "business",
		preferredDepth: "standard",
	},
	coding: {
		id: "coding",
		label: "Coding",
		description: "Technical explanations and implementation steps.",
		systemPromptModifier:
			"Focus on technical accuracy, implementation steps, and code-oriented explanations. Use clear, structured technical language.",
		citationStrictness: "standard",
		answerStyle: "technical",
		preferredDepth: "standard",
	},
	shopping: {
		id: "shopping",
		label: "Shopping",
		description: "Comparison-focused with pros, cons, and recommendations.",
		systemPromptModifier:
			"Focus on product comparisons, price-to-feature value, and clear pros/cons. Provide a structured buyer's recommendation style.",
		citationStrictness: "informational",
		answerStyle: "comparison",
		preferredDepth: "standard",
	},
};

export function getResearchPreset(id?: string): ResearchPreset {
	const preset = id
		? RESEARCH_PRESETS[id as ResearchPresetId] ?? RESEARCH_PRESETS.general
		: RESEARCH_PRESETS.general;

	return {
		...preset,
		systemPromptModifier: `${CORE_ASSISTANT_BEHAVIOR}\n\n${AIRA_RESEARCH_VERIFICATION_DISCIPLINE}\n\n## Preset guidance: ${preset.label}\n${preset.systemPromptModifier}`,
	};
}
