# AIRA Production Migration Safety Plan

Status: **PLAN ONLY — NOT AUTHORIZED FOR EXECUTION**

This document is the release-candidate production migration review for PR #127. Production was inspected read-only. No production migration, DDL, DML, secret change, deployment, or database mutation was performed while preparing this plan.

## Production State

Read-only inspection of the connected AiraAI Supabase production database established:

- Provider: Supabase PostgreSQL.
- Database: `postgres`; PostgreSQL 17.6; inspection role reports `postgres`.
- `_prisma_migrations`: **absent**.
- Required Supabase roles `postgres`, `anon`, `authenticated`, and `service_role`: present.
- `vector` extension: present.
- 34 public tables; all 34 currently have RLS enabled.
- 34 `deny_direct_data_api_access` policies are present.
- Direct table grants to `anon`, `authenticated`, and `service_role`: zero.
- Three `postgres` default-ACL entries exist in `public`, consistent with table/sequence/function lockdown, but exact ACL text must be rechecked immediately before any production migration.
- Existing pre-Ultimate objects include `ProductAnalyticsEvent`, `AgentRun`, `AgentRunEvent`, `UserMemory`, semantic/knowledge/graph tables, `AgentToolApproval`, and `McpServerPreference`.
- Ultimate Platform objects including `AgentProject`, `AgentPlatformRun`, `AgentTask`, `BrowserSession`, `UserAgent`, `AutomationRoutine`, `DurableArtifact`, and enterprise tables are absent.
- Current low-volume risk snapshot: User=1, UsageRecord=4, Conversation=139, AgentRun=0, AgentRunEvent=0, UserMemory=18; Knowledge/graph/approval/MCP preference tables inspected were empty.

**Primary conclusion:** production has many historical migration effects but no Prisma migration ledger. Running `prisma migrate deploy` blindly would replay non-idempotent historical DDL against already-existing objects and is unsafe.

## Migration Inventory

Tracked chain contains 25 migration directories. Fresh-database CI materializes the historical baseline `prisma/baseline/20260429_initial_schema.sql` temporarily as migration `20260429_initial_schema`, yielding 26 fresh-database migration steps. The baseline must never be blindly executed against current production.

## Migration-by-Migration Risk Matrix

