import { auth } from "@/auth";
import { getAgentRuntime } from "@/lib/agent-runtime/registry";
import { AgentRuntimeError } from "@/lib/agent-runtime/types";
import { AutoGptRequestError } from "@/lib/autogpt/client";
import { AutoGptConfigError } from "@/lib/autogpt/config";
import { getAgentRun } from "@/lib/autogpt/runs";
import { DeerFlowRequestError } from "@/lib/deerflow/client";
import { DeerFlowConfigError } from "@/lib/deerflow/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}
	const { runId } = await params;
	try {
		const cached = await getAgentRun(session.user.id, runId);
		if (!cached) {
			return noStoreJson(
				{ error: { code: "NOT_FOUND", message: "Agent task not found." } },
				{ status: 404 },
			);
		}
		const selectedRuntime = getAgentRuntime(cached.provider);
		const run = await selectedRuntime.refreshRun(session.user.id, runId);
		if (!run) {
			return noStoreJson(
				{ error: { code: "NOT_FOUND", message: "Agent task not found." } },
				{ status: 404 },
			);
		}
		return noStoreJson({ run });
	} catch (error) {
		if (
			error instanceof AgentRuntimeError ||
			error instanceof DeerFlowRequestError ||
			error instanceof DeerFlowConfigError ||
			error instanceof AutoGptRequestError ||
			error instanceof AutoGptConfigError
		) {
			const cached = await getAgentRun(session.user.id, runId);
			if (!cached) {
				return noStoreJson(
					{ error: { code: "NOT_FOUND", message: "Agent task not found." } },
					{ status: 404 },
				);
			}
			return noStoreJson({
				run: cached,
				syncWarning: "Live status is temporarily unavailable. AIRA will retry automatically.",
			});
		}
		console.error("[agents:runs:get]", error);
		return noStoreJson(
			{ error: { code: "AGENT_STATUS_FAILED", message: "Agent status could not be loaded." } },
			{ status: 500 },
		);
	}
}
