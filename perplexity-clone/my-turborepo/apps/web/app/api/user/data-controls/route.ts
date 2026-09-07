import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { globalDataLifecycleManager } from "@/lib/contracts/data-lifecycle";
import { globalUserAgentStore } from "@/lib/agents/user-agents-store";
import { globalSkillsStore } from "@/lib/agents/installable-skills-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	// Return summary counts of user data
	const userId = session.user.id;
	const [conversationCount, memoryCount, researchCount, customAgentsList, customSkillsList] = await Promise.all([
		prisma.conversation.count({ where: { userId } }).catch(() => 0),
		prisma.userMemory.count({ where: { userId } }).catch(() => 0),
		prisma.researchHistory.count({ where: { userId } }).catch(() => 0),
		globalUserAgentStore.listAgentsAsync(userId).catch(() => []),
		globalSkillsStore.listSkillsAsync(userId).catch(() => []),
	]);
	const customAgentCount = customAgentsList.filter((a) => a.userId === userId).length;
	const customSkillCount = customSkillsList.filter((s) => s.userId === userId).length;

	return json({
		summary: {
			conversationCount,
			memoryCount,
			researchCount,
			customAgentCount,
			customSkillCount,
		},
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	const body = (await req.json().catch(() => null)) as {
		action?: "export" | "delete";
		category?: "all" | "memories" | "conversations" | "agents";
	} | null;

	const userId = session.user.id;

	if (body?.action === "export") {
		// Full export of user data
		const [conversations, memories, researchHistory, allAgents, allSkills] = await Promise.all([
			prisma.conversation.findMany({
				where: { userId },
				include: { messages: true },
			}).catch(() => []),
			prisma.userMemory.findMany({ where: { userId } }).catch(() => []),
			prisma.researchHistory.findMany({ where: { userId } }).catch(() => []),
			globalUserAgentStore.listAgentsAsync(userId).catch(() => []),
			globalSkillsStore.listSkillsAsync(userId).catch(() => []),
		]);

		const customAgents = allAgents.filter((a) => a.userId === userId);
		const customSkills = allSkills.filter((s) => s.userId === userId);

		return json({
			exportDate: new Date().toISOString(),
			userId,
			data: {
				conversations,
				memories,
				researchHistory,
				customAgents,
				customSkills,
			},
		});
	}

	if (body?.action === "delete") {
		const category = body.category ?? "all";
		let itemsPurged = 0;

		if (category === "all" || category === "memories") {
			const deleted = await prisma.userMemory.deleteMany({ where: { userId } }).catch(() => ({ count: 0 }));
			itemsPurged += deleted.count;
		}
		if (category === "all" || category === "conversations") {
			const deleted = await prisma.conversation.deleteMany({ where: { userId } }).catch(() => ({ count: 0 }));
			itemsPurged += deleted.count;
		}

		// Generate cryptographic audit receipt via DataLifecycleManager (Gate 40)
		const receipt = globalDataLifecycleManager.generateDeletionReceipt(
			userId,
			category === "all" ? "USER_ACCOUNT_FULL_PURGE" : `CATEGORY_${category.toUpperCase()}`,
			itemsPurged,
		);

		return json({
			success: true,
			itemsPurged,
			receipt,
		});
	}

	return json({ error: { code: "BAD_REQUEST", message: "Invalid action. Supported actions: 'export', 'delete'." } }, { status: 400 });
}
