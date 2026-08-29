import type { RiskClass } from "@/lib/agent-platform/types";

export type AiraToolId =
	| "browser"
	| "terminal"
	| "git"
	| "files"
	| "memory"
	| "web"
	| "github"
	| "vercel"
	| "supabase"
	| "mcp";

export type ToolCallSource = "AGENT" | "USER" | "SYSTEM";
export type ToolCallStatus =
	| "PENDING"
	| "APPROVAL_REQUIRED"
	| "EXECUTING"
	| "COMPLETED"
	| "FAILED"
	| "DENIED"
	| "CANCELLED";

export interface ToolContext {
	readonly userId: string;
	readonly projectId: string;
	readonly runId: string;
	readonly taskId?: string | null;
	readonly agentId?: string | null;
	readonly source: ToolCallSource;
}

export interface ToolExecutionRequest {
	readonly clientRequestId: string;
	readonly tool: AiraToolId;
	readonly action: string;
	readonly input: Record<string, unknown>;
	readonly approvalId?: string;
}

export interface UsageDelta {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cachedTokens?: number;
	readonly costUsd?: number;
	readonly toolCalls?: number;
	readonly costKnown?: boolean;
}

export interface ToolAdapterResult {
	readonly result: Record<string, unknown>;
	readonly usage?: UsageDelta;
}

export interface ToolAdapter {
	readonly id: AiraToolId;
	isAvailable(): Promise<boolean>;
	execute(
		context: ToolContext,
		action: string,
		input: Record<string, unknown>,
	): Promise<ToolAdapterResult>;
}

export type ToolExecutionResult =
	| {
		readonly status: "COMPLETED";
		readonly toolCallId: string;
		readonly result: Record<string, unknown>;
		readonly usage: UsageDelta;
	}
	| {
		readonly status: "APPROVAL_REQUIRED";
		readonly toolCallId: string;
		readonly approvalId: string;
		readonly risk: RiskClass;
	}
	| {
		readonly status: "DENIED";
		readonly toolCallId: string;
		readonly risk: RiskClass;
		readonly reason: string;
	};

export class ToolGatewayError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;

	constructor(options: {
		readonly code: string;
		readonly message: string;
		readonly status?: number;
		readonly retryable?: boolean;
	}) {
		super(options.message);
		this.name = "ToolGatewayError";
		this.code = options.code;
		this.status = options.status ?? 500;
		this.retryable = options.retryable ?? false;
	}
}
