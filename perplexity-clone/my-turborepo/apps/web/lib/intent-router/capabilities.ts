import type { Risk, SideEffect } from "./contract";

export type CapabilityProvider = "NATIVE_AIRA" | "TOOL_GATEWAY" | "AUTOMATION_ENGINE" | "WORK_PLATFORM";

export interface CapabilityDefinition {
	readonly id: string;
	readonly provider: CapabilityProvider;
	readonly sideEffect: SideEffect;
	readonly risk: Risk;
	readonly requiresApproval: boolean;
	readonly aliases?: readonly string[];
}

const definitions: readonly CapabilityDefinition[] = [
	{ id: "answer.generate", provider: "NATIVE_AIRA", sideEffect: "NONE", risk: "READ_ONLY", requiresApproval: false },
	{ id: "research.web_search", provider: "NATIVE_AIRA", sideEffect: "READ", risk: "READ_ONLY", requiresApproval: false },
	{ id: "research.deep_research", provider: "NATIVE_AIRA", sideEffect: "READ", risk: "READ_ONLY", requiresApproval: false },
	{ id: "email.read", provider: "TOOL_GATEWAY", sideEffect: "READ", risk: "READ_ONLY", requiresApproval: false },
	{ id: "email.search", provider: "TOOL_GATEWAY", sideEffect: "READ", risk: "READ_ONLY", requiresApproval: false },
	{ id: "email.draft", provider: "TOOL_GATEWAY", sideEffect: "WRITE", risk: "LOW", requiresApproval: false },
	{ id: "email.send", provider: "TOOL_GATEWAY", sideEffect: "SEND", risk: "HIGH", requiresApproval: true },
	{ id: "calendar.read", provider: "TOOL_GATEWAY", sideEffect: "READ", risk: "READ_ONLY", requiresApproval: false },
	{ id: "calendar.create", provider: "TOOL_GATEWAY", sideEffect: "WRITE", risk: "MEDIUM", requiresApproval: true },
	{ id: "drive.search", provider: "TOOL_GATEWAY", sideEffect: "READ", risk: "READ_ONLY", requiresApproval: false },
	{ id: "drive.read", provider: "TOOL_GATEWAY", sideEffect: "READ", risk: "READ_ONLY", requiresApproval: false },
	{ id: "drive.write", provider: "TOOL_GATEWAY", sideEffect: "WRITE", risk: "MEDIUM", requiresApproval: true },
	{ id: "crm.lead.search", provider: "TOOL_GATEWAY", sideEffect: "READ", risk: "READ_ONLY", requiresApproval: false },
	{ id: "crm.lead.enrich", provider: "TOOL_GATEWAY", sideEffect: "READ", risk: "LOW", requiresApproval: false },
	{ id: "crm.contact.create", provider: "TOOL_GATEWAY", sideEffect: "WRITE", risk: "HIGH", requiresApproval: true },
	{ id: "crm.contact.update", provider: "TOOL_GATEWAY", sideEffect: "WRITE", risk: "HIGH", requiresApproval: true },
	{ id: "support.classify", provider: "NATIVE_AIRA", sideEffect: "READ", risk: "READ_ONLY", requiresApproval: false },
	{ id: "slack.send", provider: "TOOL_GATEWAY", sideEffect: "SEND", risk: "HIGH", requiresApproval: true },
	{ id: "content.publish", provider: "TOOL_GATEWAY", sideEffect: "PUBLISH", risk: "HIGH", requiresApproval: true },
	{ id: "resource.delete", provider: "TOOL_GATEWAY", sideEffect: "DELETE", risk: "CRITICAL", requiresApproval: true },
	{ id: "finance.transfer", provider: "TOOL_GATEWAY", sideEffect: "FINANCIAL", risk: "CRITICAL", requiresApproval: true },
	{ id: "automation.create", provider: "AUTOMATION_ENGINE", sideEffect: "WRITE", risk: "MEDIUM", requiresApproval: true },
	{ id: "automation.run", provider: "AUTOMATION_ENGINE", sideEffect: "WRITE", risk: "HIGH", requiresApproval: true },
	{ id: "agent.plan", provider: "WORK_PLATFORM", sideEffect: "WRITE", risk: "MEDIUM", requiresApproval: true },
	{ id: "agent.launch", provider: "WORK_PLATFORM", sideEffect: "WRITE", risk: "HIGH", requiresApproval: true },
];

export const CAPABILITY_REGISTRY = new Map<string, CapabilityDefinition>(definitions.map((definition) => [definition.id, definition]));

const aliases = new Map<string, string>();
for (const definition of definitions) {
	aliases.set(definition.id.toLowerCase(), definition.id);
	for (const alias of definition.aliases ?? []) aliases.set(alias.toLowerCase(), definition.id);
}

export function normalizeCapabilities(capabilities: readonly string[]): string[] {
	return [...new Set(capabilities.map((capability) => aliases.get(capability.trim().toLowerCase()) ?? capability.trim().toLowerCase()).filter(Boolean))].sort();
}

export function unavailableCapabilities(required: readonly string[], available?: ReadonlySet<string>): string[] {
	if (!available) return [];
	const normalizedAvailable = new Set(normalizeCapabilities([...available]));
	return normalizeCapabilities(required).filter((capability) => !normalizedAvailable.has(capability));
}
