import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'prisma', 'migrations');
const GITATTRIBUTES_FILE = path.join(ROOT_DIR, '.gitattributes');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

console.log('--- AIRA MIGRATION BYTE & CHECKSUM VERIFIER ---');

// 1. Verify .gitattributes exists and has eol rules
if (!fs.existsSync(GITATTRIBUTES_FILE)) {
  console.error('FAIL: .gitattributes does not exist at repository root.');
  process.exit(1);
}

const gitattributesContent = fs.readFileSync(GITATTRIBUTES_FILE, 'utf8');
if (!gitattributesContent.includes('prisma/migrations/**/*.sql text eol=lf')) {
  console.error('FAIL: .gitattributes missing future migration LF rule: prisma/migrations/**/*.sql text eol=lf');
  process.exit(1);
}
console.log('PASS: .gitattributes contains deterministic migration rules.');

// 2. Scan all migrations
const migrations = fs.readdirSync(MIGRATIONS_DIR)
  .filter(item => fs.statSync(path.join(MIGRATIONS_DIR, item)).isDirectory())
  .sort();

console.log(`Found ${migrations.length} migration directories in prisma/migrations.`);

// Known Release 4 baseline checksum
const RELEASE4_MIGRATION = '20260912_browser_rate_limit_events';
const RELEASE4_EXPECTED_PROD_CHECKSUM = '42e6b334d7f92f2688d8b1650ee8295e74f53433870a7e7db292da35ee0a5c7c';
const RELEASE4_LF_CHECKSUM = '2cc1796735b58a9d0f2a90cfb82f052d24b48f7c64b428c4c218c99db372682f';

let hasErrors = false;

for (const mig of migrations) {
  const migPath = path.join(MIGRATIONS_DIR, mig, 'migration.sql');
  if (!fs.existsSync(migPath)) {
    console.warn(`WARN: Directory ${mig} has no migration.sql file.`);
    continue;
  }

  const rawBytes = fs.readFileSync(migPath);
  const hash = sha256(rawBytes);
  const hasCRLF = rawBytes.includes(Buffer.from('\r\n'));

  if (mig === RELEASE4_MIGRATION) {
    if (hash === RELEASE4_EXPECTED_PROD_CHECKSUM) {
      console.log(`PASS: ${mig} matches production ledger checksum (${hash}).`);
    } else if (hash === RELEASE4_LF_CHECKSUM) {
      console.log(`INFO: ${mig} has LF bytes (${hash}), compatible with git object.`);
    } else {
      console.error(`FAIL: ${mig} checksum mismatch: ${hash}`);
      hasErrors = true;
    }
    continue;
  }

  // For migrations after Release 4: MUST be strictly LF
  if (mig > RELEASE4_MIGRATION) {
    if (hasCRLF) {
      console.error(`FAIL: Future migration ${mig} contains CRLF line endings. Must be LF.`);
      hasErrors = true;
    } else {
      console.log(`PASS: Future migration ${mig} is strictly LF (SHA: ${hash.slice(0, 12)}...).`);
    }
  }
}

if (hasErrors) {
  console.error('\nFAIL: Migration byte verification failed.');
  process.exit(1);
}

console.log('\nPASS: All migration files verified for byte determinism.');
process.exit(0);
