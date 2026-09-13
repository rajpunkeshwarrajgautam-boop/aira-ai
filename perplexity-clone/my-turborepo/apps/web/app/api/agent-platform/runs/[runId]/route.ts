import { auth } from "@/auth";
import {
	getProjectForUser,
	getRunForUser,
	listEvents,
	listPendingApprovals,
	listRunArtifacts,
	listTasks,
} from "@/lib/agent-platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const { runId } = await params;
	const run = await getRunForUser(session.user.id, runId);
	if (!run) {
		return json({ error: { code: "NOT_FOUND", message: "Managed run not found." } }, { status: 404 });
	}
	const [project, tasks, events, approvals, artifacts] = await Promise.all([
		getProjectForUser(session.user.id, run.projectId),
		listTasks(run.id),
		listEvents(run.id),
		listPendingApprovals(session.user.id, run.id),
		listRunArtifacts(session.user.id, run.id),
	]);
	return json({ run, project, tasks, events, approvals, artifacts });
}

