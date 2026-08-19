export interface RuntimeContextInput {
	readonly chatHistory: readonly {
		readonly role: "user" | "assistant";
		readonly content: string;
	}[];
	readonly contextualMemory: readonly string[];
}

export interface RuntimeContextResult extends RuntimeContextInput {
	readonly diagnostics: {
		readonly inputChars: number;
		readonly outputChars: number;
		readonly droppedHistoryTurns: number;
		readonly clippedMemoryItems: number;
	};
}

const DEFAULT_CONTEXT_CHAR_BUDGET = 96_000;
const DEFAULT_MEMORY_CHAR_BUDGET = 24_000;
const MAX_SINGLE_HISTORY_TURN_CHARS = 14_000;
const MAX_SINGLE_MEMORY_ITEM_CHARS = 9_000;

function envPositiveInt(name: string, fallback: number): number {
	const value = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clipMiddle(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	if (maxChars < 200) return value.slice(0, maxChars);
	const marker = "\n…[context clipped by AIRA runtime]…\n";
	const available = Math.max(0, maxChars - marker.length);
	const head = Math.ceil(available * 0.62);
	const tail = Math.max(0, available - head);
	return `${value.slice(0, head)}${marker}${tail > 0 ? value.slice(-tail) : ""}`;
}

function totalChars(input: RuntimeContextInput): number {
	return (
		input.chatHistory.reduce((sum, turn) => sum + turn.content.length, 0) +
		input.contextualMemory.reduce((sum, item) => sum + item.length, 0)
	);
}

/**
 * Bounds application-owned context before provider submission.
 *
 * Durable memory receives a reserved budget first; then the newest conversation turns
 * are retained. This complements conversation summaries and protects the runtime from
 * accidental prompt growth without pretending to control the model provider's actual
 * context window or KV cache.
 */
export function boundRuntimeContext(input: RuntimeContextInput): RuntimeContextResult {
	const maxContextChars = envPositiveInt(
		"AIRA_CONTEXT_CHAR_BUDGET",
		DEFAULT_CONTEXT_CHAR_BUDGET,
	);
	const maxMemoryChars = Math.min(
		envPositiveInt("AIRA_MEMORY_CONTEXT_CHAR_BUDGET", DEFAULT_MEMORY_CHAR_BUDGET),
		Math.floor(maxContextChars * 0.5),
	);

	const memory: string[] = [];
	let memoryChars = 0;
	let clippedMemoryItems = 0;
	for (const raw of input.contextualMemory) {
		if (memoryChars >= maxMemoryChars) break;
		const perItemLimit = Math.min(MAX_SINGLE_MEMORY_ITEM_CHARS, maxMemoryChars - memoryChars);
		if (perItemLimit <= 0) break;
		const clipped = clipMiddle(raw, perItemLimit);
		if (clipped.length < raw.length) clippedMemoryItems += 1;
		memory.push(clipped);
		memoryChars += clipped.length;
	}

	let remaining = Math.max(0, maxContextChars - memoryChars);
	const historyNewestFirst: { role: "user" | "assistant"; content: string }[] = [];
	for (let index = input.chatHistory.length - 1; index >= 0; index -= 1) {
		if (remaining <= 0) break;
		const turn = input.chatHistory[index]!;
		const perTurnLimit = Math.min(MAX_SINGLE_HISTORY_TURN_CHARS, remaining);
		if (perTurnLimit < 400) break;
		const content = clipMiddle(turn.content, perTurnLimit);
		historyNewestFirst.push({ role: turn.role, content });
		remaining -= content.length;
	}

	const chatHistory = historyNewestFirst.reverse();
	const output: RuntimeContextInput = {
		chatHistory,
		contextualMemory: memory,
	};

	return {
		...output,
		diagnostics: {
			inputChars: totalChars(input),
			outputChars: totalChars(output),
			droppedHistoryTurns: Math.max(0, input.chatHistory.length - chatHistory.length),
			clippedMemoryItems,
		},
	};
}
