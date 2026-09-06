import { auth } from "@/auth";
import { listToolApprovals } from "@/lib/agents/tool-approvals";
import { getAgentRun } from "@/lib/autogpt/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	const { runId } = await params;
	const run = await getAgentRun(session.user.id, runId);
	if (!run) {
		return noStoreJson(
			{ error: { code: "NOT_FOUND", message: "Agent task not found." } },
			{ status: 404 },
		);
	}

	const requestedLimit = Number(new URL(req.url).searchParams.get("limit") ?? "50");
	const limit = Number.isFinite(requestedLimit) ? requestedLimit : 50;
	const approvals = await listToolApprovals(session.user.id, run.id, limit);
	return noStoreJson({ approvals });
}
