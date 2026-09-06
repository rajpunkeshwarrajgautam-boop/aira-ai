import { z } from "zod";

import { auth } from "@/auth";
import {
	resolveToolApproval,
	ToolApprovalError,
} from "@/lib/agents/tool-approvals";
import { getAgentRun } from "@/lib/autogpt/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string; approvalId: string }> };

const DecisionSchema = z.object({
	decision: z.enum(["APPROVE", "DENY"]),
});

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	const { runId, approvalId } = await params;
	const run = await getAgentRun(session.user.id, runId);
	if (!run) {
		return noStoreJson(
			{ error: { code: "NOT_FOUND", message: "Agent task not found." } },
			{ status: 404 },
		);
	}

	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return noStoreJson(
			{ error: { code: "INVALID_REQUEST", message: "Approval decision must be valid JSON." } },
			{ status: 400 },
		);
	}
	const parsed = DecisionSchema.safeParse(raw);
	if (!parsed.success) {
		return noStoreJson(
			{ error: { code: "INVALID_REQUEST", message: "Decision must be APPROVE or DENY." } },
			{ status: 400 },
		);
	}

	try {
		const approval = await resolveToolApproval(
			session.user.id,
			run.id,
			approvalId,
			parsed.data.decision,
		);
		return noStoreJson({ approval });
	} catch (error) {
		if (error instanceof ToolApprovalError) {
			return noStoreJson(
				{ error: { code: error.code, message: error.message } },
				{ status: error.status },
			);
		}
		console.error("[agents:tool-approvals:resolve]", {
			runId: run.id,
			approvalId,
			error: error instanceof Error ? error.message : "unknown approval failure",
		});
		return noStoreJson(
			{ error: { code: "APPROVAL_UPDATE_FAILED", message: "Approval decision could not be saved." } },
			{ status: 500 },
		);
	}
}
