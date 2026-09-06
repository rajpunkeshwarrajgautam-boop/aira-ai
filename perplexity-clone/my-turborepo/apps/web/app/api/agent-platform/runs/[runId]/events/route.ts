import { auth } from "@/auth";
import { getRunForUser, listEvents } from "@/lib/agent-platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

const encoder = new TextEncoder();

function sseEvent(event: { id: string; type: string; createdAt: Date; payload: Record<string, unknown> }): Uint8Array {
	return encoder.encode(
		`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...event, createdAt: event.createdAt.toISOString() })}\n\n`,
	);
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const { runId } = await params;
	const run = await getRunForUser(session.user.id, runId);
	if (!run) {
		return Response.json({ error: { code: "NOT_FOUND", message: "Managed run not found." } }, { status: 404 });
	}
	const url = new URL(req.url);
	const afterParam = url.searchParams.get("after");
	let after = afterParam ? new Date(afterParam) : undefined;
	if (after && Number.isNaN(after.getTime())) after = undefined;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let cursor = after;
			let closed = false;
			const finish = () => {
				if (closed) return;
				closed = true;
				controller.close();
			};
			const abort = () => finish();
			req.signal.addEventListener("abort", abort, { once: true });
			controller.enqueue(encoder.encode(": AIRA managed-run event stream\n\n"));
			const startedAt = Date.now();
			while (!closed && Date.now() - startedAt < 25_000) {
				try {
					const events = await listEvents(runId, cursor);
					for (const event of events) {
						controller.enqueue(sseEvent(event));
						cursor = event.createdAt;
					}
					const refreshed = await getRunForUser(session.user.id!, runId);
					if (!refreshed || ["COMPLETED", "FAILED", "CANCELLED"].includes(refreshed.status)) {
						controller.enqueue(encoder.encode(`event: stream.end\ndata: ${JSON.stringify({ status: refreshed?.status ?? "NOT_FOUND" })}\n\n`));
						finish();
						break;
					}
				} catch {
					controller.enqueue(encoder.encode("event: stream.warning\ndata: {\"message\":\"Event refresh failed; reconnecting is safe.\"}\n\n"));
					finish();
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 1_500));
			}
			finish();
			req.signal.removeEventListener("abort", abort);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}
