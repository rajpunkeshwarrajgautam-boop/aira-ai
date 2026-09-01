import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createPlatformRun, createProject } from "@/lib/agent-platform/store";
import { DEFAULT_RUN_BUDGETS } from "@/lib/agent-platform/types";
import {
	claimToolCallForExecution,
	completeToolCall,
	createToolCall,
} from "@/lib/tool-gateway/store";
import { executeTool, toolInputHash } from "@/lib/tool-gateway/gateway";
import { prisma } from "@/lib/prisma";

const REAL_DB = process.env.AIRA_REAL_DB_RECOVERY_TESTS === "1";

test(
	"REAL_DB: duplicate and concurrent tool completion deliveries charge a mission once",
	{ skip: !REAL_DB, timeout: 45_000 },
	async (t) => {
		const suffix = randomUUID();
		const userId = `tool-completion-owner-${suffix}`;
		await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
		t.after(async () => {
			await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		const project = await createProject({
			userId,
			name: `Tool completion ${suffix}`,
			objective: "Prove completion replay cannot double-charge a mission.",
		});
		const run = await createPlatformRun({
			userId,
			projectId: project.id,
			clientRequestId: `tool-completion-run-${suffix}`,
			runtime: null,
			budgets: DEFAULT_RUN_BUDGETS,
			tasks: [],
		});
		const context = {
			userId,
			projectId: project.id,
			runId: run.id,
			source: "SYSTEM" as const,
		};
		const call = await createToolCall({
			context,
			clientRequestId: `tool-completion-call-${suffix}`,
			tool: "web",
			action: "fetch",
			risk: "LOW",
			inputHash: `sha256:${suffix}`,
			inputSummary: { url: "https://example.test" },
		});
		assert.equal(await claimToolCallForExecution({
			userId,
			toolCallId: call.id,
			inputHash: call.inputHash,
			approvalSatisfied: false,
		}), true);

		const completion = {
			toolCallId: call.id,
			result: { ok: true },
			usage: { inputTokens: 11, outputTokens: 7, cachedTokens: 2, costUsd: 0.42, costKnown: true },
		};
		await Promise.all([completeToolCall(completion), completeToolCall(completion)]);
		await completeToolCall(completion);

		const usage = await prisma.$queryRaw<Array<{
			inputTokensUsed: bigint;
			outputTokensUsed: bigint;
			cachedTokensUsed: bigint;
			knownCostUsd: string;
			costAccountingComplete: boolean;
		}>>`
			select "inputTokensUsed", "outputTokensUsed", "cachedTokensUsed",
			trim_scale("knownCostUsd")::text as "knownCostUsd", "costAccountingComplete"
			from "AgentPlatformRun" where "id"=${run.id}
		`;
		assert.deepEqual(usage[0], {
			inputTokensUsed: 11n,
			outputTokensUsed: 7n,
			cachedTokensUsed: 2n,
			knownCostUsd: "0.42",
			costAccountingComplete: false,
		});
		const completed = await prisma.$queryRaw<Array<{ status: string; completedAt: Date | null }>>`
			select "status", "completedAt" from "AgentToolCall" where "id"=${call.id}
		`;
		assert.equal(completed[0]?.status, "COMPLETED");
		assert.ok(completed[0]?.completedAt);
	},
);

test(
	"REAL_DB: an exact completed web request replays while its adapter is unavailable",
	{ skip: !REAL_DB, timeout: 45_000 },
	async (t) => {
		const suffix = randomUUID();
		const userId = `tool-replay-owner-${suffix}`;
		await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
		t.after(async () => {
			await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		const project = await createProject({ userId, name: `Tool replay ${suffix}`, objective: "Replay a completed request without provider availability." });
		const run = await createPlatformRun({ userId, projectId: project.id, clientRequestId: `tool-replay-run-${suffix}`, runtime: null, budgets: DEFAULT_RUN_BUDGETS, tasks: [] });
		const context = { userId, projectId: project.id, runId: run.id, source: "SYSTEM" as const };
		const request = {
			clientRequestId: `tool-replay-call-${suffix}`,
			tool: "web" as const,
			action: "retrieve",
			input: { query: "replay-only proof", numResults: 1 },
		};
		const call = await createToolCall({
			context,
			clientRequestId: request.clientRequestId,
			tool: request.tool,
			action: request.action,
			risk: "LOW",
			inputHash: toolInputHash(request.input),
			inputSummary: { query: request.input.query },
		});
		assert.equal(await claimToolCallForExecution({ userId, toolCallId: call.id, inputHash: call.inputHash, approvalSatisfied: false }), true);
		assert.equal(await completeToolCall({ toolCallId: call.id, result: { answer: "persisted summary" }, usage: { costKnown: true } }), true);

		const priorExaKey = process.env.EXA_API_KEY;
		delete process.env.EXA_API_KEY;
		t.after(() => {
			if (priorExaKey === undefined) delete process.env.EXA_API_KEY;
			else process.env.EXA_API_KEY = priorExaKey;
		});
		const replay = await executeTool(context, request);
		assert.deepEqual(replay, {
			status: "COMPLETED",
			toolCallId: call.id,
			result: { answer: "persisted summary" },
			usage: { costKnown: true },
			resultFidelity: "SUMMARY",
		});
	},
);
