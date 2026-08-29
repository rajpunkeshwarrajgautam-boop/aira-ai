import { createHash } from "node:crypto";

import { appendEvent } from "@/lib/agent-platform/store";

import { browserToolAdapter, gitToolAdapter, terminalToolAdapter } from "./adapters";
import { githubToolAdapter, mcpToolAdapter, supabaseToolAdapter, vercelToolAdapter } from "./external-adapters";
import { filesToolAdapter, memoryToolAdapter, webToolAdapter } from "./native-adapters";
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
	[filesToolAdapter.id, filesToolAdapter],
	[memoryToolAdapter.id, memoryToolAdapter],
	[webToolAdapter.id, webToolAdapter],
	[githubToolAdapter.id, githubToolAdapter],
	[vercelToolAdapter.id, vercelToolAdapter],
	[supabaseToolAdapter.id, supabaseToolAdapter],
	[mcpToolAdapter.id, mcpToolAdapter],
]);

const SECRETISH = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|access[_-]?key|refresh[_-]?token)/i;

function boundedValue(
	value: unknown,
	options: { readonly maxString: number; readonly maxArray: number; readonly maxDepth: number },
	key = "",
	depth = 0,
): unknown {
	if (SECRETISH.test(key)) return "[redacted]";
	if (depth > options.maxDepth) return "[truncated]";
	if (typeof value === "string") return value.length > options.maxString ? `${value.slice(0, options.maxString)}…` : value;
	if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
	if (Array.isArray(value)) {
		return value.slice(0, options.maxArray).map((entry) => boundedValue(entry, options, key, depth + 1));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.slice(0, options.maxArray)
				.map(([childKey, childValue]) => [childKey, boundedValue(childValue, options, childKey, depth + 1)]),
		);
	}
	return String(value);
}

function summary(value: Record<string, unknown>): Record<string, unknown> {
	return boundedValue(value, { maxString: 400, maxArray: 20, maxDepth: 4 }) as Record<string, unknown>;
}

function sanitizedResult(value: Record<string, unknown>): Record<string, unknown> {
	return boundedValue(value, { maxString: 20_000, maxArray: 100, maxDepth: 7 }) as Record<string, unknown>;
}

function textBytes(value: unknown): number | undefined {
	return typeof value === "string" ? Buffer.byteLength(value, "utf8") : undefined;
}

/**
 * Persist only metadata needed to understand/approve the operation. Exact
 * payload binding is handled independently by inputHash, so sensitive values do
 * not need to be copied into AgentToolCall/AgentApproval records.
 */
export function auditInputSummary(
	tool: AiraToolId,
	action: string,
	input: Record<string, unknown>,
): Record<string, unknown> {
	if (tool === "browser" && ["fill", "press", "select", "submit"].includes(action)) {
		return summary({ sessionId: input.sessionId, selector: input.selector, url: input.url, textBytes: textBytes(input.text), valuePresent: input.value !== undefined, key: input.key });
	}
	if (tool === "terminal") {
		const argv = Array.isArray(input.argv) ? input.argv : [];
		return summary({ workspaceId: input.workspaceId, executable: typeof argv[0] === "string" ? argv[0] : undefined, argumentCount: Math.max(0, argv.length - 1), cwd: input.cwd, timeoutSeconds: input.timeoutSeconds });
	}
	if (tool === "files" && action === "write") {
		return summary({ workspaceId: input.workspaceId, path: input.path, contentBytes: textBytes(input.content) });
	}
	if (tool === "github" && action === "create_commit") {
		return summary({ path: input.path, message: input.message, contentBytes: textBytes(input.content) });
	}
	if (tool === "supabase" && action === "write_non_destructive") {
		const values = input.values && typeof input.values === "object" && !Array.isArray(input.values)
			? Object.keys(input.values as Record<string, unknown>).slice(0, 30)
			: [];
		return summary({ schema: input.schema, table: input.table, columns: values });
	}
	if (tool === "mcp") {
		return summary({ tool: input.tool, arguments: "[redacted-by-policy]" });
	}
	return summary(input);
}

function canonical(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
		return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
	}
	return JSON.stringify(String(value));
}

