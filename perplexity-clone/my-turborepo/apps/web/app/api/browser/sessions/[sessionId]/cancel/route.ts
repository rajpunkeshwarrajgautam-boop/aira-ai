import { auth } from "@/auth";
import { releaseBrowserActionLease } from "@/lib/agent-platform/browser-arbitration";
import {
	getBrowserSession,
	recordBrowserAction,
} from "@/lib/agent-platform/store";
import {
	BrowserRuntimeError,
	cancelRemoteBrowserAction,
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

export async function POST(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { sessionId } = await params;
	const record = await getBrowserSession(session.user.id, sessionId);
	if (!record) return json({ error: { code: "NOT_FOUND", message: "Browser session not found." } }, { status: 404 });

	try {
		const cancelResult = await cancelRemoteBrowserAction(record.id);
		if (record.actionLeaseOwner) {
			await releaseBrowserActionLease({
				userId: session.user.id,
				sessionId: record.id,
				leaseOwner: record.actionLeaseOwner,
			}).catch(() => undefined);
		}
		await recordBrowserAction({
			sessionId: record.id,
			source: "HUMAN",
			action: "cancel",
			target: null,
			result: { cancelled: cancelResult.cancelled },
			risk: "LOW",
		}).catch(() => undefined);

		return json({ ok: true, cancelled: cancelResult.cancelled });
	} catch (error) {
		if (error instanceof BrowserRuntimeError) {
			return json({ error: { code: error.code, message: error.message } }, { status: error.status });
		}
		return json({ error: { code: "BROWSER_ACTION_FAILED", message: "Cancellation failed." } }, { status: 500 });
	}
}
