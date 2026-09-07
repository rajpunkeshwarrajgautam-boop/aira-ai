import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export interface AutomationApprovalRecord {
	id: string;
	userId: string;
	runId: string;
	routineId: string;
	nodeId: string;
	targetType: "connector" | "tool";
	targetId: string;
	action: string;
	parametersHash: string;
	riskLevel: "LOW" | "MEDIUM" | "HIGH" | "PROTECTED";
	status: "PENDING" | "APPROVED" | "DENIED" | "CONSUMED" | "EXPIRED";
	requestedAt: string;
	approvedAt?: string;
	approvedBy?: string;
	expiresAt: string;
	consumedAt?: string;
}

export class AutomationApprovalError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(code: string, message: string, status = 403) {
		super(message);
		this.name = "AutomationApprovalError";
		this.code = code;
		this.status = status;
	}
}

export function canonicalJsonStringify(obj: unknown): string {
	if (obj === null || typeof obj !== "object") {
		return JSON.stringify(obj);
	}
	if (Array.isArray(obj)) {
		return "[" + obj.map((x) => canonicalJsonStringify(x)).join(",") + "]";
	}
	const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
	const parts = sortedKeys.map((k) => {
		const val = (obj as Record<string, unknown>)[k];
		return JSON.stringify(k) + ":" + canonicalJsonStringify(val);
	});
	return "{" + parts.join(",") + "}";
}

export function computeParametersHash(params: unknown): string {
	const canonical = canonicalJsonStringify(params ?? {});
	return createHash("sha256").update(canonical).digest("hex");
}

export class AutomationApprovalStore {
	private inMemoryApprovals = new Map<string, AutomationApprovalRecord>();

	async requestApprovalAsync(input: {
		userId: string;
		runId: string;
		routineId: string;
		nodeId: string;
		targetType: "connector" | "tool";
		targetId: string;
		action: string;
		parameters: unknown;
		riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "PROTECTED";
		ttlMs?: number;
	}): Promise<AutomationApprovalRecord> {
		const id = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date();
		const ttl = input.ttlMs ?? 24 * 60 * 60 * 1000;
		const expiresAt = new Date(now.getTime() + ttl);
		const parametersHash = computeParametersHash(input.parameters);

		const record: AutomationApprovalRecord = {
			id,
			userId: input.userId,
			runId: input.runId,
			routineId: input.routineId,
			nodeId: input.nodeId,
			targetType: input.targetType,
			targetId: input.targetId,
			action: input.action,
			parametersHash,
			riskLevel: input.riskLevel ?? "HIGH",
			status: "PENDING",
			requestedAt: now.toISOString(),
			expiresAt: expiresAt.toISOString(),
		};

		if (process.env.DATABASE_URL) {
			await prisma.automationApproval.create({
				data: {
					id: record.id,
					userId: record.userId,
					runId: record.runId,
					routineId: record.routineId,
					nodeId: record.nodeId,
					targetType: record.targetType,
					targetId: record.targetId,
					action: record.action,
					parametersHash: record.parametersHash,
					riskLevel: record.riskLevel,
					status: record.status,
					requestedAt: new Date(record.requestedAt),
					expiresAt: new Date(record.expiresAt),
				},
			});
		}

		this.inMemoryApprovals.set(id, record);
		return record;
	}

	async resolveApprovalAsync(
		approvalId: string,
		decision: "APPROVE" | "DENY",
		resolverUserId: string,
	): Promise<AutomationApprovalRecord> {
		const now = new Date();

		if (process.env.DATABASE_URL) {
			const existing = await prisma.automationApproval.findUnique({
				where: { id: approvalId },
			});
			if (!existing) {
				throw new AutomationApprovalError("APPROVAL_NOT_FOUND", `Approval ${approvalId} not found.`, 404);
			}
			if (existing.status !== "PENDING") {
				throw new AutomationApprovalError("APPROVAL_CONFLICT", `Approval already resolved as ${existing.status}.`, 409);
			}
			const nextStatus = decision === "APPROVE" ? "APPROVED" : "DENIED";
			const updated = await prisma.automationApproval.update({
				where: { id: approvalId },
				data: {
					status: nextStatus,
					approvedAt: decision === "APPROVE" ? now : null,
					approvedBy: resolverUserId,
				},
			});
			const dto: AutomationApprovalRecord = {
				id: updated.id,
				userId: updated.userId,
				runId: updated.runId,
				routineId: updated.routineId,
				nodeId: updated.nodeId,
				targetType: updated.targetType as "connector" | "tool",
				targetId: updated.targetId,
				action: updated.action,
				parametersHash: updated.parametersHash,
				riskLevel: updated.riskLevel as "LOW" | "MEDIUM" | "HIGH" | "PROTECTED",
				status: updated.status as "PENDING" | "APPROVED" | "DENIED" | "CONSUMED" | "EXPIRED",
				requestedAt: updated.requestedAt.toISOString(),
				approvedAt: updated.approvedAt?.toISOString(),
				approvedBy: updated.approvedBy ?? undefined,
				expiresAt: updated.expiresAt.toISOString(),
				consumedAt: updated.consumedAt?.toISOString(),
			};
			this.inMemoryApprovals.set(approvalId, dto);
			return dto;
		}

		const existing = this.inMemoryApprovals.get(approvalId);
		if (!existing) {
			throw new AutomationApprovalError("APPROVAL_NOT_FOUND", `Approval ${approvalId} not found.`, 404);
		}
		if (existing.status !== "PENDING") {
			throw new AutomationApprovalError("APPROVAL_CONFLICT", `Approval already resolved as ${existing.status}.`, 409);
		}
		existing.status = decision === "APPROVE" ? "APPROVED" : "DENIED";
		existing.approvedAt = decision === "APPROVE" ? now.toISOString() : undefined;
		existing.approvedBy = resolverUserId;
		return existing;
	}

