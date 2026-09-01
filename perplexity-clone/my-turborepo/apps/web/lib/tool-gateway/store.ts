import { APPROVAL_TTL_MINUTES } from "@/lib/agent-platform/approval-expiry";
import { prisma } from "@/lib/prisma";

import type { RiskClass } from "@/lib/agent-platform/types";
import type { AiraToolId, ToolCallStatus, ToolContext, UsageDelta } from "./types";
import { ToolGatewayError } from "./types";

export interface StoredToolCall {
	readonly id: string;
	readonly clientRequestId: string;
	readonly userId: string;
	readonly projectId: string;
	readonly runId: string;
	readonly taskId: string | null;
	readonly agentId: string | null;
	readonly tool: string;
	readonly action: string;
	readonly risk: RiskClass;
	readonly status: ToolCallStatus;
	readonly approvalId: string | null;
	readonly inputHash: string;
	readonly inputSummary: Record<string, unknown>;
	readonly resultSummary: Record<string, unknown> | null;
	readonly usage: Record<string, unknown>;
	readonly errorCode: string | null;
}

class ApprovalBindingLost extends Error {}

function jsonObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function row(value: StoredToolCall): StoredToolCall {
	return {
		...value,
		inputSummary: jsonObject(value.inputSummary),
		resultSummary: value.resultSummary ? jsonObject(value.resultSummary) : null,
		usage: jsonObject(value.usage),
	};
}

