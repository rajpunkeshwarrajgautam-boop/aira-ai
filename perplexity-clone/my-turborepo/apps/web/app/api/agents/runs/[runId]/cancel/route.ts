import { auth } from "@/auth";
import { AaeRequestError } from "@/lib/aae/client";
import { AaeConfigError } from "@/lib/aae/config";
import { cancelAaeAgentRun } from "@/lib/aae/runs";
import { getAgentRun } from "@/lib/autogpt/runs";
import { DeerFlowRequestError } from "@/lib/deerflow/client";
import { DeerFlowConfigError } from "@/lib/deerflow/config";
import { cancelDeerFlowAgentRun } from "@/lib/deerflow/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function POST(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	const { runId } = await params;
	const cached = await getAgentRun(session.user.id, runId);
	if (!cached) {
		return noStoreJson(
			{ error: { code: "NOT_FOUND", message: "Agent task not found." } },
			{ status: 404 },
		);
	}
	if (cached.provider !== "DEERFLOW" && cached.provider !== "AAE") {
		return noStoreJson(
			{
				error: {
					code: "CANCEL_NOT_SUPPORTED",
					message: "Cancellation is not available for this task runtime.",
				},
			},
			{ status: 409 },
		);
	}

	try {
		const run =
			cached.provider === "DEERFLOW"
				? await cancelDeerFlowAgentRun(session.user.id, runId)
				: await cancelAaeAgentRun(session.user.id, runId);
		if (!run) {
			return noStoreJson(
				{ error: { code: "NOT_FOUND", message: "Agent task not found." } },
				{ status: 404 },
			);
		}
		return noStoreJson({ run, cancelRequested: true }, { status: 202 });
	} catch (error) {
		if (
			error instanceof DeerFlowRequestError ||
			error instanceof DeerFlowConfigError ||
			error instanceof AaeRequestError ||
			error instanceof AaeConfigError
		) {
			return noStoreJson(
				{ error: { code: error.code, message: error.message } },
				{
					status:
						error instanceof DeerFlowRequestError || error instanceof AaeRequestError
							? error.status
							: 503,
				},
			);
		}
		console.error("[agents:runs:cancel]", error);
		return noStoreJson(
			{ error: { code: "AGENT_CANCEL_FAILED", message: "The agent task could not be stopped." } },
			{ status: 500 },
		);
	}
}