	async getApprovalAsync(approvalId: string): Promise<AutomationApprovalRecord | null> {
		if (process.env.DATABASE_URL) {
			const row = await prisma.automationApproval.findUnique({
				where: { id: approvalId },
			});
			if (!row) return null;
			return {
				id: row.id,
				userId: row.userId,
				runId: row.runId,
				routineId: row.routineId,
				nodeId: row.nodeId,
				targetType: row.targetType as "connector" | "tool",
				targetId: row.targetId,
				action: row.action,
				parametersHash: row.parametersHash,
				riskLevel: row.riskLevel as "LOW" | "MEDIUM" | "HIGH" | "PROTECTED",
				status: row.status as "PENDING" | "APPROVED" | "DENIED" | "CONSUMED" | "EXPIRED",
				requestedAt: row.requestedAt.toISOString(),
				approvedAt: row.approvedAt?.toISOString(),
				approvedBy: row.approvedBy ?? undefined,
				expiresAt: row.expiresAt.toISOString(),
				consumedAt: row.consumedAt?.toISOString(),
			};
		}
		return this.inMemoryApprovals.get(approvalId) ?? null;
	}

	async consumeApprovalAsync(expected: {
		approvalId: string;
		userId: string;
		runId: string;
		routineId: string;
		nodeId: string;
		targetId: string;
		action: string;
		parameters: unknown;
	}): Promise<AutomationApprovalRecord> {
		const approval = await this.getApprovalAsync(expected.approvalId);
		if (!approval) {
			throw new AutomationApprovalError("FORGED_APPROVAL", "Approval record does not exist (forged approval).", 403);
		}
		if (approval.userId !== expected.userId) {
			throw new AutomationApprovalError("APPROVAL_WRONG_USER", "Approval is bound to a different user.", 403);
		}
		if (approval.runId !== expected.runId) {
			throw new AutomationApprovalError("APPROVAL_WRONG_RUN", "Approval is bound to a different run execution.", 403);
		}
		if (approval.routineId !== expected.routineId) {
			throw new AutomationApprovalError("APPROVAL_WRONG_ROUTINE", "Approval is bound to a different routine.", 403);
		}
		if (approval.nodeId !== expected.nodeId) {
			throw new AutomationApprovalError("APPROVAL_WRONG_NODE", "Approval is bound to a different node.", 403);
		}
		if (approval.targetId !== expected.targetId) {
			throw new AutomationApprovalError("APPROVAL_WRONG_TARGET", "Approval is bound to a different connector/tool target.", 403);
		}
		if (approval.action !== expected.action) {
			throw new AutomationApprovalError("APPROVAL_WRONG_ACTION", "Approval is bound to a different action.", 403);
		}

		const expectedHash = computeParametersHash(expected.parameters);
		if (approval.parametersHash !== expectedHash) {
			throw new AutomationApprovalError("APPROVAL_PARAMETERS_MUTATED", "Approval parameter hash mismatch: action parameters were changed.", 403);
		}

		if (new Date(approval.expiresAt).getTime() <= Date.now()) {
			throw new AutomationApprovalError("APPROVAL_EXPIRED", "Approval has expired.", 403);
		}

		if (approval.consumedAt || approval.status === "CONSUMED") {
			throw new AutomationApprovalError("APPROVAL_REPLAYED", "Approval was already consumed (single-use replay rejected).", 403);
		}

		if (approval.status !== "APPROVED") {
			throw new AutomationApprovalError("APPROVAL_NOT_APPROVED", `Approval status is ${approval.status}, not APPROVED.`, 403);
		}

		const now = new Date();

		if (process.env.DATABASE_URL) {
			const updated = await prisma.automationApproval.update({
				where: { id: approval.id },
				data: {
					status: "CONSUMED",
					consumedAt: now,
				},
			});
			const dto: AutomationApprovalRecord = {
				...approval,
				status: "CONSUMED",
				consumedAt: now.toISOString(),
			};
			this.inMemoryApprovals.set(approval.id, dto);
			return dto;
		}

		approval.status = "CONSUMED";
		approval.consumedAt = now.toISOString();
		return approval;
	}
}

export const globalAutomationApprovalStore = new AutomationApprovalStore();
