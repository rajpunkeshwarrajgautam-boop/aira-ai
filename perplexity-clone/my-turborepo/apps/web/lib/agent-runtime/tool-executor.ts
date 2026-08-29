import {
	getPublicToolDescriptors,
	globalToolRegistry,
	type ToolExecutionOptions,
} from "@/lib/agents/tools/tool-registry";

import { ExecutionMeter } from "./execution-meter";
import { assertRoleCanUseTool } from "./role-policy";
import type { AgentRole } from "./types";

export class AgentToolUnavailableError extends Error {
	readonly code = "AGENT_TOOL_UNAVAILABLE";
	readonly toolId: string;

	constructor(toolId: string, detail: string) {
		super(`${toolId} is unavailable: ${detail}`);
		this.name = "AgentToolUnavailableError";
		this.toolId = toolId;
	}
}

function contextUserId(context: unknown): string | undefined {
	if (!context || typeof context !== "object") return undefined;
	const userId = (context as Record<string, unknown>).userId;
	return typeof userId === "string" && userId.trim() ? userId : undefined;
}

function stableSerialize(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
		.join(",")}}`;
}

export interface BudgetedToolInvocation<TContext = unknown> {
	readonly role: AgentRole;
	readonly toolId: string;
	readonly input: unknown;
	readonly context?: TContext;
	readonly options?: ToolExecutionOptions;
	readonly actionFingerprint?: string;
}

/**
 * The AIRA runtime never executes a second tool stack. This wrapper applies
 * agent-role and run-budget policy, then delegates to the existing canonical
 * ToolRegistry so schema validation, availability, approvals and auditing remain
 * single-sourced.
 */
export class BudgetedToolExecutor {
	readonly meter: ExecutionMeter;

	constructor(meter: ExecutionMeter) {
		this.meter = meter;
	}

	async execute<TOutput = unknown, TContext = unknown>(
		invocation: BudgetedToolInvocation<TContext>,
	): Promise<TOutput> {
		const descriptors = await getPublicToolDescriptors(contextUserId(invocation.context));
		const descriptor = descriptors.find((entry) => entry.id === invocation.toolId);
		if (!descriptor) {
			throw new AgentToolUnavailableError(invocation.toolId, "tool is not registered for this runtime context");
		}
		assertRoleCanUseTool(invocation.role, descriptor);

		if (!globalToolRegistry.getTool(invocation.toolId)) {
			throw new AgentToolUnavailableError(invocation.toolId, descriptor.availability.detail);
		}

		const fingerprint =
			invocation.actionFingerprint ??
			`${invocation.role}:${invocation.toolId}:${stableSerialize(invocation.input).slice(0, 1_500)}`;
		this.meter.beforeToolCall(fingerprint);

		return globalToolRegistry.executeTool<TOutput, TContext>(
			invocation.toolId,
			invocation.input,
			invocation.context,
			invocation.options,
		);
	}
}