export function toolInputHash(input: Record<string, unknown>): string {
	return createHash("sha256").update(canonical(input), "utf8").digest("hex");
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
		throw new ToolGatewayError({ code: "TOOL_NOT_IMPLEMENTED", message: `${request.tool} is not available through the AIRA Tool Gateway.`, status: 409 });
	}
	if (!(await adapter.isAvailable().catch(() => false))) {
		throw new ToolGatewayError({ code: "TOOL_UNAVAILABLE", message: `${request.tool} is not currently available.`, status: 503, retryable: true });
	}

	const risk = classifyToolRisk(request.tool, request.action);
	const inputHash = toolInputHash(request.input);
	const safeInputSummary = auditInputSummary(request.tool, request.action, request.input);
	let stored = await getToolCallByRequest(context.userId, request.clientRequestId);
	if (stored && (
		stored.tool !== request.tool ||
		stored.action !== request.action ||
		stored.runId !== context.runId ||
		stored.projectId !== context.projectId ||
		stored.taskId !== (context.taskId ?? null) ||
		stored.inputHash !== inputHash
	)) {
		throw new ToolGatewayError({ code: "TOOL_IDEMPOTENCY_CONFLICT", message: "This tool request id is already bound to a different exact operation.", status: 409 });
	}
	const replay = replayStored(stored);
	if (replay) return replay;
	if (stored?.status === "EXECUTING") {
		throw new ToolGatewayError({ code: "TOOL_ALREADY_EXECUTING", message: "This tool request is already executing.", status: 409, retryable: true });
	}
	if (stored?.status === "FAILED" || stored?.status === "CANCELLED") {
		throw new ToolGatewayError({ code: "TOOL_RETRY_REQUIRES_NEW_REQUEST_ID", message: "This tool request ended without a confirmed success. Use a new request id for an explicit retry so side effects cannot be duplicated silently.", status: 409 });
	}

	if (!stored) {
		stored = await createToolCall({ context, clientRequestId: request.clientRequestId, tool: request.tool, action: request.action, risk, inputHash, inputSummary: safeInputSummary });
		if (stored.inputHash !== inputHash) {
			throw new ToolGatewayError({ code: "TOOL_IDEMPOTENCY_CONFLICT", message: "Concurrent tool request id collision detected.", status: 409 });
		}
	}

	if (isAlwaysDeniedToolAction(request.tool, request.action)) {
		await failToolCall(stored.id, "ACTION_ALWAYS_DENIED", "DENIED");
		await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "tool.denied", payload: { tool: request.tool, action: request.action, risk } });
		return { status: "DENIED", toolCallId: stored.id, risk, reason: "This action is never executed autonomously by AIRA." };
	}

	let approvalSatisfied = false;
	if (requiresApproval(risk)) {
		if (stored.approvalId && request.approvalId === stored.approvalId) {
			approvalSatisfied = await isToolApprovalApproved(context.userId, stored.id, stored.approvalId, inputHash);
		}
		if (!approvalSatisfied) {
			if (!stored.approvalId) {
				const approvalId = await createToolApproval({
					context,
					toolCallId: stored.id,
					action: `${request.tool}.${request.action}`,
					risk,
					inputHash,
					summary: { tool: request.tool, action: request.action, input: safeInputSummary },
				});
				await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "approval.requested", payload: { approvalId, toolCallId: stored.id, tool: request.tool, action: request.action, risk, inputHash } });
				return { status: "APPROVAL_REQUIRED", toolCallId: stored.id, approvalId, risk };
			}
			return { status: "APPROVAL_REQUIRED", toolCallId: stored.id, approvalId: stored.approvalId, risk };
		}
	}

	const claimed = await claimToolCallForExecution({ userId: context.userId, toolCallId: stored.id, inputHash, approvalSatisfied });
	if (!claimed) {
		const latest = await getToolCallByRequest(context.userId, request.clientRequestId);
		if (latest?.inputHash !== inputHash) throw new ToolGatewayError({ code: "TOOL_IDEMPOTENCY_CONFLICT", message: "The tool operation changed before execution.", status: 409 });
		const latestReplay = replayStored(latest);
		if (latestReplay) return latestReplay;
		throw new ToolGatewayError({ code: "TOOL_EXECUTION_STATE_CONFLICT", message: "The tool request changed state before it could execute.", status: 409, retryable: true });
	}

	try {
		await reserveToolBudget(context.runId);
		await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "tool.started", payload: { toolCallId: stored.id, tool: request.tool, action: request.action, risk, inputHash } });
		const executed = await adapter.execute(context, request.action, request.input);
		const usage = usageOrDefault(executed.usage);
		const safeResult = sanitizedResult(executed.result);
		const storedResult = summary(safeResult);
		await completeToolCall({ toolCallId: stored.id, result: storedResult, usage });
		await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "tool.completed", payload: { toolCallId: stored.id, tool: request.tool, action: request.action } });
		return { status: "COMPLETED", toolCallId: stored.id, result: safeResult, usage };
	} catch (error) {
		const code = error instanceof ToolGatewayError ? error.code : error instanceof Error ? error.name : "TOOL_EXECUTION_FAILED";
		await failToolCall(stored.id, code).catch(() => undefined);
		await appendEvent({ projectId: context.projectId, runId: context.runId, taskId: context.taskId, agentId: context.agentId, type: "tool.failed", payload: { toolCallId: stored.id, tool: request.tool, action: request.action, code } }).catch(() => undefined);
		throw error;
	}
}