| Migration | Purpose | Current Prod State | Operations | Data Rewrite / Backfill | Locks / Risk | RLS / Privileges | Dependencies | Replay / Idempotency | Prod Compatibility | Risk | Required Mitigation | Rollback | Verification | Proposed Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `20260429_initial_schema` baseline | Historical core schema | Core production schema already exists; ledger absent | Broad baseline CREATE/ALTER | Potentially broad if replayed | Very high if replayed | Historical | none | Not safe to replay | Existing prod must be adopted, not rebuilt | CRITICAL | Compare baseline objects to live catalog; establish ledger by reconciliation only | Restore snapshot / revert reconciliation metadata | catalog diff; app smoke tests | **ALREADY_PRESENT_RECONCILE** |
| `20260512_add_product_analytics_events` | Product analytics table/indexes | Table and indexes exist | CREATE TABLE/INDEX | none | Replay fails on existing table | none | core User/Conversation-independent | Non-idempotent | Effects already present | LOW if reconciled / HIGH if replayed | Verify columns/indexes then mark applied during controlled reconciliation | remove only reconciliation record if no DDL executed | catalog equality | **ALREADY_PRESENT_RECONCILE** |
| `20260811_add_agent_runs` | AgentRun enum/table/UsageRecord counter | enum, `UsageRecord.agentRuns`, AgentRun exist | CREATE TYPE, ALTER, CREATE TABLE/index/FK | none beyond defaulted column | ALTER/table locks; replay fails | enables RLS on AgentRun | User, UsageRecord | Non-idempotent | Effects present | MEDIUM if replayed | Verify enum values, columns, indexes, FK | metadata-only reconciliation rollback | catalog + FK/index checks | **ALREADY_PRESENT_RECONCILE** |
| `20260815_lock_down_data_api` | Global Data API lockdown | all 34 public tables RLS-enabled; deny policies present; no direct grants; default ACL entries present | ALTER all tables, policy replace, REVOKE, ALTER DEFAULT PRIVILEGES | none | broad catalog locks | **global security change** | roles + public schema | Mostly replayable but broad and unnecessary | Appears already applied | HIGH | Verify exact default ACLs and policy coverage; reconcile, do not rerun blindly | restore previous grants/policies only from audited snapshot | policy/grant/default-ACL diff | **ALREADY_PRESENT_RECONCILE** |
| `20260818_add_persistent_user_memory` | Conversation summaries + UserMemory | enum/columns/table present | CREATE TYPE, ALTER Conversation, CREATE table/index/FK/checks | default `summaryMessageCount=0` when originally applied | table lock on Conversation; replay fails | RLS/policy/revoke | User, Conversation, ConversationMessage | Non-idempotent | Effects present | MEDIUM | verify enum/columns/FKs/checks/indexes | reconciliation metadata rollback | catalog diff | **ALREADY_PRESENT_RECONCILE** |
| `20260818_add_user_memory_source_indexes` | FK support indexes | both indexes present | CREATE INDEX | none | index build | none | UserMemory | Non-idempotent | Present | LOW | verify definitions | metadata-only | index definitions | **ALREADY_PRESENT_RECONCILE** |
| `20260819_foundation_vector_knowledge` | vector memory + knowledge assets/chunks | extension/tables/HNSW indexes present | extension, CREATE TABLE/INDEX | none | HNSW build can be expensive | RLS/policy/revoke | UserMemory, User, vector | largely IF NOT EXISTS but policy create path not fully replay-safe | Effects present | MEDIUM | verify dimensions=1536, FKs, HNSW definitions, policies | reconciliation metadata rollback | catalog/index/policy checks | **ALREADY_PRESENT_RECONCILE** |
| `20260819_sovereign_graph_memory` | graph memory entities/relations/consolidations | all tables present | CREATE TABLE/INDEX | none | index/FK catalog locks | RLS/policies/revoke | UserMemory/User | tables IF NOT EXISTS; policy CREATE not guarded | Effects present | MEDIUM | verify checks/uniques/FKs/policies | metadata-only reconciliation | catalog constraints | **ALREADY_PRESENT_RECONCILE** |
| `20260819_sovereign_graph_memory_fk_indexes` | relation FK indexes | both indexes present | CREATE INDEX IF NOT EXISTS | none | index build | none | MemoryRelation | idempotent | Present | LOW | verify definitions | drop only if independently proven created wrongly | index definitions | **ALREADY_PRESENT_RECONCILE** |
| `20260823_semantic_embedding_table_precondition` | repair historical semantic migration order | both semantic tables present | extension + CREATE TABLE IF NOT EXISTS | none | catalog/index-free | none | UserMemory, KnowledgeChunk | idempotent object creation | Present | LOW | verify schema/checks/dimensions | metadata-only | table definitions | **ALREADY_PRESENT_RECONCILE** |
| `20260824_add_agent_run_events` | durable AgentRun events | table/index/FK present | CREATE TABLE/index/FK | none | replay fails | RLS/policy/revoke | AgentRun enum/table | Non-idempotent | Present | LOW if reconciled | verify FK, enum/status/indexes | metadata-only | catalog diff | **ALREADY_PRESENT_RECONCILE** |
| `20260824_semantic_embedding_exact_route_scans` | remove mixed-model ANN indexes; add exact route indexes | route indexes present; legacy tier HNSW absent | DROP INDEX IF EXISTS; CREATE INDEX IF NOT EXISTS | none | index DDL | none | semantic tables | safely repeatable | Desired invariant present | LOW | verify route index definitions | recreate prior indexes only if explicit rollback required | index catalog | **ALREADY_PRESENT_RECONCILE** |
| `20260824_tiered_semantic_embeddings` | tiered semantic embeddings + transient tier ANN indexes | tables present; historical HNSW no longer present by design | CREATE TABLE/index + RLS/policies | none | HNSW build may be expensive | RLS/policy/revoke | vector/User/knowledge | partially idempotent; policies may replay after drop | Superseded index state by later enforcement | MEDIUM | reconcile as applied only after confirming final enforcement invariant | metadata-only | tables + final route indexes | **ALREADY_PRESENT_RECONCILE** |
| `20260825_add_agent_tool_approvals` | durable tool approvals | enum/table/indexes exist | CREATE TYPE/table/index/FK | none | replay fails | RLS/policy/revoke | AgentRun | Non-idempotent | Present | LOW if reconciled | verify enum/FK/indexes | metadata-only | catalog diff | **ALREADY_PRESENT_RECONCILE** |
| `20260825_add_mcp_server_preferences` | per-user MCP preferences | table/index/FK exists | CREATE table/index/FK | none | replay fails | RLS/policy/revoke | User | Non-idempotent | Present | LOW if reconciled | verify unique/FK/index | metadata-only | catalog diff | **ALREADY_PRESENT_RECONCILE** |
| `20260825_semantic_embedding_exact_route_enforcement` | final exact-route invariant | route indexes present, tier HNSW absent | DROP old HNSW; CREATE route indexes | none | index DDL | none | semantic tables | idempotent | Desired final state present | LOW | verify final index definitions | metadata-only | index catalog | **ALREADY_PRESENT_RECONCILE** |
| `20260828_agent_platform_core` | AgentProject/platform/task/browser core | corresponding tables absent | unguarded CREATE TABLE/index/FK | none | schema locks; many FKs/indexes | RLS/policies/revoke | User + AgentRun | **non-idempotent** | Not yet applied | MEDIUM | precheck all target names absent; apply in controlled transaction/window | transactional rollback if failure; restore snapshot for post-commit issue | all tables/FKs/indexes/policies + API smoke | **APPLY_WITH_PRECHECK** |
| `20260828_agent_platform_run_idempotency` | run clientRequestId idempotency | AgentPlatformRun absent | ADD column, UPDATE backfill, SET NOT NULL, unique index | **yes**: sets existing rows `clientRequestId=id` | UPDATE + ALTER + unique index locks | none | AgentPlatformRun | non-idempotent ALTER | Applicable after core; new table initially empty if applied same release | MEDIUM | assert zero/compatible rows, no duplicate `(userId,id)`; apply immediately after core | restore snapshot or reverse column/index if no dependent release traffic | null/duplicate check + unique index | **APPLY_WITH_PRECHECK** |
| `20260829_autonomous_platform_hardening` | scheduler/accounting/tool calls/project memory/worktrees | target base table absent; new tables absent | ADD IF NOT EXISTS columns; CREATE IF NOT EXISTS tables/indexes | none | moderate catalog/index locks | RLS/policy/revoke | AgentPlatformRun/User/AgentProject/Task/Instance/Approval | mostly idempotent | Applicable after core/idempotency | MEDIUM | validate FK targets and no conflicting partial tables | transaction/restore snapshot | columns, FKs, indexes, policies | **APPLY_WITH_PRECHECK** |
| `20260829_browser_control_action_lease` | browser action lease | BrowserSession absent | ADD columns IF NOT EXISTS + index | none | low catalog lock | none | BrowserSession | idempotent | Applicable after core | LOW | confirm BrowserSession schema | reverse columns/index only before traffic, otherwise forward-fix | columns/index | **SAFE_TO_APPLY** |
| `20260829_managed_mission_quota_reservation` | durable quota reservation | table absent | CREATE IF NOT EXISTS table/index + RLS | none | low | RLS/policy/revoke | User | mostly idempotent | Applicable | LOW | check target absent/compatible | drop only before any reservations; otherwise restore/forward-fix | table/unique/index/policy | **SAFE_TO_APPLY** |
| `20260829_tool_call_input_binding` | bind tool approval/execution to canonical input hash | AgentToolCall absent until hardening | ADD inputHash; UPDATE null rows; SET NOT NULL; index | **yes** legacy backfill | UPDATE + NOT NULL lock | none | AgentToolCall | partially idempotent; SET NOT NULL safe only after backfill | Applicable; should be empty if same release | MEDIUM | count AgentToolCall rows/nulls, ensure backfill semantics acceptable | restore snapshot or forward migration; avoid destructive reverse after traffic | zero nulls + index + application replay tests | **APPLY_WITH_PRECHECK** |
| `20260907_durable_ultimate_platform_entities` | Agents/workflows/artifacts/enterprise durable entities | all listed target tables absent | mostly CREATE TABLE IF NOT EXISTS/indexes | none | multiple FK/index/catalog locks | RLS/policies/revoke | User | mostly idempotent but partial-schema mismatch could be silently retained by IF NOT EXISTS | Applicable | MEDIUM | assert target tables absent or structurally identical; apply only after preflight | restore snapshot / forward-fix | all tables/FKs/indexes/policies | **APPLY_WITH_PRECHECK** |
| `20260907_truthmode_iv_connector_credentials` | encrypted connector records | table absent | CREATE IF NOT EXISTS/index + RLS | none | low | RLS/policy/revoke | User | mostly idempotent | Applicable | LOW | confirm absence/compatible schema and encryption key config separately | restore/forward-fix | table/index/policy; no ciphertext exposure | **SAFE_TO_APPLY** |
| `20260907_truthmode_iv_integrity_repairs` | agent connector/share columns, DurableBlob, workflow approvals | prerequisite UserAgent tables absent | ALTER IF NOT EXISTS; CREATE IF NOT EXISTS | none | low-moderate catalog locks | RLS/policies/revoke | UserAgent/UserAgentVersion/User | mostly idempotent | Applicable only after durable entities | LOW-MEDIUM | enforce ordering; check no conflicting partial definitions | restore/forward-fix | columns/tables/indexes/policies | **APPLY_WITH_PRECHECK** |
| `20260907_truthmode_iv_workflow_secret_guard` | DB-level secret-key guard on workflow DAGs | AutomationRoutine tables absent | CREATE OR REPLACE function; ADD NOT VALID checks; VALIDATE | validation scans workflow rows | validation lock/scan | revoke function execute from Data API roles | AutomationRoutine + Version | **constraint ADD is non-idempotent** | Applicable last | MEDIUM | pre-scan existing workflow DAGs for forbidden keys; ensure zero violations; then add/validate | drop constraints/function only if explicitly required before new writes; otherwise forward-fix | validation succeeds; unsafe DAG insert rejected | **APPLY_WITH_PRECHECK** |

