import type { AgentRuntimeId } from "./types";

/**
 * Operator-declared runtimes whose trusted worker process has been configured
 * with the server-side AIRA Tool Gateway bridge. The model never receives the
 * bridge token; it only receives non-secret task/workspace identifiers.
 */
export function runtimeHasControlledTools(runtimeId: AgentRuntimeId): boolean {
	const configured = new Set(
		(process.env.AIRA_AGENT_CONTROLLED_TOOL_RUNTIMES ?? "")
			.split(",")
			.map((value) => value.trim().toUpperCase())
			.filter(Boolean),
	);
	return configured.has(runtimeId);
}
