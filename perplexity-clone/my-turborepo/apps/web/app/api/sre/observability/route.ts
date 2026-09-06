import { auth } from "@/auth";
import { globalSREPlatform } from "@/lib/sre/observability-platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	return json({
		slos: globalSREPlatform.getSLOMetrics(),
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	try {
		const body = await req.json();
		const { action } = body;

		if (action === "load_test") {
			const { concurrency, iterations } = body;
			const result = globalSREPlatform.simulateLoadSpike(concurrency ?? 50, iterations ?? 10);
			return json({ loadTest: result });
		}

		if (action === "dr_drill") {
			const drill = globalSREPlatform.executeDRRestoreDrill();
			return json({ drill });
		}

		return json({ error: { code: "BAD_REQUEST", message: `Unknown action: ${action}` } }, { status: 400 });
	} catch (error) {
		return json(
			{
				error: {
					code: "SRE_ACTION_FAILED",
					message: error instanceof Error ? error.message : "SRE action failed.",
				},
			},
			{ status: 500 },
		);
	}
}
