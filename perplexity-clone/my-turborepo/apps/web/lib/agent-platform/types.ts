export type PlatformRunStatus =
	| "PLANNING"
	| "RUNNING"
	| "WAITING"
	| "BLOCKED"
	| "APPROVAL_REQUIRED"
	| "COMPLETED"
	| "FAILED"
	| "CANCELLED";

export type PlatformTaskStatus =
	| "QUEUED"
	| "READY"
	| "CLAIMED"
	| "RUNNING"
	| "WAITING"
	| "BLOCKED"
	| "APPROVAL_REQUIRED"
	| "COMPLETED"
	| "FAILED"
	| "CANCELLED";

export type AgentModelTier = "fast" | "balanced" | "reasoning" | "coding" | "vision" | "long-context" | "local";
export type RiskClass = "LOW" | "MEDIUM" | "HIGH" | "PROTECTED";
export type BrowserMode = "OBSERVE" | "ASSISTED" | "AUTONOMOUS";

export interface RunBudgets {
	readonly maxAgents: number;
	readonly maxParallelAgents: number;
	readonly maxToolCalls: number;
	readonly maxTokens: number;
	readonly maxCostUsd: number;
	readonly maxDurationMinutes: number;
	readonly maxRetries: number;
}

/**
 * The managed builder DAG uses up to 13 specialist tasks when deployment is
 * requested. Keep the default above that number so verification is never
 * silently truncated by a resource budget. maxParallelAgents is the primary
 * concurrency control; maxAgents is a hard mission ceiling.
 */
export const DEFAULT_RUN_BUDGETS: RunBudgets = {
	maxAgents: 16,
	maxParallelAgents: 4,
	maxToolCalls: 160,
	maxTokens: 500_000,
	maxCostUsd: 20,
	maxDurationMinutes: 180,
	maxRetries: 2,
};

export interface AgentProject {
	readonly id: string;
	readonly userId: string;
	readonly name: string;
	readonly objective: string;
	readonly status: "ACTIVE" | "ARCHIVED";
	readonly config: Record<string, unknown>;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

export interface PlatformRun {
	readonly id: string;
	readonly projectId: string;
	readonly userId: string;
	readonly clientRequestId: string;
	readonly status: PlatformRunStatus;
	readonly runtime: string | null;
	readonly managerRole: string;
	readonly budgets: RunBudgets;
	readonly summary: string | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly startedAt: Date | null;
	readonly completedAt: Date | null;
}

export interface PlatformTask {
	readonly id: string;
	readonly projectId: string;
	readonly runId: string;
	readonly title: string;
	readonly objective: string;
	readonly status: PlatformTaskStatus;
	readonly priority: number;
	readonly agentRole: string;
	readonly modelTier: AgentModelTier;
	readonly dependencies: string[];
	readonly inputArtifacts: string[];
	readonly outputArtifacts: string[];
	readonly runtimeRunId: string | null;
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly leaseOwner: string | null;
	readonly leaseExpiresAt: Date | null;
	readonly heartbeatAt: Date | null;
	readonly lastError: string | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly startedAt: Date | null;
	readonly completedAt: Date | null;
}

export interface TaskSpec {
	readonly key: string;
	readonly title: string;
	readonly objective: string;
	readonly agentRole: string;
	readonly modelTier: AgentModelTier;
	readonly priority: number;
	readonly dependencies: readonly string[];
	readonly approval?: { readonly action: string; readonly risk: RiskClass };
}

export interface PlatformEvent {
	readonly id: string;
	readonly projectId: string;
	readonly runId: string;
	readonly taskId: string | null;
	readonly agentId: string | null;
	readonly type: string;
	readonly payload: Record<string, unknown>;
	readonly createdAt: Date;
}

export interface BrowserSessionRecord {
	readonly id: string;
	readonly userId: string;
	readonly projectId: string | null;
	readonly runId: string | null;
	readonly taskId: string | null;
	readonly mode: BrowserMode;
	readonly status: "CREATING" | "ACTIVE" | "HUMAN_CONTROL" | "PAUSED" | "ENDED" | "FAILED" | "EXPIRED";
	readonly allowedDomains: string[];
	readonly permissions: string[];
	readonly remoteSessionId: string | null;
	readonly currentUrl: string | null;
	readonly lastScreenshotUri: string | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly expiresAt: Date;
}

export interface RuntimeTickResult {
	readonly run: PlatformRun;
	readonly tasks: readonly PlatformTask[];
	readonly dispatched: number;
	readonly reconciled: number;
}
