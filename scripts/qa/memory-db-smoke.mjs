// Disposable PGlite integration smoke: no production database is contacted.
// Install the optional QA packages outside the repository; see AIRA_RESEARCH_UX_AUDIT.md.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modules = process.env.AIRA_QA_MODULES;
if (!modules) throw new Error('Set AIRA_QA_MODULES to the directory containing the optional QA node_modules.');
const require = createRequire(path.join(path.resolve(modules), 'package.json'));
const { PGlite } = await import(require.resolve('@electric-sql/pglite'));
const { PGLiteSocketServer } = await import(require.resolve('@electric-sql/pglite-socket'));
const db = await PGlite.create();
let server;
try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(await readFile(path.join(root, 'prisma/baseline/20260429_initial_schema.sql'), 'utf8'));
  await db.exec(await readFile(path.join(root, 'prisma/migrations/20260818_add_persistent_user_memory/migration.sql'), 'utf8'));
  await db.exec(await readFile(path.join(root, 'prisma/migrations/20260925_add_conversation_pinned_at/migration.sql'), 'utf8'));
  await db.exec(`INSERT INTO "User" (id, name) VALUES ('aira-fixture-user', 'Fixture');`);
  // This server is loopback-only and exists only for the duration of this test.
  server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 55432 });
  await server.start();
  const web = path.join(root, 'perplexity-clone/my-turborepo/apps/web');
  const child = spawn(process.execPath, ['--import', path.join(web, 'test/resolver.mjs'), path.join(root, 'scripts/qa/memory-db-worker.mjs')], {
    cwd: web, stdio: 'inherit', env: { ...process.env, DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:55432/postgres' },
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) process.exitCode = 1;
} finally {
  await server?.stop();
  await db.close();
}
