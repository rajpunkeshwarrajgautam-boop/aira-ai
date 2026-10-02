import { buildAdvancedReasoningContext } from "./advanced-reasoning";
import { persistMemoriTurn, recallMemoriContext } from "./memori";
import { routeCognitiveCapabilities, type CognitiveRouteDecision } from "./policy";

export interface CognitiveContextResult {
	readonly decision: CognitiveRouteDecision;
	readonly contextItems: readonly string[];
	readonly advancedReasoningProvider?: "ADVANCED_REASONING_MCP" | "AIRA_EMBEDDED";
	readonly memoriRecallCount: number;
}

export async function prepareCognitiveContext(args: {
	readonly userId: string;
	readonly query: string;
	readonly projectId?: string;
	readonly sessionId?: string;
}): Promise<CognitiveContextResult> {
	const decision = routeCognitiveCapabilities(args.query);
	const contextItems: string[] = [];
	let advancedReasoningProvider: CognitiveContextResult["advancedReasoningProvider"];
	let memoriRecallCount = 0;

	if (decision.advancedReasoning) {
		const reasoning = await buildAdvancedReasoningContext(args.query);
		advancedReasoningProvider = reasoning.provider;
		contextItems.push(reasoning.context);
	}

	if (decision.memoryRecall && !decision.memoryDisabled) {
		const recalled = await recallMemoriContext({
			userId: args.userId,
			query: args.query,
			...(args.projectId ? { projectId: args.projectId } : {}),
			...(args.sessionId ? { sessionId: args.sessionId } : {}),
		});
		memoriRecallCount = recalled.length;
		if (recalled.length > 0) {
			contextItems.push(
				"MEMORI PERSISTENT MEMORY (recalled user/project context; may be stale; current user instructions and verified sources always win):\n" +
					recalled.join("\n\n"),
			);
		}
	}

	console.info(
		"[AiraCognitiveRouter] decision",
		JSON.stringify({
			advancedReasoning: decision.advancedReasoning,
			memoryRecall: decision.memoryRecall,
			memoryWrite: decision.memoryWrite,
			memoryDisabled: decision.memoryDisabled,
			reasonCodes: decision.reasonCodes,
			advancedReasoningProvider: advancedReasoningProvider ?? null,
			memoriRecallCount,
		}),
	);

	return {
		decision,
		contextItems,
		...(advancedReasoningProvider ? { advancedReasoningProvider } : {}),
		memoriRecallCount,
	};
}

export async function persistCognitiveMemoryTurn(args: {
	readonly userId: string;
	readonly query: string;
	readonly answer: string;
	readonly projectId?: string;
	readonly sessionId?: string;
}): Promise<boolean> {
	const decision = routeCognitiveCapabilities(args.query);
	if (!decision.memoryWrite || decision.memoryDisabled) return false;
	const persisted = await persistMemoriTurn({
		userId: args.userId,
		userMessage: args.query,
		assistantResponse: args.answer,
		...(args.projectId ? { projectId: args.projectId } : {}),
		...(args.sessionId ? { sessionId: args.sessionId } : {}),
	});
	console.info(
		"[AiraCognitiveRouter] memory write",
		JSON.stringify({ requested: true, persisted }),
	);
	return persisted;
}

export { containsProhibitedMemoryData, isMemoriConfigured } from "./memori";
export { routeCognitiveCapabilities } from "./policy";
export type { CognitiveRouteDecision } from "./policy";
