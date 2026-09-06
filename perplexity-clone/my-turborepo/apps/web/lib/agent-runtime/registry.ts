import { agentSwarmRuntime } from "./agent-swarm-runtime";
import { autoGptRuntime, deerFlowRuntime } from "./legacy-runtimes";
import { parseRuntimePriority, selectRuntimeId } from "./selection";
import type { AgentRuntime, AgentRuntimeHealth, AgentRuntimeId } from "./types";
import { AgentRuntimeError } from "./types";

const RUNTIMES = new Map<AgentRuntimeId, AgentRuntime>([
	["DEERFLOW", deerFlowRuntime],
	["AUTOGPT", autoGptRuntime],
	["AGENT_SWARM", agentSwarmRuntime],
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
