import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;

console.log("=== AIRA PRODUCTION MIGRATION POSTFLIGHT ===");

const targetDbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!targetDbUrl) {
	console.error("FAIL: Neither DIRECT_URL nor DATABASE_URL is set in environment.");
	process.exit(1);
}

const ROOT_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT_DIR, "prisma", "migrations");

function sha256(buffer) {
	return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function runPostflight() {
	// 1. Run prisma migrate status
	console.log("Running prisma migrate status...");
	try {
		const statusOutput = execSync("pnpm exec prisma migrate status", {
			env: { ...process.env, DATABASE_URL: targetDbUrl },
			encoding: "utf8",
		});
		console.log(statusOutput);
		if (!statusOutput.includes("Database schema is up to date")) {
			console.error("FAIL: prisma migrate status reported database is not up to date.");
			process.exit(1);
		}
		console.log("PASS: prisma migrate status verified database schema is up to date.");
	} catch (e) {
		console.error("FAIL: prisma migrate status failed:", e.message);
		process.exit(1);
	}

	// 2. Direct ledger inspection via pg
	const client = new Client({
		connectionString: targetDbUrl,
		connectionTimeoutMillis: 10000,
	});

	try {
		await client.connect();

		const ledgerRows = await client.query(
			'SELECT id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at ASC',
		);

		console.log(`Auditing ${ledgerRows.rows.length} applied migration records in _prisma_migrations...`);

		const evidence = {
			verifiedAt: new Date().toISOString(),
			totalAppliedMigrations: ledgerRows.rows.length,
			migrations: [],
		};

		let auditFailed = false;

		for (const row of ledgerRows.rows) {
			if (!row.finished_at) {
				console.error(`FAIL: Migration ${row.migration_name} has null finished_at.`);
				auditFailed = true;
			}
			if (row.rolled_back_at !== null) {
				console.error(`FAIL: Migration ${row.migration_name} has non-null rolled_back_at.`);
				auditFailed = true;
			}
			if (row.applied_steps_count !== 1) {
				console.error(`FAIL: Migration ${row.migration_name} has applied_steps_count != 1 (${row.applied_steps_count}).`);
				auditFailed = true;
			}

			evidence.migrations.push({
				migrationName: row.migration_name,
				checksum: row.checksum,
				appliedStepsCount: row.applied_steps_count,
				finishedAt: row.finished_at,
			});
		}

		if (auditFailed) {
			console.error("FAIL: Migration ledger audit detected corrupted or incomplete migration records.");
			process.exit(1);
		}
		console.log("PASS: All ledger rows are completed with rolled_back_at=null and applied_steps_count=1.");

		// 3. Physical schema verification for Release 4 table & index
		const tableCheck = await client.query(
			"SELECT to_regclass('public.\"BrowserRateLimitEvent\"') as tbl, to_regclass('public.\"BrowserRateLimitEvent_userId_type_createdAt_idx\"') as idx",
		);

		if (!tableCheck.rows[0]?.tbl || !tableCheck.rows[0]?.idx) {
			console.error("FAIL: Expected physical schema objects missing (BrowserRateLimitEvent or its index).");
			process.exit(1);
		}
		console.log("PASS: Physical schema objects confirmed present.");

		// Write sanitized evidence file
		const outPath = path.join(ROOT_DIR, "migration-postflight-evidence.json");
		fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");
		console.log(`PASS: Postflight evidence written to: ${outPath}`);

		console.log("=== POSTFLIGHT VERDICT: ALL GATES PASSED ===");
	} catch (err) {
		console.error("FAIL: Database postflight error:", err.message);
		process.exit(1);
	} finally {
		await client.end();
	}
}

runPostflight().catch((e) => {
	console.error("Unexpected postflight failure:", e);
	process.exit(1);
});
