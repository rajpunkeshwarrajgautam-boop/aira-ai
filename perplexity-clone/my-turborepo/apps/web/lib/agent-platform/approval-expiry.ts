import { prisma } from "@/lib/prisma";

export const APPROVAL_TTL_MINUTES = 30;

/**
 * Human approvals are intentionally short-lived. A stale approval must never
 * remain an open-ended capability to perform a privileged side effect later.
 * This helper is user-scoped and only mutates the exact approval requested.
 */
export async function expireApprovalIfStale(input: {
	readonly userId: string;
	readonly approvalId: string;
}): Promise<boolean> {
	const rows = await prisma.$queryRaw<Array<{ id: string }>>`
		update "AgentApproval"
		set "status"='EXPIRED', "resolvedAt"=coalesce("resolvedAt", current_timestamp)
		where "id"=${input.approvalId}
		  and "userId"=${input.userId}
		  and "status" in ('PENDING','APPROVED')
		  and "createdAt" < current_timestamp - (${APPROVAL_TTL_MINUTES} * interval '1 minute')
		returning "id"
	`;
	return Boolean(rows[0]);
}
