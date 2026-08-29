export const AGENT_ROLES = [
	"manager",
	"planner",
	"researcher",
	"coder",
	"browser_operator",
	"designer",
	"analyst",
	"verifier",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export const RUNTIME_TASK_STATUSES = [
	"pending",
	"ready",
	"running",
	"waiting_for_tool",
	"waiting_for_approval",
	"blocked",
	"verifying",
	"retrying",
	"completed",
	"failed",
	"cancelled",
] as const;

export type RuntimeTaskStatus = (typeof RUNTIME_TASK_STATUSES)[number];

export interface RuntimeTask {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly role: AgentRole;
	readonly dependsOn: readonly string[];
	readonly status: RuntimeTaskStatus;
	readonly priority?: number;
	readonly attempt: number;
	readonly maxAttempts?: number;
	readonly delegationDepth: number;
	readonly blockedReason?: string;
}

export interface TaskGraph {
	readonly tasks: readonly RuntimeTask[];
}

export interface ExecutionBudget {
	readonly maxConcurrentAgents: number;
	readonly maxDelegationDepth: number;
	readonly maxRetriesPerTask: number;
	readonly maxToolCalls: number;
	readonly maxTokens: number;
	readonly maxEstimatedCostUsd: number;
	readonly maxRuntimeMs: number;
	readonly maxRepeatedActions: number;
}

export interface ExecutionUsage {
	readonly startedAtMs: number;
	readonly activeAgents: number;
	readonly toolCalls: number;
	readonly tokens: number;
	readonly estimatedCostUsd: number;
}

export type BudgetLimit =
	| "runtime"
	| "tool_calls"
	| "tokens"
	| "estimated_cost"
	| "delegation_depth"
	| "retries"
	| "repeated_action";

export interface BudgetViolation {
	readonly limit: BudgetLimit;
	readonly message: string;
	readonly current: number;
	readonly maximum: number;
}

export interface SchedulerDecision {
	readonly graph: TaskGraph;
	readonly startedTaskIds: readonly string[];
	readonly blockedTaskIds: readonly string[];
	readonly failedTaskIds: readonly string[];
	readonly budgetViolations: readonly BudgetViolation[];
}

export interface ActionLoopGuardState {
	readonly maxRepeatedActions: number;
	readonly counts: Readonly<Record<string, number>>;
}

export interface ActionLoopGuardResult {
	readonly state: ActionLoopGuardState;
	readonly blocked: boolean;
	readonly count: number;
}

export const DEFAULT_EXECUTION_BUDGET: Readonly<ExecutionBudget> = Object.freeze({
	maxConcurrentAgents: 4,
	maxDelegationDepth: 4,
	maxRetriesPerTask: 2,
	maxToolCalls: 100,
	maxTokens: 250_000,
	maxEstimatedCostUsd: 25,
	maxRuntimeMs: 30 * 60 * 1_000,
	maxRepeatedActions: 3,
});

export const TERMINAL_TASK_STATUSES: ReadonlySet<RuntimeTaskStatus> = new Set([
	"completed",
	"failed",
	"cancelled",
]);
