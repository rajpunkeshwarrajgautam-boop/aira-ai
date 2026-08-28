import type { AgentRuntimeHealth, AgentRuntimeId } from "./types";
import { AgentRuntimeError } from "./types";

export const DEFAULT_RUNTIME_PRIORITY: readonly AgentRuntimeId[] = [
	"DEERFLOW",
	"AUTOGPT",
	"AGENT_SWARM",
];

export function parseRuntimePriority(value: string | undefined): readonly AgentRuntimeId[] {
	if (!value?.trim()) return DEFAULT_RUNTIME_PRIORITY;
	const allowed = new Set<AgentRuntimeId>(DEFAULT_RUNTIME_PRIORITY);
	const parsed: AgentRuntimeId[] = [];
	for (const raw of value.split(",")) {
		const id = raw.trim().toUpperCase() as AgentRuntimeId;
		if (allowed.has(id) && !parsed.includes(id)) parsed.push(id);
	}
	for (const id of DEFAULT_RUNTIME_PRIORITY) {
		if (!parsed.includes(id)) parsed.push(id);
	}
	return parsed;
}

export function selectRuntimeId(options: {
	readonly states: readonly AgentRuntimeHealth[];
	readonly requested?: AgentRuntimeId;
	readonly priority?: readonly AgentRuntimeId[];
}): AgentRuntimeId {
	const byId = new Map(options.states.map((state) => [state.id, state]));
	if (options.requested) {
		const state = byId.get(options.requested);
		if (!state?.enabled) {
			throw new AgentRuntimeError({
				code: "RUNTIME_DISABLED",
				message: `${options.requested} is disabled for this AIRA deployment.`,
				status: 503,
				runtimeId: options.requested,
			});
		}
		if (!state.configured) {
			throw new AgentRuntimeError({
				code: "RUNTIME_NOT_CONFIGURED",
				message: `${options.requested} is not configured for this AIRA deployment.`,
				status: 503,
				runtimeId: options.requested,
			});
		}
		if (!state.ready) {
			throw new AgentRuntimeError({
				code: "RUNTIME_UNAVAILABLE",
				message: `${options.requested} is temporarily unavailable.`,
				status: 503,
				runtimeId: options.requested,
				retryable: true,
			});
		}
		return options.requested;
	}

	for (const id of options.priority ?? DEFAULT_RUNTIME_PRIORITY) {
		if (byId.get(id)?.ready) return id;
	}

	throw new AgentRuntimeError({
		code: "NO_AGENT_RUNTIME_READY",
		message: "No autonomous agent runtime is ready for this AIRA deployment.",
		status: 503,
	});
}
