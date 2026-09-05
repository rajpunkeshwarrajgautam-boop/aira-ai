import { z } from "zod";

import { auth } from "@/auth";
import { steerManagedTask } from "@/lib/agent-platform/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string; taskId: string }> };

const SteerSchema = z.object({ instruction: z.string().trim().min(2).max(4_000) });

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
	const parsed = SteerSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Provide a steering instruction." } }, { status: 400 });
	}
	const { runId, taskId } = await params;
	try {
		await steerManagedTask({
			userId: session.user.id,
			runId,
			taskId,
			instruction: parsed.data.instruction,
		});
		return json({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : "The task could not be steered.";
		const status = /not found/i.test(message) ? 404 : /does not support/i.test(message) ? 409 : 500;
		return json({ error: { code: "TASK_STEER_FAILED", message } }, { status });
	}
}
