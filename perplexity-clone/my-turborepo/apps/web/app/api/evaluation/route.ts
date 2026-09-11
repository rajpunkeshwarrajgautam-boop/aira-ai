import { auth } from "@/auth";
import { globalEvaluationEngine } from "@/lib/evaluation/evaluation-engine";

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
		metrics: globalEvaluationEngine.getOutcomeMetrics(),
		corpusCount: globalEvaluationEngine.corpus.length,
		canariesCount: globalEvaluationEngine.canaries.length,
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	try {
		const body = await req.json();
		const { action, candidateModel, probeId, testResponse } = body;

		if (action === "run_corpus") {
			const results = globalEvaluationEngine.corpus.map((c) =>
				globalEvaluationEngine.evaluateCase(c, candidateModel ?? "meta/llama-3.3-70b-instruct"),
			);
			return json({ results });
		}

		if (action === "test_canary") {
			const probe = globalEvaluationEngine.canaries.find((c) => c.id === probeId);
			if (!probe) return json({ error: { code: "NOT_FOUND", message: "Canary probe not found" } }, { status: 404 });
			const check = globalEvaluationEngine.evaluateCanary(probe, testResponse ?? "");
			return json({ result: check });
		}

		return json({ error: { code: "BAD_REQUEST", message: `Unknown action: ${action}` } }, { status: 400 });
	} catch (error) {
		return json(
			{
				error: {
					code: "EVALUATION_FAILED",
					message: error instanceof Error ? error.message : "Evaluation failed.",
				},
			},
			{ status: 500 },
		);
	}
}
