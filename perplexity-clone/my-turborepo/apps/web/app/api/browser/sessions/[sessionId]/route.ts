import { auth } from "@/auth";
import {
	getBrowserSession,
	listBrowserActions,
	updateBrowserSession,
} from "@/lib/agent-platform/store";
import {
	BrowserRuntimeError,
	closeRemoteBrowserSession,
	getRemoteBrowserSession,
} from "@/lib/browser-runtime/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sessionId: string }> };

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { sessionId } = await params;
	let record = await getBrowserSession(session.user.id, sessionId);
	if (!record) return json({ error: { code: "NOT_FOUND", message: "Browser session not found." } }, { status: 404 });
	let syncWarning: string | undefined;
	if (["ACTIVE", "HUMAN_CONTROL", "PAUSED"].includes(record.status) && record.expiresAt.getTime() > Date.now()) {
		try {
			const remote = await getRemoteBrowserSession(record.id);
			await updateBrowserSession({ sessionId: record.id, currentUrl: remote.currentUrl ?? null });
			record = (await getBrowserSession(session.user.id, sessionId)) ?? record;
		} catch (error) {
			syncWarning = error instanceof BrowserRuntimeError ? error.message : "Live browser status is temporarily unavailable.";
		}
	}
	return json({ session: record, actions: await listBrowserActions(session.user.id, sessionId), syncWarning });
}

export async function DELETE(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { sessionId } = await params;
	const record = await getBrowserSession(session.user.id, sessionId);
	if (!record) return json({ error: { code: "NOT_FOUND", message: "Browser session not found." } }, { status: 404 });
	await closeRemoteBrowserSession(record.id).catch(() => undefined);
	await updateBrowserSession({ sessionId: record.id, status: "ENDED" });
	return json({ ok: true });
}
