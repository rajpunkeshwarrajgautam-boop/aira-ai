import { auth } from "@/auth";
import {
	ManagedTaskRecoveryError,
	reconcileBlockedManagedTask,
} from "@/lib/agent-platform/recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string; taskId: string }> };

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
	const { runId, taskId } = await params;
	try {
		const recovery = await reconcileBlockedManagedTask({
			userId: session.user.id,
			runId,
			taskId,
		});
		return json({ recovery });
	} catch (error) {
		if (error instanceof ManagedTaskRecoveryError) {
			return json({ error: { code: error.code, message: error.message } }, { status: error.status });
		}
		console.error("[agent-platform:reconcile]", error);
		return json(
			{ error: { code: "TASK_RECONCILE_FAILED", message: "AIRA could not reconcile this blocked runtime task." } },
			{ status: 500 },
		);
	}
}
