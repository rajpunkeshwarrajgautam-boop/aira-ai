import { canonicalDurableMemoryText, isExplicitDurableMemoryRequest } from "./conversation-thread";
import { createManualMemory } from "./persistent-memory";
import type { GroundedAnswerStreamResult } from "../src/services/answer";

/** Acknowledge direct memory commands only after the user-owned write succeeds. */
export async function createMemoryCommandAnswer(args: {
	readonly userId: string;
	readonly query: string;
}): Promise<GroundedAnswerStreamResult | null> {
	if (!isExplicitDurableMemoryRequest(args.query)) return null;
	const command = args.query.trim()
		.replace(/^correction\s*[:,-]\s*/i, "")
		.replace(/^actually[,:]?\s*/i, "");
	if (!/^(?:please\s+)?(?:remember\s+(?:that|this)\b|(?:change|update|replace)\s+what\s+you\s+remember\s+about\s+my\b|(?:save|store)\s+(?:this|that)\s+(?:preference|decision|constraint|rule|context)\b)/i.test(command)) return null;

	const memory = await createManualMemory({
		userId: args.userId,
		content: canonicalDurableMemoryText(args.query),
		pinned: true,
	});
	return {
		query: args.query.trim(),
		sources: [],
		textStream: (async function* () {
			yield `Saved to memory: ${memory.content}`;
		})(),
	};
}
