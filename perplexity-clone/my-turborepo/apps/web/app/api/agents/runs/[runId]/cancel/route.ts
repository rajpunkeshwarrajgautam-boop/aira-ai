import { auth } from "@/auth";
import { recordAgentRunEventBestEffort } from "@/lib/agents/run-events";
import {
	agentRunStatusToStepStatus,
	recordAgentRunStepBestEffort,
} from "@/lib/agents/run-steps";
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

function terminalStatusMessage(status: string): string {
	return status === "COMPLETED"
		? "The autonomous task completed before cancellation took effect."
		: status === "TERMINATED"
			? "The autonomous runtime confirmed that this task stopped."
			: status === "FAILED"
				? "The autonomous task ended in a failed state while cancellation was being processed."
				: "The cancellation request is still being processed by the runtime.";
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
	if (cached.provider !== "DEERFLOW") {
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

	await Promise.all([
		recordAgentRunEventBestEffort({
			runId: cached.id,
			eventKey: "cancel-requested",
			type: "CANCEL_REQUESTED",
			status: cached.status,
			message: "You requested that AIRA stop this autonomous task.",
			metadata: { provider: cached.provider },
		}),
		recordAgentRunStepBestEffort({
			runId: cached.id,
			stepKey: "provider-cancellation",
			type: "PROVIDER_CANCELLATION",
			label: "Cancel DeerFlow execution",
			status: "RUNNING",
		}),
	]);

	try {
		const run = await cancelDeerFlowAgentRun(session.user.id, runId);
		if (!run) {
			return noStoreJson(
				{ error: { code: "NOT_FOUND", message: "Agent task not found." } },
				{ status: 404 },
			);
		}
		await recordAgentRunStepBestEffort({
			runId: run.id,
			stepKey: "provider-cancellation",
			type: "PROVIDER_CANCELLATION",
			label: "Cancel DeerFlow execution",
			status: run.status === "TERMINATED" ? "COMPLETED" : agentRunStatusToStepStatus(run.status),
		});
		if (run.status !== cached.status) {
			await Promise.all([
				recordAgentRunEventBestEffort({
					runId: run.id,
					eventKey: `status:${run.status}`,
					type: "STATUS_CHANGED",
					status: run.status,
					message: terminalStatusMessage(run.status),
					metadata: { provider: run.provider },
				}),
				recordAgentRunStepBestEffort({
					runId: run.id,
					stepKey: "provider-execution",
					type: "PROVIDER_EXECUTION",
					label: "DeerFlow 2.0 execution",
					status: agentRunStatusToStepStatus(run.status),
				}),
			]);
		}
		return noStoreJson({ run, cancelRequested: true }, { status: 202 });
	} catch (error) {
		await recordAgentRunStepBestEffort({
			runId: cached.id,
			stepKey: "provider-cancellation",
			type: "PROVIDER_CANCELLATION",
			label: "Cancel DeerFlow execution",
			status: "FAILED",
			errorCode:
				error instanceof DeerFlowRequestError || error instanceof DeerFlowConfigError
					? error.code
					: "AGENT_CANCEL_FAILED",
		});
		if (error instanceof DeerFlowRequestError || error instanceof DeerFlowConfigError) {
			return noStoreJson(
				{ error: { code: error.code, message: error.message } },
				{ status: error instanceof DeerFlowRequestError ? error.status : 503 },
			);
		}
		console.error("[agents:runs:cancel]", error);
		return noStoreJson(
			{ error: { code: "AGENT_CANCEL_FAILED", message: "The agent task could not be stopped." } },
			{ status: 500 },
		);
	}
}
