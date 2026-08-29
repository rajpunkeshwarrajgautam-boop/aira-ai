import { appendEvent } from "@/lib/agent-platform/store";

import { browserToolAdapter, gitToolAdapter, terminalToolAdapter } from "./adapters";
import {
	classifyToolRisk,
	isAlwaysDeniedToolAction,
	requiresApproval,
} from "./policy";
import {
	assertToolContextOwnership,
	claimToolCallForExecution,
	completeToolCall,
	createToolApproval,
	createToolCall,
	failToolCall,
	getToolCallByRequest,
	isToolApprovalApproved,
	reserveToolBudget,
} from "./store";
import type {
	AiraToolId,
	ToolAdapter,
	ToolContext,
	ToolExecutionRequest,
	ToolExecutionResult,
	UsageDelta,
} from "./types";
import { ToolGatewayError } from "./types";

const adapters = new Map<AiraToolId, ToolAdapter>([
	[browserToolAdapter.id, browserToolAdapter],
	[terminalToolAdapter.id, terminalToolAdapter],
	[gitToolAdapter.id, gitToolAdapter],
]);

const SECRETISH = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i;

function safeValue(value: unknown, key = "", depth = 0): unknown {
	if (SECRETISH.test(key)) return "[redacted]";
	if (depth > 4) return "[truncated]";
	if (typeof value === "string") return value.length > 400 ? `${value.slice(0, 400)}…` : value;
	if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
	if (Array.isArray(value)) return value.slice(0, 20).map((entry) => safeValue(entry, key, depth + 1));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.slice(0, 40)
				.map(([childKey, childValue]) => [childKey, safeValue(childValue, childKey, depth + 1)]),
		);
	}
	return String(value);
}

function summary(input: Record<string, unknown>): Record<string, unknown> {
	return safeValue(input) as Record<string, unknown>;
}

function usageOrDefault(value?: UsageDelta): UsageDelta {
	return {
		inputTokens: Math.max(0, Math.trunc(value?.inputTokens ?? 0)),
		outputTokens: Math.max(0, Math.trunc(value?.outputTokens ?? 0)),
		cachedTokens: Math.max(0, Math.trunc(value?.cachedTokens ?? 0)),
		costUsd: Math.max(0, value?.costUsd ?? 0),
		toolCalls: 1,
		costKnown: value?.costKnown === true,
	};
}

export function registeredToolIds(): AiraToolId[] {
	return [...adapters.keys()];
}

export async function toolAvailability(): Promise<Record<AiraToolId, boolean>> {
	const all: AiraToolId[] = ["browser", "terminal", "git", "files", "memory", "web", "github", "vercel", "supabase", "mcp"];
	const result = Object.fromEntries(all.map((id) => [id, false])) as Record<AiraToolId, boolean>;
	await Promise.all(
		[...adapters.entries()].map(async ([id, adapter]) => {
			result[id] = await adapter.isAvailable().catch(() => false);
		}),
	);
	return result;
}

function replayStored(existing: Awaited<ReturnType<typeof getToolCallByRequest>>): ToolExecutionResult | null {
	if (!existing) return null;
	if (existing.status === "COMPLETED") {
		return {
			status: "COMPLETED",
			toolCallId: existing.id,
			result: existing.resultSummary ?? {},
			usage: existing.usage as UsageDelta,
		};
	}
	if (existing.status === "DENIED") {
		return {
			status: "DENIED",
			toolCallId: existing.id,
			risk: existing.risk,
			reason: existing.errorCode ?? "Tool action denied.",
		};
	}
	return null;
}

