import { canonicalDurableMemoryText } from "./conversation-thread";
import { memoryMatchesRequestedSubject, requestedMemorySubjects } from "./memory-relevance";

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
		for (const item of evidence) {
			const content = canonicalDurableMemoryText(item.content.replace(/^[A-Z_]+:\s*/, ""));
			const assignment = content.match(/^(.{3,160}?\bcode)\s+(?:is|=)\s+([\p{L}\p{N}](?:[\p{L}\p{N}_.-]{0,78}[\p{L}\p{N}])?)(?=$|[\s,.!?])/iu);
			if (assignment && memoryMatchesRequestedSubject(content, `What is my ${subject}?`)) {
				if (item.currentThread) values.clear();
				values.add(assignment[2]!);
			}
		}
		// Conflicting or missing evidence cannot borrow a sibling field's value.
		const value = values.size === 1 ? [...values][0]! : fields[index]![2] ?? "UNKNOWN";
		return `${fields[index]![1]!.trim()}: ${value}`;
	}).join("\n");
}
