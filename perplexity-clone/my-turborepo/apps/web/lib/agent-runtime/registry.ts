import { airaAgentRuntime } from "./aira-agent-runtime";
import { agentSwarmRuntime } from "./agent-swarm-runtime";
import { autoGptRuntime, deerFlowRuntime } from "./legacy-runtimes";
import { parseRuntimePriority, selectRuntimeId } from "./selection";
import type {
	AgentRuntime,
	AgentRuntimeHealth,
	AgentRuntimeId,
	AgentRunSubmission,
	CreateAgentRunInput,
} from "./types";
import { AgentRuntimeError } from "./types";

const WORKFLOW_CLIENT_REQUEST_PREFIX = "wf_agent_";
const DEFAULT_WORKFLOW_WAIT_MS = 30_000;
const MIN_WORKFLOW_WAIT_MS = 5_000;
const MAX_WORKFLOW_WAIT_MS = 55_000;
const WORKFLOW_REFRESH_INTERVAL_MS = 750;

function workflowWaitMs(): number {
	const parsed = Number(process.env.AIRA_WORKFLOW_AGENT_WAIT_MS ?? DEFAULT_WORKFLOW_WAIT_MS);
	if (!Number.isFinite(parsed)) return DEFAULT_WORKFLOW_WAIT_MS;
	return Math.min(MAX_WORKFLOW_WAIT_MS, Math.max(MIN_WORKFLOW_WAIT_MS, Math.trunc(parsed)));
}

async function waitForWorkflowRun(
	runtime: AgentRuntime,
	input: CreateAgentRunInput,
	submission: AgentRunSubmission,
): Promise<AgentRunSubmission> {
	if (!input.clientRequestId.startsWith(WORKFLOW_CLIENT_REQUEST_PREFIX)) {
		return submission;
	}

	let run = submission.run;
	const deadline = Date.now() + workflowWaitMs();

	while ((run.status === "QUEUED" || run.status === "RUNNING") && Date.now() < deadline) {
		await new Promise<void>((resolve) => setTimeout(resolve, WORKFLOW_REFRESH_INTERVAL_MS));
		const refreshed = await runtime.refreshRun(input.userId, run.id);
		if (!refreshed) {
			throw new AgentRuntimeError({
				code: "WORKFLOW_AGENT_RUN_LOST",
				message: `${runtime.id} accepted the workflow task but its run could not be refreshed.`,
				status: 502,
				runtimeId: runtime.id,
				retryable: true,
			});
		}
		run = refreshed;
	}

	if (run.status === "REVIEW") {
		throw new AgentRuntimeError({
			code: "WORKFLOW_AGENT_REVIEW_REQUIRED",
			message: `${runtime.id} requires human reconciliation before this workflow can continue.`,
			status: 409,
			runtimeId: runtime.id,
			retryable: false,
			submissionOutcomeUnknown: true,
		});
	}

	if (run.status === "QUEUED" || run.status === "RUNNING") {
		throw new AgentRuntimeError({
			code: "WORKFLOW_AGENT_TIMEOUT",
			message: `${runtime.id} did not reach a terminal state within the workflow execution window.`,
			status: 504,
			runtimeId: runtime.id,
			retryable: true,
		});
	}

	// Failed/terminated states are intentionally returned to the workflow engine;
	// the engine owns the node failure policy and records the provider error.
	if (run.status === "FAILED" || run.status === "TERMINATED") {
		return { ...submission, run };
	}

	if (run.status !== "COMPLETED") {
		throw new AgentRuntimeError({
			code: "WORKFLOW_AGENT_STATUS_INVALID",
			message: `${runtime.id} returned unsupported terminal status ${String(run.status)}.`,
			status: 502,
			runtimeId: runtime.id,
		});
	}

	// A provider may legitimately complete without a textual result. Preserve
	// only runtime-observed terminal metadata so downstream code never invents
	// synthetic model output.
	const completedRun = run.result === null
		? {
				...run,
				result: {
					runId: run.id,
					provider: run.provider,
					status: run.status,
					completedAt: run.completedAt,
				},
			}
		: run;

	return { ...submission, run: completedRun };
}

function workflowAwareRuntime(runtime: AgentRuntime): AgentRuntime {
	return {
		...runtime,
		createRun: async (input) => {
			const submission = await runtime.createRun(input);
			return waitForWorkflowRun(runtime, input, submission);
		},
	};
}

const RUNTIMES = new Map<AgentRuntimeId, AgentRuntime>([
	["AIRA_AGENT", workflowAwareRuntime(airaAgentRuntime)],
	["DEERFLOW", workflowAwareRuntime(deerFlowRuntime)],
	["AUTOGPT", workflowAwareRuntime(autoGptRuntime)],
	["AGENT_SWARM", workflowAwareRuntime(agentSwarmRuntime)],
]);

export function getAgentRuntime(id: string): AgentRuntime {
	const runtime = RUNTIMES.get(id as AgentRuntimeId);
	if (!runtime) {
		throw new AgentRuntimeError({
			code: "UNKNOWN_AGENT_RUNTIME",
			message: `Unknown autonomous runtime: ${id}.`,
			status: 500,
		});
	}
	return runtime;
}

export async function getAgentRuntimeStates(): Promise<readonly AgentRuntimeHealth[]> {
	return Promise.all([...RUNTIMES.values()].map((runtime) => runtime.getHealth()));
}

export async function selectAgentRuntime(requested?: AgentRuntimeId): Promise<AgentRuntime> {
	const states = await getAgentRuntimeStates();
	const id = selectRuntimeId({
		states,
		requested,
		priority: parseRuntimePriority(process.env.AIRA_AGENT_RUNTIME_PRIORITY),
	});
	return getAgentRuntime(id);
}

export function runtimeStatesById(states: readonly AgentRuntimeHealth[]) {
	return Object.fromEntries(states.map((state) => [state.id, state])) as Record<
		AgentRuntimeId,
		AgentRuntimeHealth
	>;
}
