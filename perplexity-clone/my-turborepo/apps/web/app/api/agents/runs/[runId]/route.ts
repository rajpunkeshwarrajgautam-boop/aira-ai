import { auth } from "@/auth";
import { recordAgentRunEventBestEffort } from "@/lib/agents/run-events";
import {
	agentRunStatusToStepStatus,
	recordAgentRunStepBestEffort,
} from "@/lib/agents/run-steps";
import { AutoGptRequestError } from "@/lib/autogpt/client";
import { AutoGptConfigError } from "@/lib/autogpt/config";
import { getAgentRun, refreshAgentRun } from "@/lib/autogpt/runs";
import { DeerFlowRequestError } from "@/lib/deerflow/client";
import { DeerFlowConfigError } from "@/lib/deerflow/config";
import { refreshDeerFlowAgentRun } from "@/lib/deerflow/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

function statusMessage(status: string): string {
	switch (status) {
		case "RUNNING":
			return "The autonomous runtime started executing this task.";
		case "REVIEW":
			return "The runtime paused this task for review.";
		case "COMPLETED":
			return "The autonomous task completed successfully.";
		case "TERMINATED":
			return "The autonomous task stopped before completion.";
		case "FAILED":
			return "The autonomous runtime reported that this task failed.";
		default:
			return "The task is queued for autonomous execution.";
	}
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
		const run = cached.provider === "DEERFLOW"
			? await refreshDeerFlowAgentRun(session.user.id, runId)
			: await refreshAgentRun(session.user.id, runId);
		if (!run) {
			return noStoreJson(
				{ error: { code: "NOT_FOUND", message: "Agent task not found." } },
				{ status: 404 },
			);
		}

		if (run.status !== cached.status) {
			await Promise.all([
				recordAgentRunEventBestEffort({
					runId: run.id,
					eventKey: `status:${run.status}`,
					type: "STATUS_CHANGED",
					status: run.status,
					message: statusMessage(run.status),
					metadata: { provider: run.provider },
				}),
				recordAgentRunStepBestEffort({
					runId: run.id,
					stepKey: "provider-execution",
					type: "PROVIDER_EXECUTION",
					label: `${run.provider === "DEERFLOW" ? "DeerFlow 2.0" : "AutoGPT"} execution`,
					status: agentRunStatusToStepStatus(run.status),
				}),
			]);
		}

		return noStoreJson({ run });
	} catch (error) {
		if (
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
			const hourBucket = Math.floor(Date.now() / 3_600_000);
			await recordAgentRunEventBestEffort({
				runId: cached.id,
				eventKey: `sync-warning:${hourBucket}`,
				type: "SYNC_WARNING",
				status: cached.status,
				message: "Live runtime status was temporarily unavailable; AIRA kept the last verified state and will retry.",
				metadata: { provider: cached.provider },
			});
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