export async function executeTool(
	context: ToolContext,
	request: ToolExecutionRequest,
): Promise<ToolExecutionResult> {
	await assertToolContextOwnership(context);
	const adapter = adapters.get(request.tool);
	if (!adapter) {
		throw new ToolGatewayError({
			code: "TOOL_NOT_IMPLEMENTED",
			message: `${request.tool} is not available through the AIRA Tool Gateway.`,
			status: 409,
		});
	}
	if (!(await adapter.isAvailable().catch(() => false))) {
		throw new ToolGatewayError({
			code: "TOOL_UNAVAILABLE",
			message: `${request.tool} is not currently available.`,
			status: 503,
			retryable: true,
		});
	}

	const risk = classifyToolRisk(request.tool, request.action);
	let stored = await getToolCallByRequest(context.userId, request.clientRequestId);
	const replay = replayStored(stored);
	if (replay) return replay;
	if (stored && (stored.tool !== request.tool || stored.action !== request.action || stored.runId !== context.runId)) {
		throw new ToolGatewayError({ code: "TOOL_IDEMPOTENCY_CONFLICT", message: "This tool request id is already bound to a different action.", status: 409 });
	}
	if (stored?.status === "EXECUTING") {
		throw new ToolGatewayError({ code: "TOOL_ALREADY_EXECUTING", message: "This tool request is already executing.", status: 409, retryable: true });
	}
	if (stored?.status === "FAILED" || stored?.status === "CANCELLED") {
		throw new ToolGatewayError({
			code: "TOOL_RETRY_REQUIRES_NEW_REQUEST_ID",
			message: "This tool request ended without a confirmed success. Use a new request id for an explicit retry so side effects cannot be duplicated silently.",
			status: 409,
		});
	}

	if (!stored) {
		stored = await createToolCall({
			context,
			clientRequestId: request.clientRequestId,
			tool: request.tool,
			action: request.action,
			risk,
			inputSummary: summary(request.input),
		});
	}

	if (isAlwaysDeniedToolAction(request.tool, request.action)) {
		await failToolCall(stored.id, "ACTION_ALWAYS_DENIED", "DENIED");
		await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "tool.denied", payload: { tool: request.tool, action: request.action, risk } });
		return { status: "DENIED", toolCallId: stored.id, risk, reason: "This action is never executed autonomously by AIRA." };
	}

	let approvalSatisfied = false;
	if (requiresApproval(risk)) {
		if (stored.approvalId && request.approvalId === stored.approvalId) {
			approvalSatisfied = await isToolApprovalApproved(context.userId, stored.id, stored.approvalId);
		}
		if (!approvalSatisfied) {
			if (!stored.approvalId) {
				const approvalId = await createToolApproval({
					context,
					toolCallId: stored.id,
					action: `${request.tool}.${request.action}`,
					risk,
					summary: { tool: request.tool, action: request.action, input: summary(request.input) },
				});
				await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "approval.requested", payload: { approvalId, toolCallId: stored.id, tool: request.tool, action: request.action, risk } });
				return { status: "APPROVAL_REQUIRED", toolCallId: stored.id, approvalId, risk };
			}
			return { status: "APPROVAL_REQUIRED", toolCallId: stored.id, approvalId: stored.approvalId, risk };
		}
	}

	const claimed = await claimToolCallForExecution({ userId: context.userId, toolCallId: stored.id, approvalSatisfied });
	if (!claimed) {
		const latest = await getToolCallByRequest(context.userId, request.clientRequestId);
		const latestReplay = replayStored(latest);
		if (latestReplay) return latestReplay;
		throw new ToolGatewayError({ code: "TOOL_EXECUTION_STATE_CONFLICT", message: "The tool request changed state before it could execute.", status: 409, retryable: true });
	}

	try {
		await reserveToolBudget(context.runId);
		await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "tool.started", payload: { toolCallId: stored.id, tool: request.tool, action: request.action, risk } });
		const executed = await adapter.execute(context, request.action, request.input);
		const usage = usageOrDefault(executed.usage);
		const storedResult = summary(executed.result);
		await completeToolCall({ toolCallId: stored.id, result: storedResult, usage });
		await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "tool.completed", payload: { toolCallId: stored.id, tool: request.tool, action: request.action } });
		return { status: "COMPLETED", toolCallId: stored.id, result: executed.result, usage };
	} catch (error) {
		const code = error instanceof ToolGatewayError ? error.code : error instanceof Error ? error.name : "TOOL_EXECUTION_FAILED";
		await failToolCall(stored.id, code).catch(() => undefined);
		await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "tool.failed", payload: { toolCallId: stored.id, tool: request.tool, action: request.action, code } }).catch(() => undefined);
		throw error;
	}
}
