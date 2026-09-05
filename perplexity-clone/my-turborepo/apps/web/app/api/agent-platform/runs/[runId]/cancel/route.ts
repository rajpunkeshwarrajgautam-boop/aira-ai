import { auth } from "@/auth";
import { cancelManagedRun } from "@/lib/agent-platform/orchestrator";
import { getRunForUser } from "@/lib/agent-platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function POST(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	try {
		const { runId } = await params;
		const existing = await getRunForUser(session.user.id, runId);
		if (!existing) {
			return json({ error: { code: "NOT_FOUND", message: "Managed run not found." } }, { status: 404 });
		}
		await cancelManagedRun(session.user.id, runId);
		return json({ run: await getRunForUser(session.user.id, runId) });
	} catch (error) {
		console.error("[agent-platform:cancel]", error);
		return json(
			{ error: { code: "MANAGED_RUN_CANCEL_FAILED", message: "AIRA could not cancel this managed run." } },
			{ status: 500 },
		);
	}
}