export async function assertToolContextOwnership(context: ToolContext): Promise<void> {
	const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
		select exists(
			select 1
			from "AgentPlatformRun" r
			join "AgentProject" p on p."id"=r."projectId"
			where r."id"=${context.runId}
			  and r."projectId"=${context.projectId}
			  and r."userId"=${context.userId}
			  and p."userId"=${context.userId}
			  and (${context.taskId ?? null}::text is null or exists(
				select 1 from "AgentTask" t
				where t."id"=${context.taskId ?? null} and t."runId"=r."id" and t."projectId"=p."id"
			  ))
			  and (${context.agentId ?? null}::text is null or exists(
				select 1 from "AgentInstance" a
				where a."id"=${context.agentId ?? null}
				  and a."runId"=r."id"
				  and a."projectId"=p."id"
				  and (${context.taskId ?? null}::text is null or a."currentTaskId"=${context.taskId ?? null})
			  ))
		) as ok
	`;
	if (!rows[0]?.ok) {
		throw new ToolGatewayError({
			code: "TOOL_CONTEXT_FORBIDDEN",
			message: "The requested tool context is outside this user's mission scope.",
			status: 403,
		});
	}
}

export async function getToolCallByRequest(
	userId: string,
	clientRequestId: string,
): Promise<StoredToolCall | null> {
	const rows = await prisma.$queryRaw<StoredToolCall[]>`
		select * from "AgentToolCall"
		where "userId"=${userId} and "clientRequestId"=${clientRequestId}
		limit 1
	`;
	return rows[0] ? row(rows[0]) : null;
}

export async function createToolCall(input: {
	readonly context: ToolContext;
	readonly clientRequestId: string;
	readonly tool: AiraToolId;
	readonly action: string;
	readonly risk: RiskClass;
	readonly inputHash: string;
	readonly inputSummary: Record<string, unknown>;
}): Promise<StoredToolCall> {
	const id = crypto.randomUUID();
	try {
		const rows = await prisma.$queryRaw<StoredToolCall[]>`
			insert into "AgentToolCall" (
				"id","clientRequestId","userId","projectId","runId","taskId","agentId",
				"tool","action","risk","inputHash","inputSummary"
			) values (
				${id},${input.clientRequestId},${input.context.userId},${input.context.projectId},
				${input.context.runId},${input.context.taskId ?? null},${input.context.agentId ?? null},
				${input.tool},${input.action},${input.risk},${input.inputHash},${JSON.stringify(input.inputSummary)}::jsonb
			)
			returning *
		`;
		return row(rows[0]!);
	} catch (error) {
		const existing = await getToolCallByRequest(input.context.userId, input.clientRequestId);
		if (existing) return existing;
		throw error;
	}
}

export async function createToolApproval(input: {
	readonly context: ToolContext;
	readonly toolCallId: string;
	readonly action: string;
	readonly risk: RiskClass;
	readonly inputHash: string;
	readonly summary: Record<string, unknown>;
}): Promise<string> {
	const approvalId = crypto.randomUUID();
	try {
		return await prisma.$transaction(async (tx) => {
			await tx.$executeRaw`
				insert into "AgentApproval" (
					"id","userId","projectId","runId","taskId","action","risk","context"
				) values (
					${approvalId},${input.context.userId},${input.context.projectId},${input.context.runId},
					${input.context.taskId ?? null},${input.action},${input.risk},
					${JSON.stringify({ toolCallId: input.toolCallId, inputHash: input.inputHash, ...input.summary })}::jsonb
				)
			`;
			const bound = await tx.$queryRaw<Array<{ approvalId: string | null }>>`
				update "AgentToolCall"
				set "status"='APPROVAL_REQUIRED', "approvalId"=${approvalId}
				where "id"=${input.toolCallId}
				  and "userId"=${input.context.userId}
				  and "inputHash"=${input.inputHash}
				  and "status"='PENDING'
				  and "approvalId" is null
				returning "approvalId"
			`;
			if (bound[0]?.approvalId !== approvalId) {
				// Throwing from the interactive transaction rolls the speculative
				// approval insert back. A concurrent caller may have bound the
				// canonical approval while this transaction waited on the ToolCall.
				throw new ApprovalBindingLost();
			}
			return approvalId;
		});
	} catch (error) {
		if (!(error instanceof ApprovalBindingLost)) throw error;
		const existing = await prisma.$queryRaw<Array<{ approvalId: string | null }>>`
			select "approvalId"
			from "AgentToolCall"
			where "id"=${input.toolCallId}
			  and "userId"=${input.context.userId}
			  and "inputHash"=${input.inputHash}
			  and "status"='APPROVAL_REQUIRED'
			limit 1
		`;
		if (existing[0]?.approvalId) return existing[0].approvalId;
		throw new ToolGatewayError({
			code: "TOOL_APPROVAL_STATE_CONFLICT",
			message: "The tool request changed state while approval was being created.",
			status: 409,
			retryable: true,
		});
	}
}

export async function isToolApprovalApproved(
	userId: string,
	toolCallId: string,
	approvalId: string,
	inputHash: string,
): Promise<boolean> {
	const rows = await prisma.$queryRaw<Array<{ approved: boolean; expired: boolean }>>`
		select
			exists(
				select 1 from "AgentApproval" a
				join "AgentToolCall" c on c."approvalId"=a."id"
				where a."id"=${approvalId}
				  and c."id"=${toolCallId}
				  and a."userId"=${userId}
				  and c."userId"=${userId}
				  and c."inputHash"=${inputHash}
				  and a."status"='APPROVED'
				  and a."context"->>'inputHash'=${inputHash}
				  and a."createdAt" >= current_timestamp - (${APPROVAL_TTL_MINUTES} * interval '1 minute')
			) as approved,
			exists(
				select 1 from "AgentApproval" a
				join "AgentToolCall" c on c."approvalId"=a."id"
				where a."id"=${approvalId}
				  and c."id"=${toolCallId}
				  and a."userId"=${userId}
				  and c."userId"=${userId}
				  and c."inputHash"=${inputHash}
				  and a."context"->>'inputHash'=${inputHash}
				  and a."status"='APPROVED'
				  and a."createdAt" < current_timestamp - (${APPROVAL_TTL_MINUTES} * interval '1 minute')
			) as expired
	`;
	if (rows[0]?.expired) {
		await prisma.$executeRaw`
			update "AgentApproval"
			set "status"='EXPIRED', "resolvedAt"=coalesce("resolvedAt", current_timestamp)
			where "id"=${approvalId} and "userId"=${userId} and "status"='APPROVED'
		`;
		throw new ToolGatewayError({
			code: "TOOL_APPROVAL_EXPIRED",
			message: "This tool approval expired. Start a fresh request and obtain a new approval before executing the action.",
			status: 409,
		});
	}
	return Boolean(rows[0]?.approved);
}

/** Atomically reserves one mission tool call before side effects begin. */
export async function reserveToolBudget(runId: string): Promise<void> {
	const rows = await prisma.$queryRaw<Array<{ toolCallsUsed: number }>>`
		update "AgentPlatformRun"
		set "toolCallsUsed"="toolCallsUsed"+1, "updatedAt"=current_timestamp
		where "id"=${runId}
		  and "status" not in ('COMPLETED','FAILED','CANCELLED')
		  and "toolCallsUsed" < coalesce(("budgets"->>'maxToolCalls')::integer, 0)
		returning "toolCallsUsed"
	`;
	if (!rows[0]) {
		throw new ToolGatewayError({
			code: "MISSION_TOOL_BUDGET_EXHAUSTED",
			message: "This mission has reached its tool-call budget.",
			status: 409,
		});
	}
}

export async function claimToolCallForExecution(input: {
	readonly userId: string;
	readonly toolCallId: string;
	readonly inputHash: string;
	readonly approvalSatisfied: boolean;
}): Promise<boolean> {
	const rows = await prisma.$queryRaw<Array<{ id: string }>>`
		update "AgentToolCall"
		set "status"='EXECUTING', "startedAt"=coalesce("startedAt", current_timestamp)
		where "id"=${input.toolCallId}
		  and "userId"=${input.userId}
		  and "inputHash"=${input.inputHash}
		  and (
			"status"='PENDING'
			or ("status"='APPROVAL_REQUIRED' and ${input.approvalSatisfied})
		  )
		returning "id"
	`;
	return Boolean(rows[0]);
}

export async function completeToolCall(input: {
	readonly toolCallId: string;
	readonly result: Record<string, unknown>;
	readonly usage: UsageDelta;
}): Promise<boolean> {
	// The parent-run accounting must be causally bound to the terminal state
	// transition. A delivery replay can find an already completed call, but it
	// must not charge the mission a second time.
	const rows = await prisma.$queryRaw<Array<{ id: string }>>`
		with completed as (
			update "AgentToolCall"
			set "status"='COMPLETED', "resultSummary"=${JSON.stringify(input.result)}::jsonb,
				"usage"=${JSON.stringify(input.usage)}::jsonb, "completedAt"=current_timestamp
			where "id"=${input.toolCallId} and "status"='EXECUTING'
			returning "runId"
		)
		update "AgentPlatformRun" r
		set "inputTokensUsed"="inputTokensUsed"+${Math.max(0, Math.trunc(input.usage.inputTokens ?? 0))}::bigint,
			"outputTokensUsed"="outputTokensUsed"+${Math.max(0, Math.trunc(input.usage.outputTokens ?? 0))}::bigint,
			"cachedTokensUsed"="cachedTokensUsed"+${Math.max(0, Math.trunc(input.usage.cachedTokens ?? 0))}::bigint,
			"knownCostUsd"="knownCostUsd"+${Math.max(0, input.usage.costUsd ?? 0)}::numeric,
			"costAccountingComplete"="costAccountingComplete" and ${input.usage.costKnown === true},
			"updatedAt"=current_timestamp
		from completed c
		where r."id"=c."runId"
		returning c."id" as "id"
	`;
	return Boolean(rows[0]);
}

export async function failToolCall(
	toolCallId: string,
	code: string,
	status: "FAILED" | "DENIED" = "FAILED",
): Promise<void> {
	await prisma.$executeRaw`
		update "AgentToolCall"
		set "status"=${status}, "errorCode"=${code.slice(0, 120)}, "completedAt"=current_timestamp
		where "id"=${toolCallId} and "status" not in ('COMPLETED','DENIED','CANCELLED')
	`;
}

/**
 * An adapter may have completed an external action even when its durable
 * completion transaction fails. Keep the call executing, but persist a
 * recovery marker so retries cannot silently create a second side effect.
 */
export async function markToolCallOutcomeUnknown(toolCallId: string): Promise<void> {
	await prisma.$executeRaw`
		update "AgentToolCall"
		set "errorCode"='TOOL_COMPLETION_OUTCOME_UNKNOWN'
		where "id"=${toolCallId} and "status"='EXECUTING'
	`;
}

export async function readMissionUsage(runId: string): Promise<{
	toolCallsUsed: number;
	inputTokensUsed: bigint;
	outputTokensUsed: bigint;
	cachedTokensUsed: bigint;
	knownCostUsd: string;
	costAccountingComplete: boolean;
	budgets: Record<string, unknown>;
} | null> {
	const rows = await prisma.$queryRaw<Array<{
		toolCallsUsed: number;
		inputTokensUsed: bigint;
		outputTokensUsed: bigint;
		cachedTokensUsed: bigint;
		knownCostUsd: unknown;
		costAccountingComplete: boolean;
		budgets: unknown;
	}>>`
		select "toolCallsUsed","inputTokensUsed","outputTokensUsed","cachedTokensUsed",
			"knownCostUsd","costAccountingComplete","budgets"
		from "AgentPlatformRun" where "id"=${runId} limit 1
	`;
	const value = rows[0];
	if (!value) return null;
	return {
		...value,
		knownCostUsd: String(value.knownCostUsd ?? "0"),
		budgets: jsonObject(value.budgets),
	};
}
