import { prisma } from "@/lib/prisma";

export interface ResolvedToolApproval {
	readonly toolCallId: string;
	readonly runId: string;
	readonly projectId: string;
	readonly taskId: string | null;
	readonly decision: "APPROVED" | "REJECTED";
}

/**
 * Resolves only approvals linked to AgentToolCall. Mission-stage approvals are
 * intentionally left for agent-platform/store.resolveApproval, because a tool
 * approval must never reset its parent task to QUEUED or CANCELLED.
 */
export async function resolveToolApproval(input: {
	readonly userId: string;
	readonly approvalId: string;
	readonly approve: boolean;
}): Promise<ResolvedToolApproval | null> {
	return prisma.$transaction(async (tx) => {
		const rows = await tx.$queryRaw<Array<{
			toolCallId: string;
			runId: string;
			projectId: string;
			taskId: string | null;
		}>>`
			select c."id" as "toolCallId", c."runId", c."projectId", c."taskId"
			from "AgentToolCall" c
			join "AgentApproval" a on a."id"=c."approvalId"
			where a."id"=${input.approvalId}
			  and a."userId"=${input.userId}
			  and c."userId"=${input.userId}
			  and a."status"='PENDING'
			for update of a, c
		`;
		const linked = rows[0];
		if (!linked) return null;
		await tx.$executeRaw`
			update "AgentApproval"
			set "status"=${input.approve ? "APPROVED" : "REJECTED"}, "resolvedAt"=current_timestamp
			where "id"=${input.approvalId} and "userId"=${input.userId} and "status"='PENDING'
		`;
		if (!input.approve) {
			await tx.$executeRaw`
				update "AgentToolCall"
				set "status"='DENIED', "errorCode"='USER_REJECTED', "completedAt"=current_timestamp
				where "id"=${linked.toolCallId} and "userId"=${input.userId} and "status"='APPROVAL_REQUIRED'
			`;
		}
		return {
			...linked,
			decision: input.approve ? "APPROVED" : "REJECTED",
		};
	});
}
