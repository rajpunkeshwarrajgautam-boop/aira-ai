import {
	createManualMemory as createCoreManualMemory,
	getRelevantPersistentMemories as getCoreRelevantPersistentMemories,
	listUserMemories,
	refreshPersistentMemory as refreshCorePersistentMemory,
} from "./persistent-memory-core";
import {
	getSemanticMemoryScores,
	resolveSemanticEmbeddingRouteForUser,
	upsertUserMemoryEmbedding,
} from "@/lib/semantic-memory";

export type { UserMemoryDto } from "./persistent-memory-core";
export {
	deleteUserMemory,
	listUserMemories,
	setUserMemoryPinned,
} from "./persistent-memory-core";

function formatMemory(memory: Awaited<ReturnType<typeof listUserMemories>>[number]): string {
	return `${memory.kind}: ${memory.content}${memory.pinned ? " (pinned)" : ""}`;
}

export async function refreshPersistentMemory(
	args: Parameters<typeof refreshCorePersistentMemory>[0],
): Promise<Awaited<ReturnType<typeof refreshCorePersistentMemory>>> {
	const startedAt = Date.now();
	const result = await refreshCorePersistentMemory(args);
	if (result.upserts === 0) return result;

	try {
		const route = await resolveSemanticEmbeddingRouteForUser(args.userId);
		if (!route) return result;
		const memories = await listUserMemories(args.userId, 40);
		const changed = memories
			.filter((memory) => memory.updatedAt.getTime() >= startedAt - 1_500)
			.slice(0, Math.max(result.upserts, 1));
		await Promise.allSettled(
			changed.map((memory) =>
				upsertUserMemoryEmbedding({
					memoryId: memory.id,
					userId: args.userId,
					content: memory.content,
					route,
				}),
			),
		);
	} catch (error) {
		console.warn(
			"[AIRA semantic memory] Embedding refresh failed; lexical memory remains available:",
			error instanceof Error ? error.message : String(error),
		);
	}
	return result;
}

export async function getRelevantPersistentMemories(
	userId: string,
	query: string,
	limit = 8,
): Promise<readonly string[]> {
	const lexical = await getCoreRelevantPersistentMemories(userId, query, limit);

	try {
		const route = await resolveSemanticEmbeddingRouteForUser(userId);
		if (!route) return lexical;
		const [scores, memories] = await Promise.all([
			getSemanticMemoryScores(userId, query, Math.max(limit * 4, 24), route),
			listUserMemories(userId, 200),
		]);
		const semantic = memories
			.map((memory) => ({ memory, similarity: scores.get(memory.id) ?? -1 }))
			.filter(({ memory, similarity }) => memory.pinned || similarity >= 0.55)
			.sort(
				(a, b) =>
					Number(b.memory.pinned) - Number(a.memory.pinned) ||
					b.similarity - a.similarity ||
					b.memory.importance - a.memory.importance,
			)
			.map(({ memory }) => formatMemory(memory));

		const merged: string[] = [];
		const seen = new Set<string>();
		for (const item of [...semantic, ...lexical]) {
			const key = item.toLowerCase().trim();
			if (!key || seen.has(key)) continue;
			seen.add(key);
			merged.push(item);
			if (merged.length >= Math.min(Math.max(limit, 1), 10)) break;
		}
		return merged;
	} catch (error) {
		console.warn(
			"[AIRA semantic memory] Vector recall failed; using lexical memory:",
			error instanceof Error ? error.message : String(error),
		);
		return lexical;
	}
}

export async function createManualMemory(
	args: Parameters<typeof createCoreManualMemory>[0],
): Promise<Awaited<ReturnType<typeof createCoreManualMemory>>> {
	const memory = await createCoreManualMemory(args);
	void resolveSemanticEmbeddingRouteForUser(args.userId)
		.then((route) => {
			if (!route) return;
			return upsertUserMemoryEmbedding({
				memoryId: memory.id,
				userId: args.userId,
				content: memory.content,
				route,
			});
		})
		.catch((error) =>
			console.warn(
				"[AIRA semantic memory] Manual memory embedding failed:",
				error instanceof Error ? error.message : String(error),
			),
		);
	return memory;
}