## Baseline / Reconciliation Strategy

Because production has no `_prisma_migrations` ledger while historical effects are already present, use **adopt-and-reconcile**, not replay-and-hope:

1. Take an approved production restore point immediately before any future migration window.
2. Re-run the read-only catalog preflight and compare every historical migration through `20260825_semantic_embedding_exact_route_enforcement` to production.
3. For each migration whose full intended effects are proven present, reconcile Prisma migration history using Prisma's supported resolved/applied mechanism or equivalent audited ledger insertion procedure. Do **not** execute its historical SQL.
4. Do not execute the raw `20260429_initial_schema` baseline against production.
5. Only after historical reconciliation is complete should the genuinely absent `20260828+` migrations be considered for execution, in canonical order.
6. Any partial mismatch changes classification to `MANUAL_RECONCILIATION_REQUIRED` and aborts automated deployment.

The production migration runbook must be tested first against a disposable branch/clone restored from production metadata/data shape. That validation is mandatory before authorization.

## Preflight Queries

At authorization time, capture and review read-only evidence for:

- `to_regclass('public._prisma_migrations')` and, if present, its complete migration status.
- live table/column/index/constraint definitions against every migration target.
- `pg_roles` for `postgres`, `anon`, `authenticated`, `service_role`.
- `pg_extension` for `vector` and schema placement.
- `pg_policies`, `pg_tables.rowsecurity`, role table/sequence/function grants, and `pg_default_acl`.
- row counts and null/duplicate scans before every backfill/unique/NOT NULL migration.
- duplicate check for `AgentPlatformRun(userId, clientRequestId)` before unique index creation.
- `AgentToolCall.inputHash IS NULL` count before SET NOT NULL.
- workflow DAG secret-key pre-scan before secret-guard constraint validation.
- active sessions/locks via `pg_stat_activity` and lock waiters before DDL.
- table/index sizes to choose an appropriate maintenance window.

