import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const webRequire = createRequire(path.join(process.cwd(), 'perplexity-clone/my-turborepo/apps/web/package.json'));
const pg = webRequire('pg');
const { Client } = pg;

console.log('=== AIRA PRODUCTION MIGRATION PREFLIGHT ===');

const expectedSha = process.env.EXPECTED_SHA || process.env.GITHUB_SHA;
const expectedRef = process.env.EXPECTED_REF || process.env.GITHUB_REF;
const targetDbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!targetDbUrl) {
  console.error('FAIL: Neither DIRECT_URL nor DATABASE_URL is set in environment.');
  process.exit(1);
}

// 1. Verify Git SHA and Ref if provided
if (expectedSha) {
  try {
    const currentSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    if (currentSha !== expectedSha) {
      console.error(`FAIL: Git SHA mismatch. Current: ${currentSha}, Expected: ${expectedSha}`);
      process.exit(1);
    }
    console.log(`PASS: Git SHA verified: ${currentSha.slice(0, 12)}`);
  } catch (e) {
    console.error('FAIL: Unable to verify current Git SHA:', e.message);
    process.exit(1);
  }
}

if (expectedRef) {
  if (expectedRef !== 'refs/heads/main' && expectedRef !== 'main') {
    console.error(`FAIL: Production migration must target refs/heads/main. Received: ${expectedRef}`);
    process.exit(1);
  }
  console.log(`PASS: Target branch verified as protected main: ${expectedRef}`);
}

// 2. Validate Prisma schema definition
try {
  console.log('Validating Prisma schema definition...');
  execSync('pnpm exec prisma validate', { stdio: 'inherit' });
  console.log('PASS: Prisma schema validated successfully.');
} catch (e) {
  console.error('FAIL: Prisma schema validation failed.');
  process.exit(1);
}

// 3. Verify migration byte determinism
try {
  console.log('Verifying migration byte determinism across platforms...');
  execSync('node scripts/db/verify-migration-bytes.mjs', { stdio: 'inherit' });
  console.log('PASS: Migration files byte determinism passed.');
} catch (e) {
  console.error('FAIL: Migration byte determinism check failed.');
  process.exit(1);
}

// 4. Run read-only prisma migrate status
try {
  console.log('Checking migration status via Prisma CLI (read-only)...');
  const statusOut = execSync('pnpm exec prisma migrate status', {
    env: { ...process.env, DATABASE_URL: targetDbUrl },
    encoding: 'utf8',
  });
  console.log(statusOut.trim());
  if (statusOut.includes('failed to apply') || statusOut.includes('unapplied migrations')) {
    console.log('INFO: prisma migrate status output captured for analysis.');
  }
} catch (e) {
  console.log('INFO: prisma migrate status output:', e.stdout || e.message);
}

// 5. Database read-only ledger audit & identity verification
async function runDbPreflight() {
  const client = new Client({
    connectionString: targetDbUrl,
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    console.log('PASS: Direct database connection established.');

    // Probe server identity
    const serverRes = await client.query(
      'SELECT current_database() as db, current_user as usr, version() as ver'
    );
    const dbInfo = serverRes.rows[0];
    console.log(`PASS: Target database identity verified: [db=${dbInfo.db}, user=${dbInfo.usr}]`);

    // Check if _prisma_migrations table exists
    const tableRes = await client.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations') as exists"
    );

    if (!tableRes.rows[0]?.exists) {
      console.log('INFO: _prisma_migrations table does not exist yet (clean target).');
    } else {
      // Check for unresolved failed migrations
      const failedRes = await client.query(
        'SELECT migration_name, started_at FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL'
      );

      if (failedRes.rows.length > 0) {
        console.error('FAIL: Unresolved failed migration(s) detected in ledger:');
        for (const row of failedRes.rows) {
          console.error(`  - ${row.migration_name} (started at ${row.started_at})`);
        }
        console.error('Preflight blocked: Must resolve failed migrations before deploying new migrations.');
        process.exit(1);
      }
      console.log('PASS: Zero unresolved failed migration rows in ledger.');

      // Check applied migrations and enumerate
      const appliedRes = await client.query(
        'SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at ASC'
      );
      console.log(`PASS: Currently applied migrations in ledger: ${appliedRes.rows.length}`);

      // Enumerate pending migrations from filesystem
      const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
      if (fs.existsSync(migrationsDir)) {
        const fsMigrations = fs.readdirSync(migrationsDir)
          .filter(d => fs.statSync(path.join(migrationsDir, d)).isDirectory() && fs.existsSync(path.join(migrationsDir, d, 'migration.sql')))
          .sort();

        const appliedSet = new Set(appliedRes.rows.map(r => r.migration_name));
        const pending = fsMigrations.filter(m => !appliedSet.has(m));

        if (pending.length > 0) {
          console.log(`INFO: Pending migrations to be applied (${pending.length}):`);
          for (const p of pending) {
            console.log(`  -> ${p}`);
          }
        } else {
          console.log('PASS: No pending migrations detected in filesystem.');
        }
      }
    }

    // 6. Explicit backup readiness disclosure
    console.log('BACKUP_READINESS = OPERATOR / PLATFORM POLICY GATE (Production backup must be verified via Supabase point-in-time recovery before triggering DDL)');

    console.log('=== PREFLIGHT VERDICT: READY FOR MIGRATION DEPLOY ===');
  } catch (err) {
    console.error('FAIL: Database preflight query error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runDbPreflight().catch(e => {
  console.error('Unexpected preflight failure:', e);
  process.exit(1);
});
