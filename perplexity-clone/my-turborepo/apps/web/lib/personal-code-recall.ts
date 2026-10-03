import { canonicalDurableMemoryText } from "./conversation-thread";
import { memoryQueryTokens, requestedMemorySubjects } from "./memory-relevance";

/**
 * Exact, explicitly formatted multi-code recall needs no generated guesses.
 * Resolve each requested subject independently from supplied user-owned evidence.
 * Other questions and formats continue through the normal answer engine.
 */
export function resolveFormattedCodeRecall(input: {
	readonly query: string;
	readonly contextualMemory?: readonly string[];
	readonly chatHistory?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
}): string | null {
	const subjects = requestedMemorySubjects(input.query);
	if (subjects.length < 2 || !subjects.every((subject) => /\bcode$/i.test(subject))) return null;
	const format = input.query.match(/\b(?:fields?|format)\s*:\s*(.+)$/is)?.[1];
	if (!format) return null;
	const fields = format.split(/\s+and\s+|[;\n,]+/i).map((part) =>
		part.match(/^\s*([\p{L}][\p{L}\p{N} _-]{0,39}):\s*<code(?:\s+or\s+([\w-]{1,20}))?>\s*[.!]?\s*$/iu),
	);
	if (fields.length !== subjects.length || fields.some((field) => !field)) return null;

	const evidence = [
		...(input.contextualMemory ?? []).map((content) => ({ content, currentThread: false })),
		...(input.chatHistory ?? []).filter((turn) => turn.role === "user")
			.map((turn) => ({ content: turn.content, currentThread: true })),
	];
	return subjects.map((subject, index) => {
		const values = new Set<string>();
		const requested = new Set(memoryQueryTokens(subject));
		for (const item of evidence) {
			// Real context contains numbered memory blocks, while private user turns
			// can prefix an assignment with session instructions. Parse each line and
			// preserve every subject qualifier so a private code is never its sibling.
			for (const line of item.content.split(/\n/)) {
				const content = canonicalDurableMemoryText(line.replace(/^\s*\d+\.\s*/, "").replace(/^[A-Z_]+:\s*/, ""));
				for (const assignment of content.matchAll(/(?:^|\b(?:my|our|the user's)\s+)([^?!.:\n]{3,160}?\bcode)\s+(?:is|=)\s+([\p{L}\p{N}](?:[\p{L}\p{N}_.-]{0,78}[\p{L}\p{N}])?)(?=$|[\s,.!?])/giu)) {
					const stored = memoryQueryTokens(assignment[1]!);
					if (stored.length !== requested.size || !stored.every((token) => requested.has(token))) continue;
					if (item.currentThread) values.clear();
					values.add(assignment[2]!);
				}
			}
		}
		// Conflicting or missing evidence cannot borrow a sibling field's value.
		const value = values.size === 1 ? [...values][0]! : fields[index]![2] ?? "UNKNOWN";
		return `${fields[index]![1]!.trim()}: ${value}`;
	}).join("\n");
}
