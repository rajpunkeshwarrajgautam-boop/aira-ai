import { z } from "zod";

import { auth } from "@/auth";
import { tickManagedRun } from "@/lib/agent-platform/orchestrator";
import { resolveApproval } from "@/lib/agent-platform/store";
import { resolveToolApproval } from "@/lib/tool-gateway/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ approvalId: string }> };

const ResolveSchema = z.object({ decision: z.enum(["approve", "reject"]) });

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const parsed = ResolveSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Decision must be approve or reject." } }, { status: 400 });
	}
	const { approvalId } = await params;
	const approve = parsed.data.decision === "approve";

	// Tool approvals are independent of DAG-stage approvals. Resolving one must
	// never requeue/cancel the parent task. The caller re-submits the same
	// idempotent tool request with approvalId to execute an approved side effect.
	const toolApproval = await resolveToolApproval({ userId: session.user.id, approvalId, approve });
	if (toolApproval) {
		return json({ resolved: { ...toolApproval, kind: "tool" } });
	}

	const resolved = await resolveApproval({
		userId: session.user.id,
		approvalId,
		approve,
	});
	if (!resolved) {
		return json({ error: { code: "NOT_FOUND", message: "Pending approval not found." } }, { status: 404 });
	}
	const result = await tickManagedRun(session.user.id, resolved.runId).catch(() => null);
	return json({ resolved: { ...resolved, kind: "mission" }, result });
}
