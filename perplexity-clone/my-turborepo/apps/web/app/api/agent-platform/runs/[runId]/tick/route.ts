import { auth } from "@/auth";
import { getRunForUser, listTasks } from "@/lib/agent-platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: {
			"Cache-Control": "no-store",
			"Deprecation": "true",
			"Sunset": "browser mission advancement is handled by the persistent scheduler",
			...(init?.headers ?? {}),
		},
	});
}

/**
 * Compatibility endpoint for older /build clients.
 *
 * It deliberately does NOT advance orchestration. Autonomous progress is owned
 * exclusively by the persistent server-to-server scheduler. Keeping this route
 * observation-only prevents an open browser tab (or many tabs) from becoming a
 * second scheduler while allowing already-deployed clients to refresh state.
 */
export async function POST(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const { runId } = await params;
	const run = await getRunForUser(session.user.id, runId);
	if (!run) {
		return json({ error: { code: "NOT_FOUND", message: "Managed run not found." } }, { status: 404 });
	}
	return json({
		run,
		tasks: await listTasks(run.id),
		dispatched: 0,
		reconciled: 0,
		schedulerOwned: true,
	});
}
