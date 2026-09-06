import { auth } from "@/auth";
import { globalMultiAgentOrchestrator } from "@/lib/agents/multi-agent-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	try {
		const body = await req.json();
		const { mode } = body;

		if (mode === "council") {
			const { topic, members } = body;
			if (!topic || !Array.isArray(members)) {
				return json({ error: { code: "INVALID_INPUT", message: "Topic and members array required." } }, { status: 400 });
			}
			const result = globalMultiAgentOrchestrator.deliberate(topic, members);
			return json({ council: result });
		}

		if (mode === "verify") {
			const { deliverable, criteria } = body;
			const result = globalMultiAgentOrchestrator.verifyDeliverable(deliverable, criteria ?? []);
			return json({ verification: result });
		}

		if (mode === "snapshot") {
			const { missionId, input, steps, deliverables, verifications } = body;
			const snapshot = globalMultiAgentOrchestrator.createSnapshot(missionId, input, steps ?? [], deliverables ?? [], verifications ?? []);
			return json({ snapshot }, { status: 201 });
		}

		if (mode === "replay") {
			const { snapshot } = body;
			const replayResult = globalMultiAgentOrchestrator.replayMission(snapshot);
			return json({ replay: replayResult });
		}

		return json({ error: { code: "BAD_REQUEST", message: `Unsupported mode: ${mode}` } }, { status: 400 });
	} catch (error) {
		return json(
			{
				error: {
					code: "ORCHESTRATION_FAILED",
					message: error instanceof Error ? error.message : "Multi-agent operation failed.",
				},
			},
			{ status: 500 },
		);
	}
}
