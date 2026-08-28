import { auth } from "@/auth";
import { tickManagedRun } from "@/lib/agent-platform/orchestrator";

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
	const { runId } = await params;
	try {
		return json(await tickManagedRun(session.user.id, runId));
	} catch (error) {
		if (error instanceof Error && error.message === "Managed run not found.") {
			return json({ error: { code: "NOT_FOUND", message: error.message } }, { status: 404 });
		}
		console.error("[agent-platform:tick]", error);
		return json(
			{ error: { code: "MANAGED_RUN_TICK_FAILED", message: "AIRA could not advance this managed run." } },
			{ status: 500 },
		);
	}
}
