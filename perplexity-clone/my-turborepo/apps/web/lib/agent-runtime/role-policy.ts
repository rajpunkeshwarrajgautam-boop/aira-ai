import type { PublicToolDescriptor, ToolPermissionClass } from "@/lib/tools/contracts";

import type { AgentRole } from "./types";

export interface AgentRolePolicy {
	readonly role: AgentRole;
	readonly purpose: string;
	readonly allowedPermissions: ReadonlySet<ToolPermissionClass>;
}

const READ_ONLY = new Set<ToolPermissionClass>(["READ"]);

export const AGENT_ROLE_POLICIES: Readonly<Record<AgentRole, AgentRolePolicy>> = {
	manager: {
		role: "manager",
		purpose: "Own the objective, coordinate specialists, and synthesize the final outcome.",
		allowedPermissions: READ_ONLY,
	},
	planner: {
		role: "planner",
		purpose: "Decompose the objective into a dependency-aware execution graph.",
		allowedPermissions: READ_ONLY,
	},
	researcher: {
		role: "researcher",
		purpose: "Collect and structure evidence with source preservation.",
		allowedPermissions: READ_ONLY,
	},
	coder: {
		role: "coder",
		purpose: "Implement and test code inside explicitly authorized execution boundaries.",
		allowedPermissions: new Set<ToolPermissionClass>(["READ", "WRITE", "CODE_EXECUTION"]),
	},
	browser_operator: {
		role: "browser_operator",
		purpose: "Observe and interact with browser surfaces under approval policy.",
		allowedPermissions: new Set<ToolPermissionClass>(["READ", "BROWSER_ACTION"]),
	},
	designer: {
		role: "designer",
		purpose: "Produce and inspect product, interaction, and visual design decisions.",
		allowedPermissions: new Set<ToolPermissionClass>(["READ", "BROWSER_ACTION"]),
	},
	analyst: {
		role: "analyst",
		purpose: "Perform quantitative and structured business or data analysis.",
		allowedPermissions: new Set<ToolPermissionClass>(["READ", "CODE_EXECUTION"]),
	},
	verifier: {
		role: "verifier",
		purpose: "Independently inspect evidence and determine whether acceptance criteria are satisfied.",
		allowedPermissions: new Set<ToolPermissionClass>(["READ", "BROWSER_ACTION"]),
	},
};

export class AgentToolCapabilityError extends Error {
	readonly code = "AGENT_TOOL_NOT_ALLOWED";
	readonly role: AgentRole;
	readonly toolId: string;
	readonly permission: ToolPermissionClass;

	constructor(role: AgentRole, descriptor: PublicToolDescriptor) {
		super(`${role} is not allowed to use ${descriptor.id} (${descriptor.permission}).`);
		this.name = "AgentToolCapabilityError";
		this.role = role;
		this.toolId = descriptor.id;
		this.permission = descriptor.permission;
	}
}

export function roleCanUseTool(role: AgentRole, descriptor: PublicToolDescriptor): boolean {
	return AGENT_ROLE_POLICIES[role].allowedPermissions.has(descriptor.permission);
}

export function assertRoleCanUseTool(role: AgentRole, descriptor: PublicToolDescriptor): void {
	if (!roleCanUseTool(role, descriptor)) {
		throw new AgentToolCapabilityError(role, descriptor);
	}
}
