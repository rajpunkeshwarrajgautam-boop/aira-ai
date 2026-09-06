import { timingSafeEqual } from "node:crypto";

import { reconcileActiveAgentRuns } from "@/lib/agents/run-reconciler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function validReconcilerToken(req: Request): boolean {
	const expected = process.env.AIRA_AGENT_RECONCILER_TOKEN?.trim();
	const authorization = req.headers.get("authorization")?.trim();
	if (!expected || !authorization?.startsWith("Bearer ")) return false;
	const supplied = authorization.slice("Bearer ".length).trim();
	if (!supplied) return false;
	const expectedBytes = Buffer.from(expected);
	const suppliedBytes = Buffer.from(supplied);
	return (
		expectedBytes.length === suppliedBytes.length &&
		timingSafeEqual(expectedBytes, suppliedBytes)
	);
}

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function POST(req: Request): Promise<Response> {
	if (!validReconcilerToken(req)) {
		return noStoreJson(
			{ error: { code: "UNAUTHORIZED", message: "Invalid reconciliation worker token." } },
			{ status: 401 },
		);
	}

	try {
		const summary = await reconcileActiveAgentRuns();
		return noStoreJson({ ok: true, summary });
	} catch (error) {
		console.error("[agents:reconcile:batch]", {
			error: error instanceof Error ? error.message : "unknown reconciliation batch failure",
		});
		return noStoreJson(
			{ error: { code: "RECONCILIATION_FAILED", message: "Agent run reconciliation failed." } },
			{ status: 500 },
		);
	}
}
