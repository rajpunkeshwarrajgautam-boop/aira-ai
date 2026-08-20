/**
 * Stale-run reconciliation shared by every autonomous agent runtime.
 *
 * Both adapters persist an `AgentRun` row, consume quota, and only then submit to
 * the remote runtime. A serverless invocation that dies in that window leaves a
 * non-terminal row with no `remoteExecutionId`, and both `refreshAgentRun` and
 * `refreshDeerFlowAgentRun` return early on exactly that shape. The run then spins
 * in the workspace forever. A run whose remote execution disappears (host rebuilt,
 * thread pruned) stalls the same way.
 *
 * These bounds convert both cases into an honest terminal state. Quota is
 * deliberately NOT refunded: a missing `remoteExecutionId` means the submission
 * outcome is unknown, and the adapters already treat an unknown outcome as
 * non-refundable so an aborted connection cannot be used to reclaim quota.
 */

/** A submission that never recorded a remote id after this long was orphaned. */
export const UNSUBMITTED_GRACE_MS = 10 * 60 * 1_000;

/** An accepted run that never reached a terminal state is treated as stalled. */
export const MAX_RUN_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export type StaleRunReason = "UNSUBMITTED" | "STALLED";

export interface StaleRunInput {
	readonly remoteExecutionId: string | null;
	readonly createdAt: Date;
	readonly now?: Date;
}

export interface StaleRunDecision {
	readonly reason: StaleRunReason;
	readonly errorMessage: string;
}

/**
 * Decides whether a non-terminal run has outlived its bound. Callers must only
 * pass runs they have already established are in a non-terminal state.
 */
export function classifyStaleRun(input: StaleRunInput): StaleRunDecision | null {
	const ageMs = (input.now ?? new Date()).getTime() - input.createdAt.getTime();

	if (!input.remoteExecutionId) {
		if (ageMs < UNSUBMITTED_GRACE_MS) return null;
		return {
			reason: "UNSUBMITTED",
			errorMessage:
				"AIRA could not confirm that this task was handed to the agent runtime, so it was closed. " +
				"It was not retried automatically to avoid starting duplicate autonomous work. Submit it again if it is still needed.",
		};
	}

	if (ageMs < MAX_RUN_LIFETIME_MS) return null;
	return {
		reason: "STALLED",
		errorMessage:
			"This task was accepted by the agent runtime but never reported a final state within 24 hours, so AIRA closed it.",
	};
}