## Backup / Restore-Point Requirement

No production schema mutation may begin until an operator confirms a restorable Supabase backup/PITR point or an equivalent tested snapshot immediately preceding the migration. Record the restore identifier/time outside the application logs. If the current Supabase plan cannot provide an adequate restore point, migration is **BLOCKED** until an acceptable backup method is explicitly approved.

## Proposed Production Execution Sequence

**Not authorized by this document.** Proposed sequence after explicit user authorization:

1. Freeze production schema changes; record exact app SHA and DB catalog hash/evidence.
2. Confirm restore point and test restore procedure.
3. Run all preflight/duplicate/null/secret-DAG checks.
4. Reconcile baseline and proven-present historical migrations through `20260825_semantic_embedding_exact_route_enforcement` without replaying their SQL.
5. Reconfirm Prisma history matches the reconciled chain exactly.
6. Apply `20260828_agent_platform_core`.
7. Apply `20260828_agent_platform_run_idempotency`.
8. Apply `20260829_autonomous_platform_hardening`.
9. Apply browser lease, quota reservation, and tool-input binding migrations in canonical order.
10. Apply `20260907_durable_ultimate_platform_entities`.
11. Apply connector credentials and integrity repairs.
12. Pre-scan workflow DAGs, then apply `20260907_truthmode_iv_workflow_secret_guard`.
13. Run catalog/RLS/privilege/Prisma status verification and application canaries before any production app promotion.
14. Only after DB verification passes may a separate production deployment authorization be considered.

