import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);

const REAL_DB = process.env.AIRA_REAL_DB_RECOVERY_TESTS === "1";
const DB_URL = process.env.DATABASE_URL || "postgresql://postgres:5a9JxZilRGJStwIhp9BKUi5gwO8Z7MdP@127.0.0.1:5432/aira_gate29_local";

test(
	"REAL_DB: TRUTHMODE PHASE 12: Real Cold-Start Durability Across 3 Independent Subprocesses (Process A -> Process B -> Process C)",
	{ skip: !REAL_DB, timeout: 60_000 },
	async (t) => {
	// 1. Create separate, isolated storage directories for each process to guarantee NO shared disk state
	const baseTmp = tmpdir();
	const dirProcA = mkdtempSync(join(baseTmp, "aira-proc-a-"));
	const dirProcB = mkdtempSync(join(baseTmp, "aira-proc-b-"));
	const dirProcC = mkdtempSync(join(baseTmp, "aira-proc-c-"));

	let createdUserId: string | null = null;

	t.after(async () => {
		// Clean up isolated directories
		for (const d of [dirProcA, dirProcB, dirProcC]) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}

		// Clean up created test user from DB
		if (createdUserId) {
			await prisma.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		}
	});

	const childScript = join(process.cwd(), "test", "truthmode-cold-start-child.ts");
	const nodeArgs = [
		"--experimental-test-module-mocks",
		"--import",
		"./test/resolver.mjs",
		childScript,
	];

	// =========================================================================
	// PROCESS A: Seeds DB with UserAgent, Skill, Artifact, Routine, Run, Notif
	// =========================================================================
	const resA = await execFileAsync(
		process.execPath,
		[...nodeArgs, "seed"],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				DATABASE_URL: DB_URL,
				AIRA_DATA_DIR: dirProcA,
			},
		},
	);

	assert.equal(resA.stderr, "", `Process A stderr: ${resA.stderr}`);
	const outputA = JSON.parse(resA.stdout.trim());
	assert.ok(outputA.userId, "Process A must return created userId");
	assert.ok(outputA.agentId, "Process A must return created agentId");
	assert.ok(outputA.skillId, "Process A must return created skillId");
	assert.ok(outputA.artifactId, "Process A must return created artifactId");
	assert.ok(outputA.routineId, "Process A must return created routineId");
	assert.ok(outputA.runId, "Process A must return created runId");

	createdUserId = outputA.userId;

	// =========================================================================
	// PROCESS B: Fresh process, isolated dirProcB (NO local disk state from A).
	// Reconstructs all state from DB, verifies correctness, and updates entities.
	// =========================================================================
	const resB = await execFileAsync(
		process.execPath,
		[...nodeArgs, "verify-and-update", JSON.stringify(outputA)],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				DATABASE_URL: DB_URL,
				AIRA_DATA_DIR: dirProcB,
			},
		},
	);

	assert.equal(resB.stderr, "", `Process B stderr: ${resB.stderr}`);
	const outputB = JSON.parse(resB.stdout.trim());
	assert.equal(outputB.success, true, "Process B must verify and update entities in DB");

	// =========================================================================
	// PROCESS C: Third fresh process, isolated dirProcC (NO local disk state).
	// Verifies the mutated state, verifies idempotent replay, and verifies notifications.
	// =========================================================================
	const resC = await execFileAsync(
		process.execPath,
		[...nodeArgs, "verify-final", JSON.stringify(outputA)],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				DATABASE_URL: DB_URL,
				AIRA_DATA_DIR: dirProcC,
			},
		},
	);

	assert.equal(resC.stderr, "", `Process C stderr: ${resC.stderr}`);
	const outputC = JSON.parse(resC.stdout.trim());
	assert.equal(outputC.verified, true, "Process C must verify final DB state");
	assert.ok(outputC.notificationsCount >= 2, "Process C must see all persisted notifications");
});
