import { boundRuntimeContext } from "@services/runtime/context-budget";
import { getFollowUpContext as getCoreFollowUpContext } from "./conversation-memory-core";

export type {
	ConversationMessageDto,
	ConversationSummary,
} from "./conversation-memory-core";

export {
	createConversation,
	getAnonymousSearchContext,
	getConversationOrThrow,
	listConversationMessages,
	listConversations,
	listResearchHistory,
	persistConversationTurn,
} from "./conversation-memory-core";

/**
 * Context-assembly boundary around the existing persistence implementation.
 *
 * The DB queries, recall ranking, rolling summary, and persistence behavior stay in the
 * preserved core. This facade applies one aggregate application-owned budget before
 * context is passed to retrieval/model orchestration, preventing unbounded prompt growth.
 */
export async function getFollowUpContext(
	args: Parameters<typeof getCoreFollowUpContext>[0],
): Promise<Awaited<ReturnType<typeof getCoreFollowUpContext>>> {
	const context = await getCoreFollowUpContext(args);
	const bounded = boundRuntimeContext({
		chatHistory: context.chatHistory,
		contextualMemory: context.contextualMemory,
	});

	if (
		bounded.diagnostics.droppedHistoryTurns > 0 ||
		bounded.diagnostics.clippedMemoryItems > 0 ||
		bounded.diagnostics.outputChars < bounded.diagnostics.inputChars
	) {
		console.info(
			"[AIRA context]",
			JSON.stringify({
				inputChars: bounded.diagnostics.inputChars,
				outputChars: bounded.diagnostics.outputChars,
				droppedHistoryTurns: bounded.diagnostics.droppedHistoryTurns,
				clippedMemoryItems: bounded.diagnostics.clippedMemoryItems,
			}),
		);
	}

	return {
		chatHistory: bounded.chatHistory,
		contextualMemory: bounded.contextualMemory,
		resolvedConversationId: context.resolvedConversationId,
	};
}
