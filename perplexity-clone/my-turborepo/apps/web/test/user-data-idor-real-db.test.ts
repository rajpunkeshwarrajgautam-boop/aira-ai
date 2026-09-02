import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { UserMemoryKind } from "@/generated/prisma/enums";
import { createKnowledgeAsset, updateKnowledgeAssetStatus } from "@/lib/knowledge-assets";
import {
	deleteUserMemory,
	listUserMemories,
	setUserMemoryPinned,
} from "@/lib/persistent-memory";
import { prisma } from "@/lib/prisma";

const REAL_DB = process.env.AIRA_REAL_DB_RECOVERY_TESTS === "1";

test(
	"REAL_DB: user memory, knowledge assets, and MCP server preferences enforce strict database tenant isolation",
	{ skip: !REAL_DB, timeout: 60_000 },
	async (t) => {
		const suffix = randomUUID();
		const ownerId = `user-data-owner-${suffix}`;
		const attackerId = `user-data-attacker-${suffix}`;

		t.after(async () => {
			await prisma.user.deleteMany({ where: { id: { in: [ownerId, attackerId] } } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		await prisma.user.createMany({
			data: [
				{ id: ownerId, email: `${ownerId}@example.test` },
				{ id: attackerId, email: `${attackerId}@example.test` },
			],
		});

		// 1. KnowledgeAsset database-level user binding
		const ownerAssetId = await createKnowledgeAsset({
			userId: ownerId,
			filename: "owner-secret.pdf",
			mimeType: "application/pdf",
			sizeBytes: 1024,
			sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			storageKey: `knowledge/${ownerId}/owner-secret.pdf`,
		});

		// Attacker attempting to update status of Owner's asset is rejected by raw SQL predicate
		await assert.rejects(
			() => updateKnowledgeAssetStatus({ assetId: ownerAssetId, userId: attackerId, status: "READY" }),
			(error: unknown) => error instanceof Error && error.message.includes("was not found for this user"),
		);

		// Verify Owner A asset remains strictly unchanged
		const [ownerAsset] = await prisma.$queryRaw<Array<{ status: string; errorMessage: string | null }>>`
			select status, "errorMessage" from public."KnowledgeAsset" where id = ${ownerAssetId} and "userId" = ${ownerId}
		`;
		assert.equal(ownerAsset?.status, "UPLOADING");
		assert.equal(ownerAsset?.errorMessage, null);

		// 2. UserMemory service & database isolation
		const memory = await prisma.userMemory.create({
			data: {
				userId: ownerId,
				memoryKey: `pref-theme-${suffix}`,
				content: "User prefers dark mode for all interface themes",
				kind: UserMemoryKind.PREFERENCE,
				pinned: true,
			},
		});

		// Attacker query returns null
		assert.equal(
			await prisma.userMemory.findFirst({ where: { id: memory.id, userId: attackerId } }),
			null,
		);

		// Service function calls by attacker return empty or false
		assert.equal((await listUserMemories(attackerId)).length, 0);
		assert.equal(await setUserMemoryPinned(attackerId, memory.id, false), false);
		assert.equal(await deleteUserMemory(attackerId, memory.id), false);

		// Verify Owner memory remains unchanged
		const ownerMem = await prisma.userMemory.findFirst({ where: { id: memory.id, userId: ownerId } });
		assert.equal(ownerMem?.pinned, true);
		assert.equal(ownerMem?.content, "User prefers dark mode for all interface themes");

		// 3. McpServerPreference compound (userId, serverId) isolation
		await prisma.mcpServerPreference.upsert({
			where: { userId_serverId: { userId: ownerId, serverId: "github" } },
			create: { userId: ownerId, serverId: "github", enabled: true },
			update: { enabled: true },
		});
		await prisma.mcpServerPreference.upsert({
			where: { userId_serverId: { userId: attackerId, serverId: "github" } },
			create: { userId: attackerId, serverId: "github", enabled: false },
			update: { enabled: false },
		});

		const ownerPref = await prisma.mcpServerPreference.findUnique({
			where: { userId_serverId: { userId: ownerId, serverId: "github" } },
		});
		const attackerPref = await prisma.mcpServerPreference.findUnique({
			where: { userId_serverId: { userId: attackerId, serverId: "github" } },
		});

		assert.equal(ownerPref?.enabled, true);
		assert.equal(attackerPref?.enabled, false);
	},
);
