import { AIRA_CORE_IDENTITY } from "./core/identity";
import { AIRA_GLOBAL_TRUTHFULNESS } from "./core/truthfulness";
import { AIRA_CORE_SAFETY } from "./core/safety";
import { AIRA_PROMPT_INJECTION_DEFENSE } from "./core/prompt-injection";
import { AIRA_PRIVACY_AND_CONFIDENTIALITY } from "./core/privacy";
import { AIRA_TONE_AND_STYLE } from "./core/tone";
import { AIRA_CORE_BEHAVIOR } from "./core/behavior";
import { AIRA_TOOL_TRUST_MODEL } from "./core/tool-trust";

import { AIRA_MODE_CHAT } from "./modes/chat";
import { AIRA_MODE_RESEARCH } from "./modes/research";
import { AIRA_MODE_WORK } from "./modes/work";
import { AIRA_MODE_AGENT } from "./modes/agent";
import { AIRA_MODE_COMPARE } from "./modes/compare";

import { AIRA_CAPABILITY_WEB } from "./capabilities/web";
import { AIRA_CAPABILITY_KNOWLEDGE } from "./capabilities/knowledge";
import { AIRA_CAPABILITY_MEMORY } from "./capabilities/memory";
import { AIRA_CAPABILITY_FILES } from "./capabilities/files";
import { AIRA_CAPABILITY_TOOLS } from "./capabilities/tools";
import { AIRA_CAPABILITY_CONNECTORS } from "./capabilities/connectors";

import { assertNoSecretMaterial, formatSafeRuntimeContext } from "./runtime-context";
import { AIRA_SYSTEM_PROMPT_VERSION } from "./version";
import type {
	AiraPromptMode,
	ComposedAiraPrompt,
	ComposePromptInput,
} from "./types";

/**
 * Maps specialist roles to concise operational charters.
 */
export const SPECIALIST_ROLE_CHARTERS: Record<string, string> = {
	PRODUCT: "Charter: Deconstruct the goal into explicit, testable requirements, constraints, and verifiable deliverables.",
	RESEARCH: "Charter: Conduct empirical research, evaluate source authority, synthesize conflicting findings, and cite evidence.",
	ARCHITECT: "Charter: Formulate minimal, robust system designs, contracts, and interfaces that preserve working behavior.",
	UI_UX: "Charter: Design truthful information hierarchies, accessible interactions, responsive layouts, and zero fake UI.",
	FRONTEND: "Charter: Implement responsive, accessible UI components in clean isolated branches with true state binding.",
	BACKEND: "Charter: Implement type-safe server endpoints, resilient integrations, and fail-closed security boundaries.",
	DATABASE: "Charter: Design additive, non-destructive schemas, optimized queries, and strict tenant isolation.",
	SECURITY: "Charter: Adversarially evaluate trust boundaries, injection resilience, auth scopes, and secret safety.",
	INTEGRATOR: "Charter: Reconcile parallel branch outputs, execute quality gates, and verify conflict-free integration.",
	QA: "Charter: Author and execute behavioral test suites with empirical evidence for all pass/fail assertions.",
	BROWSER: "Charter: Execute scoped browser interactions, validate visual/functional correctness, and capture state.",
	DEVOPS: "Charter: Configure reproducible deployment pipelines, resource budgets, and infrastructure guardrails.",
	VERIFICATION: "Charter: Independently audit completed deliverables against acceptance criteria using strict empirical evidence.",
	GENERAL: "Charter: Execute assigned tasks methodically, preserve constraints, and return concrete proof-of-work.",
};

export const TRUST_ORDER = [
	"1. Aira Identity",
	"2. Global Truthfulness & Evidence Invariant",
	"3. Operational Safety & Privacy",
	"4. Prompt Injection Defense",
	"5. Tool Trust Model",
	"6. Tone & Behavior",
	"7. Active Mode Policy",
	"8. Enabled Capabilities",
	"9. Safe Runtime Environment",
	"10. Specialist Role Charter",
] as const;

/**
 * Estimates token count using standard 4 characters per token heuristic.
 */
