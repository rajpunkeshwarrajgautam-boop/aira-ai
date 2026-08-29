import type { AgentRunStepStatus } from "@/lib/agents/run-steps";
import { recordAgentRunStepBestEffort } from "@/lib/agents/run-steps";

import type { RuntimeTask } from "./types";

export interface RuntimeTaskStepProjection {
	readonly stepKey: string;
	readonly type: "AGENT_TASK";
	readonly label: string;
	readonly status: AgentRunStepStatus;
	readonly attempt: number;
	readonly errorCode?: string;
}

export function runtimeTaskStatusToRunStepStatus(
	status: RuntimeTask["status"],
): AgentRunStepStatus {
	switch (status) {
		case "pending":
		case "ready":
		case "blocked":
			return "PENDING";
		case "running":
		case "waiting_for_tool":
		case "retrying":
			return "RUNNING";
		case "waiting_for_approval":
			return "WAITING_FOR_APPROVAL";
		case "verifying":
			return "WAITING_FOR_REVIEW";
		case "completed":
			return "COMPLETED";
		case "failed":
			return "FAILED";
		case "cancelled":
			return "CANCELLED";
	}
}

export function projectRuntimeTaskToRunStep(task: RuntimeTask): RuntimeTaskStepProjection {
	return {
		stepKey: `agent-task:${task.id}`,
		type: "AGENT_TASK",
		label: task.title,
		status: runtimeTaskStatusToRunStepStatus(task.status),
		attempt: Math.max(1, task.attempt),
		...(task.status === "blocked" ? { errorCode: "TASK_BLOCKED" } : {}),
	};
}

export async function recordRuntimeTaskStepBestEffort(
	runId: string,
	task: RuntimeTask,
): Promise<void> {
	const projection = projectRuntimeTaskToRunStep(task);
	await recordAgentRunStepBestEffort({
		runId,
		...projection,
	});
}
