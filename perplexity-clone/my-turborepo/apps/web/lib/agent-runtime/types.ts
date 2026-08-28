import type { AgentRunDto } from "@/lib/autogpt/runs";

export type AgentRuntimeId = "DEERFLOW" | "AUTOGPT" | "AGENT_SWARM";

export interface AgentRuntimeCapabilities {
	readonly cancel: boolean;
	readonly pause: boolean;
	readonly resume: boolean;
	readonly steer: boolean;
	readonly taskGraph: boolean;
	readonly spawnAgent: boolean;
	readonly events: boolean;
	readonly artifacts: boolean;
}

export interface AgentRuntimeHealth {
	readonly id: AgentRuntimeId;
	readonly enabled: boolean;
	readonly configured: boolean;
	readonly healthy: boolean | null;
	readonly ready: boolean;
	readonly detail?: string;
	readonly capabilities: AgentRuntimeCapabilities;
}

export interface CreateAgentRunInput {
	readonly userId: string;
	readonly clientRequestId: string;
	readonly objective: string;
}

export interface AgentRunSubmission {
	readonly run: AgentRunDto;
	readonly agentRunsRemaining: number;
}

export interface AgentRuntimeEvent {
	readonly id: string;
	readonly type: string;
	readonly createdAt: string;
	readonly payload?: unknown;
}

export interface AgentRuntimeArtifact {
	readonly id: string;
	readonly name: string;
	readonly kind: string;
	readonly uri?: string;
	readonly metadata?: Record<string, unknown>;
}

/**
 * Provider-neutral execution boundary owned by AIRA.
 *
 * Implementations may wrap AIRA-native workers, DeerFlow, AutoGPT, Agent Swarm,
 * or a future execution plane. Optional methods are capability-gated; callers
 * must never infer support merely because an implementation exists.
 */
export interface AgentRuntime {
	readonly id: AgentRuntimeId;
	readonly capabilities: AgentRuntimeCapabilities;
	isEnabled(): boolean;
	isConfigured(): boolean;
	getHealth(): Promise<AgentRuntimeHealth>;
	createRun(input: CreateAgentRunInput): Promise<AgentRunSubmission>;
	refreshRun(userId: string, runId: string): Promise<AgentRunDto | null>;
	cancelRun?(userId: string, runId: string): Promise<AgentRunDto | null>;
	pauseRun?(userId: string, runId: string): Promise<AgentRunDto | null>;
	resumeRun?(userId: string, runId: string): Promise<AgentRunDto | null>;
	steerAgent?(userId: string, runId: string, instruction: string): Promise<void>;
	getEvents?(userId: string, runId: string): Promise<readonly AgentRuntimeEvent[]>;
	getArtifacts?(userId: string, runId: string): Promise<readonly AgentRuntimeArtifact[]>;
}

export class AgentRuntimeError extends Error {
	readonly code: string;
	readonly status: number;
	readonly runtimeId?: AgentRuntimeId;
	readonly retryable: boolean;

	constructor(options: {
		readonly code: string;
		readonly message: string;
		readonly status?: number;
		readonly runtimeId?: AgentRuntimeId;
		readonly retryable?: boolean;
	}) {
		super(options.message);
		this.name = "AgentRuntimeError";
		this.code = options.code;
		this.status = options.status ?? 500;
		this.runtimeId = options.runtimeId;
		this.retryable = options.retryable ?? false;
	}
}

export function unsupportedRuntimeOperation(runtimeId: AgentRuntimeId, operation: string): AgentRuntimeError {
	return new AgentRuntimeError({
		code: "RUNTIME_OPERATION_UNSUPPORTED",
		message: `${operation} is not supported by the ${runtimeId} runtime.`,
		status: 409,
		runtimeId,
	});
}
