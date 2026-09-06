export const TOOL_PERMISSION_CLASSES = [
	"READ",
	"WRITE",
	"EXTERNAL_COMMUNICATION",
	"BROWSER_ACTION",
	"CODE_EXECUTION",
	"ACCOUNT_MUTATION",
	"DESTRUCTIVE",
	"HIGH_IMPACT",
] as const;

export type ToolPermissionClass = (typeof TOOL_PERMISSION_CLASSES)[number];

export const TOOL_APPROVAL_MODES = ["auto", "ask", "plan_only"] as const;
export type ToolApprovalMode = (typeof TOOL_APPROVAL_MODES)[number];

export const TOOL_AVAILABILITY_STATES = [
	"AVAILABLE",
	"CONFIGURED",
	"NOT_CONFIGURED",
	"AUTH_REQUIRED",
	"UNAVAILABLE",
	"PERMISSION_REQUIRED",
	"DEGRADED",
] as const;
export type ToolAvailabilityState = (typeof TOOL_AVAILABILITY_STATES)[number];

export type ToolInvocationDecision = "EXECUTE" | "REQUIRE_APPROVAL" | "PLAN_ONLY";

export interface ToolAvailability {
	readonly state: ToolAvailabilityState;
	readonly detail: string;
}

export interface ToolProvenance {
	readonly kind: "builtin" | "mcp";
	readonly serverId?: string;
}

export interface PublicToolDescriptor {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly category: string;
	readonly permission: ToolPermissionClass;
	readonly sideEffecting: boolean;
	readonly timeoutMs: number;
	readonly cancellable: boolean;
	readonly audit: "required" | "standard";
	readonly availability: ToolAvailability;
	readonly inputSchema?: unknown;
	readonly provenance?: ToolProvenance;
}

const AUTO_EXECUTABLE_PERMISSIONS = new Set<ToolPermissionClass>(["READ"]);

/**
 * Conservative permission policy used before any tool invocation.
 *
 * `auto` means read-only tools may execute without a prompt. Side-effecting,
 * execution, account and high-impact tools still require explicit approval.
 * `ask` requires approval for every tool invocation. `plan_only` never executes
 * directly and returns a plan/approval boundary instead.
 */
export function decideToolInvocation(
	mode: ToolApprovalMode,
	permission: ToolPermissionClass,
): ToolInvocationDecision {
	if (mode === "plan_only") return "PLAN_ONLY";
	if (mode === "ask") return "REQUIRE_APPROVAL";
	return AUTO_EXECUTABLE_PERMISSIONS.has(permission) ? "EXECUTE" : "REQUIRE_APPROVAL";
}