export function estimateTokenCount(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

/**
 * Canonical Composer for AIRA AI System Prompts.
 *
 * Deterministically constructs the system prompt according to the strict Trust Order:
 * 1. Aira Identity
 * 2. Truthfulness & Evidence
 * 3. Operational Safety & Privacy
 * 4. Prompt Injection Defense
 * 5. Tool Trust Model
 * 6. Tone & Behavior
 * 7. Active Mode Policy
 * 8. Enabled Capabilities (only those actively requested)
 * 9. Safe Runtime Environment (sanitized, zero secret leakage)
 * 10. Specialist Role Charter (if agent role provided)
 *
 * Untrusted data (retrieved files, memory, search results, tool output) must
 * NEVER be concatenated into this system prompt.
 */
export function composeAiraSystemPrompt(input: ComposePromptInput): ComposedAiraPrompt {
	// Guard against accidental secret leakage into runtime context
	if (input.runtimeContext) {
		assertNoSecretMaterial(input.runtimeContext);
	}

	const enabledLayers: string[] = [];
	const sections: string[] = [];

	// 1. Identity
	sections.push(AIRA_CORE_IDENTITY);
	enabledLayers.push("core.identity");

	// 2. Truthfulness
	sections.push(AIRA_GLOBAL_TRUTHFULNESS);
	enabledLayers.push("core.truthfulness");

	// 3. Safety & Privacy
	sections.push(AIRA_CORE_SAFETY);
	sections.push(AIRA_PRIVACY_AND_CONFIDENTIALITY);
	enabledLayers.push("core.safety", "core.privacy");

	// 4. Prompt Injection Defense
	sections.push(AIRA_PROMPT_INJECTION_DEFENSE);
	enabledLayers.push("core.prompt_injection_defense");

	// 5. Tool Trust Model
	sections.push(AIRA_TOOL_TRUST_MODEL);
	enabledLayers.push("core.tool_trust");

	// 6. Tone & Behavior
	sections.push(AIRA_TONE_AND_STYLE);
	sections.push(AIRA_CORE_BEHAVIOR);
	enabledLayers.push("core.tone", "core.behavior");

	// 7. Active Mode Policy
	const mode: AiraPromptMode = input.mode ?? input.runtimeContext?.mode ?? "chat";
	switch (mode) {
		case "research":
			sections.push(AIRA_MODE_RESEARCH);
			enabledLayers.push("mode.research");
			break;
		case "work":
			sections.push(AIRA_MODE_WORK);
			enabledLayers.push("mode.work");
			break;
		case "agent":
			sections.push(AIRA_MODE_AGENT);
			enabledLayers.push("mode.agent");
			break;
		case "compare":
			sections.push(AIRA_MODE_COMPARE);
			enabledLayers.push("mode.compare");
			break;
		case "chat":
		default:
			sections.push(AIRA_MODE_CHAT);
			enabledLayers.push("mode.chat");
			break;
	}

	// 8. Enabled Capabilities (Conditional loading)
	const caps = input.capabilities ?? {};
	const capabilitySections: string[] = [];

	if (caps.web ?? input.runtimeContext?.webEnabled ?? false) {
		capabilitySections.push(AIRA_CAPABILITY_WEB);
		enabledLayers.push("capability.web");
	}
	if (caps.knowledge ?? input.runtimeContext?.knowledgeEnabled ?? false) {
		capabilitySections.push(AIRA_CAPABILITY_KNOWLEDGE);
		enabledLayers.push("capability.knowledge");
	}
	if (caps.memory ?? input.runtimeContext?.memoryEnabled ?? false) {
		capabilitySections.push(AIRA_CAPABILITY_MEMORY);
		enabledLayers.push("capability.memory");
	}
	if (caps.files ?? false) {
		capabilitySections.push(AIRA_CAPABILITY_FILES);
		enabledLayers.push("capability.files");
	}
	if (caps.tools ?? (input.runtimeContext?.authorizedTools && input.runtimeContext.authorizedTools.length > 0) ?? false) {
		capabilitySections.push(AIRA_CAPABILITY_TOOLS);
		enabledLayers.push("capability.tools");
	}
	if (caps.connectors ?? (input.runtimeContext?.availableConnectors && input.runtimeContext.availableConnectors.length > 0) ?? false) {
		capabilitySections.push(AIRA_CAPABILITY_CONNECTORS);
		enabledLayers.push("capability.connectors");
	}

	if (capabilitySections.length > 0) {
		sections.push("## Active Capabilities\n" + capabilitySections.join("\n\n"));
	}

	// 9. Safe Runtime Environment
	if (input.runtimeContext) {
		const formattedRuntime = formatSafeRuntimeContext(input.runtimeContext);
		sections.push(formattedRuntime);
		enabledLayers.push("runtime.context");
	}

	// 10. Specialist Role Charter (if agentRole supplied)
	const role = input.agentRole ?? input.runtimeContext?.agentRole;
	if (role) {
		const charter = SPECIALIST_ROLE_CHARTERS[role.toUpperCase()] ?? `Charter: ${role}`;
		sections.push(`## Assigned Specialist Role: ${role}\n${charter}`);
		enabledLayers.push(`role.${role.toLowerCase()}`);
	}

	// Custom trusted instructions (if explicitly configured by system administrators, e.g. prompt modifiers)
	if (input.customInstructions?.trim()) {
		sections.push(`## Administrator Policy Directives\n${input.customInstructions.trim()}`);
		enabledLayers.push("custom.directives");
	}

	const systemPrompt = sections.join("\n\n");
	const estimatedTokens = estimateTokenCount(systemPrompt);

	return {
		version: AIRA_SYSTEM_PROMPT_VERSION,
		systemPrompt,
		developerPrompt: input.targetProvider === "openai" ? systemPrompt : undefined,
		enabledLayers,
		estimatedTokens,
		trustOrder: TRUST_ORDER,
	};
}
