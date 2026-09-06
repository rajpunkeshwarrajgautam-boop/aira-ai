import { auth } from "@/auth";
import { getBrowserSession } from "@/lib/agent-platform/store";
import { BrowserRuntimeError, getRemoteBrowserScreenshot } from "@/lib/browser-runtime/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { sessionId } = await params;
	const record = await getBrowserSession(session.user.id, sessionId);
	if (!record) return Response.json({ error: { code: "NOT_FOUND", message: "Browser session not found." } }, { status: 404 });
	try {
		const raw = await getRemoteBrowserScreenshot(record.id);
		return new Response(raw, {
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "no-store, max-age=0",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch (error) {
		if (error instanceof BrowserRuntimeError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
		return Response.json({ error: { code: "BROWSER_SCREENSHOT_FAILED", message: "Browser screenshot could not be loaded." } }, { status: 500 });
	}
}
