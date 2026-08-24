import type { Prisma } from "@/generated/prisma/client";
import type { AgentToolApprovalStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

import { recordAgentRunEventBestEffort } from "./run-events";

const APPROVAL_SELECT = {
	id: true,
	runId: true,
	approvalKey: true,
	toolId: true,
	permission: true,
	mode: true,
	summary: true,
	request: true,
	status: true,
	requestedAt: true,
	resolvedAt: true,
	resolverUserId: true,
} satisfies Prisma.AgentToolApprovalSelect;

type SelectedApproval = Prisma.AgentToolApprovalGetPayload<{ select: typeof APPROVAL_SELECT }>;

export interface AgentToolApprovalDto {
	readonly id: string;
	readonly runId: string;
	readonly approvalKey: string;
	readonly toolId: string;
	readonly permission: string;
	readonly mode: string;
	readonly summary: string;
	readonly request: unknown | null;
	readonly status: AgentToolApprovalStatus;
	readonly requestedAt: string;
	readonly resolvedAt: string | null;
	readonly resolverUserId: string | null;
}

export interface RequestToolApprovalOptions {
	readonly userId: string;
	readonly runId: string;
	readonly approvalKey: string;
	readonly toolId: string;
	readonly permission: string;
	readonly mode: string;
	readonly summary: string;
	readonly request?: unknown;
}

export type ResolveToolApprovalDecision = "APPROVE" | "DENY";

export class ToolApprovalError extends Error {
	readonly code: "RUN_NOT_FOUND" | "APPROVAL_NOT_FOUND" | "APPROVAL_CONFLICT";
	readonly status: number;

	constructor(
		code: "RUN_NOT_FOUND" | "APPROVAL_NOT_FOUND" | "APPROVAL_CONFLICT",
		message: string,
		status: number,
	) {
		super(message);
		this.name = "ToolApprovalError";
		this.code = code;
		this.status = status;
	}
}

function bounded(value: string, max: number): string {
	return value.trim().slice(0, max);
}

const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|secret|token|password|cookie|private[-_]?key|credential)/i;

function sanitizeApprovalValue(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
	if (depth > 4) return "[truncated]";
	if (value === null) return null;
	if (typeof value === "boolean" || typeof value === "number") return value;
	if (typeof value === "string") return value.slice(0, 1_000);
	if (Array.isArray(value)) {
		return value.slice(0, 20).map((item) => sanitizeApprovalValue(item, depth + 1) ?? null);
	}
	if (typeof value === "object") {
		const output: Record<string, Prisma.InputJsonValue> = {};
		for (const [key, child] of Object.entries(value).slice(0, 30)) {
			const safeKey = key.slice(0, 100);
			if (SECRET_KEY_PATTERN.test(safeKey)) {
				output[safeKey] = "[redacted]";
				continue;
			}
			const safeChild = sanitizeApprovalValue(child, depth + 1);
			if (safeChild !== undefined) output[safeKey] = safeChild;
		}
		return output;
	}
	return undefined;
}

function toDto(approval: SelectedApproval): AgentToolApprovalDto {
	return {
		id: approval.id,
		runId: approval.runId,
		approvalKey: approval.approvalKey,
		toolId: approval.toolId,
		permission: approval.permission,
		mode: approval.mode,
		summary: approval.summary,
		request: approval.request,
		status: approval.status,
		requestedAt: approval.requestedAt.toISOString(),
		resolvedAt: approval.resolvedAt?.toISOString() ?? null,
		resolverUserId: approval.resolverUserId,
	};
}

export async function requestToolApproval(
	options: RequestToolApprovalOptions,
): Promise<AgentToolApprovalDto> {
	const run = await prisma.agentRun.findFirst({
		where: { id: options.runId, userId: options.userId },
		select: { id: true, status: true },
	});
	if (!run) {
		throw new ToolApprovalError("RUN_NOT_FOUND", "Agent task not found.", 404);
	}

	const approvalKey = bounded(options.approvalKey, 200);
	const toolId = bounded(options.toolId, 100);
	const permission = bounded(options.permission, 50);
	const mode = bounded(options.mode, 30);
	const summary = bounded(options.summary, 800);
	if (!approvalKey || !toolId || !permission || !mode || !summary) {
		throw new Error("Tool approval metadata must not be empty.");
	}
	const request = sanitizeApprovalValue(options.request);

	const approval = await prisma.agentToolApproval.upsert({
		where: { runId_approvalKey: { runId: run.id, approvalKey } },
		create: {
			runId: run.id,
			approvalKey,
			toolId,
			permission,
			mode,
			summary,
			...(request !== undefined ? { request } : {}),
		},
		update: {},
		select: APPROVAL_SELECT,
	});

	await recordAgentRunEventBestEffort({
		runId: run.id,
		eventKey: `approval-requested:${approval.id}`,
		type: "APPROVAL_REQUESTED",
		status: run.status,
		message: `Approval requested for ${toolId}.`,
		metadata: { approvalId: approval.id, toolId, permission, mode },
	});
	return toDto(approval);
}

export async function listToolApprovals(
	userId: string,
	runId: string,
	limit = 50,
): Promise<AgentToolApprovalDto[]> {
	const approvals = await prisma.agentToolApproval.findMany({
		where: { runId, run: { userId } },
		orderBy: { requestedAt: "asc" },
		take: Math.min(100, Math.max(1, limit)),
		select: APPROVAL_SELECT,
	});
	return approvals.map(toDto);
}

export async function resolveToolApproval(
	userId: string,
	runId: string,
	approvalId: string,
	decision: ResolveToolApprovalDecision,
): Promise<AgentToolApprovalDto> {
	const desiredStatus: AgentToolApprovalStatus = decision === "APPROVE" ? "APPROVED" : "DENIED";
	const now = new Date();

	const result = await prisma.$transaction(async (tx) => {
		const current = await tx.agentToolApproval.findFirst({
			where: { id: approvalId, runId, run: { userId } },
			select: APPROVAL_SELECT,
		});
		if (!current) {
			throw new ToolApprovalError("APPROVAL_NOT_FOUND", "Approval request not found.", 404);
		}
		if (current.status !== "PENDING") {
			if (current.status === desiredStatus) return current;
			throw new ToolApprovalError(
				"APPROVAL_CONFLICT",
				`Approval was already resolved as ${current.status.toLowerCase()}.`,
				409,
			);
		}

		return tx.agentToolApproval.update({
			where: { id: current.id },
			data: {
				status: desiredStatus,
				resolvedAt: now,
				resolverUserId: userId,
			},
			select: APPROVAL_SELECT,
		});
	});

	await recordAgentRunEventBestEffort({
		runId,
		eventKey: `approval-${desiredStatus.toLowerCase()}:${result.id}`,
		type: desiredStatus === "APPROVED" ? "APPROVAL_APPROVED" : "APPROVAL_DENIED",
		message: desiredStatus === "APPROVED" ? `Approved ${result.toolId}.` : `Denied ${result.toolId}.`,
		metadata: { approvalId: result.id, toolId: result.toolId, permission: result.permission },
	});
	return toDto(result);
}

/**
 * Server-side proof used before resuming a privileged tool action. Client input
 * must never be converted directly into `approvalGranted: true`.
 */
export async function hasApprovedToolAction(
	userId: string,
	runId: string,
	approvalId: string,
	toolId: string,
): Promise<boolean> {
	const approved = await prisma.agentToolApproval.findFirst({
		where: {
			id: approvalId,
			runId,
			toolId,
			status: "APPROVED",
			run: { userId },
		},
		select: { id: true },
	});
	return Boolean(approved);
}
