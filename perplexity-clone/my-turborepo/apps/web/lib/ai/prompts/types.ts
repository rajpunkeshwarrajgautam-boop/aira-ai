/**
 * Canonical types for the AIRA AI System-Prompt Control Plane.
 */

export type AiraPromptMode =
	| "chat"
	| "research"
	| "work"
	| "agent"
	| "compare";

export type AiraSpecialistRole =
	| "PRODUCT"
	| "RESEARCH"
	| "ARCHITECT"
	| "UI_UX"
	| "FRONTEND"
	| "BACKEND"
	| "DATABASE"
	| "SECURITY"
	| "INTEGRATOR"
	| "QA"
	| "BROWSER"
	| "DEVOPS"
	| "VERIFICATION"
	| "GENERAL";

export interface AiraPromptRuntimeContext {
	readonly mode: AiraPromptMode;
	readonly currentDate?: string;
	readonly timezone?: string;
	readonly locale?: string;
	readonly authenticated: boolean;
	readonly userPlan?: "free" | "pro" | "enterprise";
	readonly selectedModel?: string;
	readonly selectedProvider?: string;
	readonly routingPreset?: "auto" | "fast" | "deep" | "smart";
	readonly memoryEnabled: boolean;
	readonly knowledgeEnabled: boolean;
	readonly webEnabled: boolean;
	readonly availableTools: readonly string[];
	readonly authorizedTools: readonly string[];
	readonly availableConnectors: readonly string[];
	readonly featureFlags?: Record<string, boolean>;
	readonly projectId?: string;
	readonly runId?: string;
	readonly taskId?: string;
	readonly taskTitle?: string;
	readonly agentRole?: AiraSpecialistRole | string;
	readonly objective?: string;
}

export interface PromptCapabilityConfig {
	readonly web?: boolean;
	readonly knowledge?: boolean;
	readonly memory?: boolean;
	readonly files?: boolean;
	readonly tools?: boolean;
	readonly connectors?: boolean;
}

export interface ComposePromptInput {
	readonly mode: AiraPromptMode;
	readonly runtimeContext?: Partial<AiraPromptRuntimeContext>;
	readonly capabilities?: PromptCapabilityConfig;
	readonly agentRole?: AiraSpecialistRole | string;
	readonly customInstructions?: string;
	/**
	 * Model family target to optimize prompt structure (e.g. developer message vs system message).
	 */
	readonly targetProvider?: "omniroute" | "openai" | "nvidia" | "anthropic" | "generic";
}

export interface ComposedAiraPrompt {
	readonly version: string;
	readonly systemPrompt: string;
	readonly developerPrompt?: string;
	readonly enabledLayers: readonly string[];
	readonly estimatedTokens: number;
	readonly trustOrder: readonly string[];
}

export interface SafePromptTelemetry {
	readonly promptVersion: string;
	readonly mode: AiraPromptMode;
	readonly provider: string;
	readonly model: string;
	readonly enabledLayers: readonly string[];
	readonly estimatedTokens: number;
	readonly timestamp: string;
}
