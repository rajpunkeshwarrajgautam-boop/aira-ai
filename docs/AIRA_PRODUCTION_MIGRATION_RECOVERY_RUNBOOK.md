# AIRA AI — Production Database Migration & Failure Recovery Runbook

## 1. Core Principles & Strict Guardrails
1. **Never use `prisma migrate reset` in Production**: This drops the database and causes catastrophic data loss.
2. **Never use `prisma db push` in Production**: Bypasses the migration ledger and leads to untracked schema drift.
3. **Never delete rows from `_prisma_migrations` manually**: Prisma tracks migration integrity via this ledger. Modifying or deleting ledger rows manually causes checksum corruption.
4. **All production migrations must execute via CI**: Local Windows/macOS shells must not execute migrations against production to avoid line-ending or environment divergence.
5. **Always capture pre-migration and post-migration evidence**.

---

## 2. CI-Controlled Production Migration Procedure
Production migrations are triggered via GitHub Actions:
- Workflow: `.github/workflows/production-migration.yml`
- Inputs:
  - `target_git_sha`: The exact certified Git commit SHA.
  - `confirm_production`: Must explicitly type `DEPLOY`.
- Workflow steps:
  1. `scripts/db/migration-preflight.mjs`: Read-only validation of SHA, schema, migration byte determinism, and zero failed ledger rows.
  2. `pnpm exec prisma migrate deploy`: Executes unapplied migrations.
  3. `scripts/db/migration-postflight.mjs`: Asserts clean schema state, verifies ledger row completion (`finished_at IS NOT NULL`, `rolled_back_at IS NULL`), and checks physical objects.

---

## 3. Failure Scenarios & Recovery Procedures

### Scenario A: Migration Fails Before DDL Execution (e.g. Network / Auth / Lock Timeout)
- **Symptom**: `prisma migrate deploy` fails to connect or acquire the migration advisory lock.
- **Ledger Impact**: No row is inserted into `_prisma_migrations`, or a row with `finished_at IS NULL` is recorded.
- **Recovery Action**:
  1. Inspect network / lock state: Ensure no concurrent connections hold advisory locks.
  2. If no ledger row was created: Retry `prisma migrate deploy`.
  3. If an unresolved ledger row was recorded: Proceed to Scenario B.

### Scenario B: Migration Fails Mid-DDL and Transactions Roll Back
- **Symptom**: A SQL statement within the migration fails (e.g. syntax error or constraint violation). The transaction is aborted by PostgreSQL.
- **Ledger Impact**: Exactly one row in `_prisma_migrations` has `finished_at IS NULL` and `rolled_back_at IS NULL`.
- **Recovery Action**:
  1. Confirm that no partial physical changes survived:
     ```sql
     SELECT to_regclass('public."ProposedTable"'); -- should be null
     ```
  2. Mark the migration as rolled back in Prisma ledger:
     ```bash
     pnpm exec prisma migrate resolve --rolled-back "YYYYMMDD_failed_migration"
     ```
  3. Fix the SQL migration file in a new Git commit on the feature branch.
  4. Run migration preflight and re-deploy.

### Scenario C: Table or Index Already Exists (Drift Recovery)
- **Symptom**: Migration attempts `CREATE TABLE "Foo"` or `CREATE INDEX` but object already exists.
- **Root Cause**: Manual schema change or partially applied past migration.
- **Recovery Action**:
  1. Verify the existing table / index definition matches the migration DDL.
  2. If the physical schema is 100% identical to the migration intent:
     ```bash
     pnpm exec prisma migrate resolve --applied "YYYYMMDD_migration_name"
     ```
  3. Verify with `prisma migrate status`.

---

## 4. Verification & Idempotency Testing
The automated CI workflow `.github/workflows/migration-failure-recovery.yml` verifies:
- Transactional rollback on intentional migration failure probe.
- Detection of unresolved failed ledger rows.
- Successful resolution via `prisma migrate resolve --rolled-back`.
- Successful rerun after migration repair.
- Restart idempotency: Second execution of `migrate deploy` produces zero changes.