## Verification Queries

Post-migration verification must prove:

- every canonical migration has one successful intended ledger state; no unfinished/rolled-back active migration.
- all required Ultimate Platform tables/columns/FKs/checks/indexes exist.
- all server-owned tables have RLS enabled and deny policies for Data API roles.
- `anon`, `authenticated`, and `service_role` retain no direct privileges on server-owned tables/sequences/functions.
- `postgres` default privileges remain locked down as intended.
- no duplicate/null violations exist for idempotency/input-hash fields.
- workflow secret constraints are valid and reject unsafe DAGs.
- authenticated application CRUD canary works with server-side Prisma.
- production research/auth baseline remains intact.

## Rollback Strategy

- **Before any commit:** transaction failure should roll back transactional DDL automatically; abort immediately and investigate.
- **After a committed migration but before production app promotion:** prefer database restore to the captured restore point for structural regressions rather than ad-hoc destructive reverse SQL.
- **After user traffic writes new-schema data:** do not drop new tables/columns blindly. Halt deployment, disable affected capability, preserve data, and use a reviewed forward repair or restore decision.
- Prisma reconciliation-only steps are metadata operations; if a reconciliation entry is proven incorrect before DDL execution, correct migration history under an audited recovery procedure rather than replaying schema SQL.

## Abort Criteria

Abort immediately if any of the following occurs:

- no verified restore point;
- production catalog differs from the preflight assumptions;
- historical migration is only partially present;
- duplicate/null precondition fails;
- workflow secret pre-scan finds violations;
- unexpected lock contention or long-running blocking session;
- migration targets Production through an unverified connection;
- role/extension/default-ACL assumptions differ;
- any migration fails or Prisma reports drift/failed history;
- any production auth/research canary regresses.

## Explicit User Authorization Boundary

This plan **does not authorize production changes**. Before any production reconciliation, migration, or deployment, the user must explicitly authorize the exact reviewed execution plan after the final Preview launch candidate is certified. Production remains untouched until that separate authorization.