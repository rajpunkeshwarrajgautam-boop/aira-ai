import { z } from "zod";

import { auth } from "@/auth";
import {
	getBrowserSession,
	recordBrowserAction,
	updateBrowserSession,
} from "@/lib/agent-platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sessionId: string }> };

const ControlSchema = z.object({ control: z.enum(["human", "agent", "pause", "resume"]) });

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { sessionId } = await params;
	const record = await getBrowserSession(session.user.id, sessionId);
	if (!record) return json({ error: { code: "NOT_FOUND", message: "Browser session not found." } }, { status: 404 });
	if (["ENDED", "FAILED", "EXPIRED"].includes(record.status)) {
		return json({ error: { code: "BROWSER_SESSION_NOT_ACTIVE", message: `Browser session is ${record.status.toLowerCase()}.` } }, { status: 409 });
	}
	const parsed = ControlSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) return json({ error: { code: "VALIDATION_ERROR", message: "Control must be human, agent, pause, or resume." } }, { status: 400 });
	const status = parsed.data.control === "human"
		? "HUMAN_CONTROL"
		: parsed.data.control === "pause"
			? "PAUSED"
			: "ACTIVE";
	await updateBrowserSession({ sessionId: record.id, status });
	await recordBrowserAction({
		sessionId: record.id,
		source: "SYSTEM",
		action: `control.${parsed.data.control}`,
		result: { previousStatus: record.status, status },
		risk: "LOW",
	});
	return json({ session: await getBrowserSession(session.user.id, sessionId) });
}
