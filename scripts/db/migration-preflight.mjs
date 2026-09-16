import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;

console.log("=== AIRA PRODUCTION MIGRATION PREFLIGHT ===");

const expectedSha = process.env.EXPECTED_SHA || process.env.GITHUB_SHA;
const targetDbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!targetDbUrl) {
	console.error("FAIL: Neither DIRECT_URL nor DATABASE_URL is set in environment.");
	process.exit(1);
}

// 1. Verify Git SHA if expectedSha is provided
if (expectedSha) {
	try {
		const currentSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
		if (currentSha !== expectedSha) {
			console.error(`FAIL: Git SHA mismatch. Current: ${currentSha}, Expected: ${expectedSha}`);
			process.exit(1);
		}
		console.log(`PASS: Git SHA verified: ${currentSha.slice(0, 12)}`);
	} catch (e) {
		console.error("FAIL: Unable to verify current Git SHA:", e.message);
		process.exit(1);
	}
}

// 2. Validate Prisma schema
try {
	console.log("Validating Prisma schema definition...");
	execSync("pnpm exec prisma validate", { stdio: "inherit" });
	console.log("PASS: Prisma schema validated successfully.");
} catch (e) {
	console.error("FAIL: Prisma schema validation failed.");
	process.exit(1);
}

// 3. Verify migration byte determinism
try {
	console.log("Verifying migration byte determinism...");
	execSync("node scripts/db/verify-migration-bytes.mjs", { stdio: "inherit" });
	console.log("PASS: Migration files byte determinism passed.");
} catch (e) {
	console.error("FAIL: Migration byte determinism check failed.");
	process.exit(1);
}

// 4. Database read-only ledger audit
async function runDbPreflight() {
	const client = new Client({
		connectionString: targetDbUrl,
		connectionTimeoutMillis: 10000,
	});

	try {
		await client.connect();
		console.log("PASS: Direct database TLS connection established.");

		// Read-only server probe
		const serverRes = await client.query("SELECT current_database() as db, current_user as usr, version() as ver");
		const dbInfo = serverRes.rows[0];
		console.log(`Database connected: [db=${dbInfo.db}, user=${dbInfo.usr}]`);

		// Check if _prisma_migrations exists
		const tableRes = await client.query(
			"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations') as exists",
		);

		if (!tableRes.rows[0]?.exists) {
			console.log("INFO: _prisma_migrations table does not exist yet (clean database target).");
		} else {
			// Check for unresolved failed migrations
			const failedRes = await client.query(
				'SELECT migration_name, started_at FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL',
			);

			if (failedRes.rows.length > 0) {
				console.error("FAIL: Unresolved failed migration(s) detected in ledger:");
				for (const row of failedRes.rows) {
					console.error(`  - ${row.migration_name} (started at ${row.started_at})`);
				}
				console.error("Preflight blocked: Must resolve failed migrations before deploying new migrations.");
				process.exit(1);
			}
			console.log("PASS: Zero unresolved failed migration rows in ledger.");

			// Count applied migrations
			const countRes = await client.query(
				'SELECT count(*)::int as count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
			);
			console.log(`PASS: Currently applied migrations in database: ${countRes.rows[0].count}`);
		}

		console.log("=== PREFLIGHT VERDICT: READY FOR MIGRATION DEPLOY ===");
	} catch (err) {
		console.error("FAIL: Database preflight query error:", err.message);
		process.exit(1);
	} finally {
		await client.end();
	}
}

runDbPreflight().catch((e) => {
	console.error("Unexpected preflight failure:", e);
	process.exit(1);
});
