# AIRA Phase 7 - Release 2 Evidence Ledger
# PR #127 (integration/aira-ultimate-platform) Production Cutover

Created: 2026-09-10T20:58Z

## STALE HANDOFF CORRECTION

The prior Phase 7 handoff referenced dpl_FFGmRardaakcU1jEo1uwJegEiSQG as current production.
STALE. Verified current production deployment is dpl_88VEEHuDCiyfwNZoKKVGEpU9tYwS.
Source: Downloads/AIRA_Production_Release_20260906_165443Z/deployment.json

## Release Topology - AUTHORITATIVE

### Release 1 (COMPLETE - LIVE)
PR: #123 (integration/aira-autonomous-omniroute -> main)
Merged: 2026-09-06T16:54:43Z
Production merge SHA: 81955d915ff3c6cb1027b9ac8ccb462c433c069d
Verified production deployment: dpl_88VEEHuDCiyfwNZoKKVGEpU9tYwS
Production URL: https://aira-ai-live.vercel.app
Post-deploy smoke: 7/7 PASS
Runtime errors: 0

### Release 2 (IN PROGRESS - THIS LEDGER)
PR: #127 (integration/aira-ultimate-platform -> main)
Status: OPEN / DRAFT / UNMERGED
Release SHA: fe630747a26d256d594c4d0eb00bad7088f2fcff
Working tree: CLEAN
Pending migrations (local isolated Postgres): 0 (all 26 applied)
Production rollback baseline: SHA 81955d91 / deployment dpl_88VEEHuDCiyfwNZoKKVGEpU9tYwS

## Migration Inventory - CANONICAL (26 total)

### Set A: APPLIED_NOT_RECORDED (15 migrations)
1  20260512_add_product_analytics_events              A6E3C50296F047DF7EAD5C49B29488567DFFAB28551F2914B203CC459E850997  1003
2  20260811_add_agent_runs                            1B2527A3E39E7083DEA2D75664D4EDF44CB709C36286F71271836CED967DD231  1669
3  20260815_lock_down_data_api                        DA9CC9CD359C76E492711B2D90AFC6D30A6F6B40D8C222DEE0E04AF49E6848AA  1921
4  20260818_add_persistent_user_memory                061029661260EED91580AFC1C9F34CD73138E6D85AB469CE5BE9449D37C8598C  2444
5  20260818_add_user_memory_source_indexes            4D1E607C4ED74E6666F0AD2ABD7C70547DE7516BF6C1DA8D01BC314DB0D7C45E  176
6  20260819_foundation_vector_knowledge               02ACFA439C82E096D4DC9F48C6F6FFD42F4814C000A22D7A5B2F53205D6EE293  3944
7  20260819_sovereign_graph_memory                    939759A598688DB28D6FB88B7F3CF8377EAD05A12C41B15184BE4AB23CC6CA38  3936
8  20260819_sovereign_graph_memory_fk_indexes         5C678CD76AFCA063D39DCFDC4F0584653C7D92D8735D4DA31088F776C3DF12C4  407
9  20260823_semantic_embedding_table_precondition     A8121F8656F7211C8AE06C140E8896F5AA362EB4DED7582FBCE8E6215FD33902  1861
10 20260824_add_agent_run_events                      2FC513CCDBCC8D95AA2C1B5B320F3BC196CF03477F4753AC8EDA2E10B17EDFC0  1131
11 20260824_semantic_embedding_exact_route_scans      2C139EF9758C6F36359CBA0543953A4BCCAF0C3E460961CF53FFBF0D4DCA0BB7  922
12 20260824_tiered_semantic_embeddings                3B28D5CF456DD86E3392371778755FD5F87EA805A7F3D741CB2DD901EE077054  3638
13 20260825_add_agent_tool_approvals                  1110F9BC7C6F9A6C24D589F722F79FEC6CD53BD317304CA9067DD690599A0895  1611
14 20260825_add_mcp_server_preferences                A1A5392945103643540A8551BB5F9DF331946AED173D80501CB94B7FD62D1968  1189
15 20260825_semantic_embedding_exact_route_enforcement 6DF18038744980D452675413DB0E53EAC8820F31890CFD302CF7BB4849246A3C  915

### Set B: NOT_APPLIED - PR #127 Delta (11 migrations)
16 20260828_agent_platform_core                       83186D06C4DB7DDDB1B38A2E08938E09D9B0DC1A1B8EF7B5DD1DA8D86D8EAC04  9637
17 20260828_agent_platform_run_idempotency            F17BA31EA6B6091FD403401D2768BB33D1494ABBEB34DF369AE173EA606514D1  376
18 20260829_autonomous_platform_hardening             2F80A05436FCEE3D1E201BD9D88A9BEFAB0832B6CEEEB56ABA25288F1B22083C  5236
19 20260829_browser_control_action_lease              DD42A631200A57686A38FA020296FA986F4FC1670273C4321ECDEE6231AA41F9  291
20 20260829_managed_mission_quota_reservation         9646B11862DA80D43BDD559B3E1569CD1C2E4CD2C4CCF3672D8767B927FFDB72  1173
21 20260829_tool_call_input_binding                   DFE5EA014C3BE5DDFDAA709ED2973ABCD8811053563DBB5BED71E0784482010F  598
22 20260907_durable_ultimate_platform_entities        2880CD4EABE54D19E56E5C73833A08CD35EE2273498323CB989FEE682E122B6A  9087
23 20260907_truthmode_iv_connector_credentials        203C545D42529F19C796384B6B01F5651AC15E88577B2BC4A902922D277F55EC  1224
24 20260907_truthmode_iv_integrity_repairs            3D4CF3B4E5B7E3EEF7A8D83574EB94368A3838BD340AF32A56922775DD9F39B0  2301
25 20260907_truthmode_iv_workflow_secret_guard        74D89BC917C090628CCEB9F8C4C4EBB24137E8A1EE2460D5376249DE384FF244  2846
26 20260909_anonymous_search_quota_reservation        25167B08E9D072B0E7AD4FA9EA8EEE18E9350CFD643D3D5A91163E7F65444C10  1142

## Gate 6 - Restorable Production Backup
STATUS: BLOCKED - RESTORABLE BACKUP NOT PROVEN

Evidence: No roles.sql / schema.sql / data.sql / .dump artifacts found anywhere.
Production DATABASE_URL held only in Vercel env vars (not in local .env files).

Storage Backup Risk: NEGLIGIBLE
- No storage.from() or createBucket() calls in source
- storageUri is nullable external URI on DurableArtifactVersion (not Supabase Storage)
- SUPABASE_SERVICE_ROLE_KEY used only for tool-gateway guard, not storage ops
- No Supabase Storage backup required

## Gate 7 - Disposable Rehearsal
STATUS: PASS (Docker Desktop v29.7.2 healthy, aira-gate29-postgres running, 26/26 migrations applied, REAL_DB test suite 100% PASS)
Docker Desktop verified active at C:\Program Files\Docker\Docker\Docker Desktop.exe
Container: aira-gate29-postgres (pgvector/pgvector:pg16) running on 127.0.0.1:5432
Migrations 23-26 deployed cleanly with zero errors. All 26 migrations applied and verified in PostgreSQL.

## Rollback Plan for Release 2
Application: promote dpl_88VEEHuDCiyfwNZoKKVGEpU9tYwS in Vercel dashboard
Database: backup-restore required (all 11 migrations are additive - no down.sql)
All PR#127 migrations: additive only (new tables, columns, indexes, policies)
Zero destructive operations verified

## Gate Summary
Gate 6  Restorable Production Backup  BLOCKED  Production DB URL unavailable locally (creds held in Vercel)
Gate 7A Docker Desktop Ready          PASS     Daemon running v29.7.2, healthy
Gate 7B Production Restore Proof      BLOCKED  Depends on Gate 6
Gate 7C Migration Rehearsal (11)      PASS     All 26 migrations applied to isolated Postgres instance
Gate 7D Schema Verification           PASS     Prisma schema synchronized and validated (43 tables)
Gate 7E REAL_DB/Security Tests        PASS     All 8 REAL_DB suites + Gate 29 Red Team pass (538 total pass, 0 fail)
Gate 7F Rollback Plan                 PARTIAL  App plan verified; DB plan needs Gate 6

---
## SECURITY INCIDENT — 2026-09-10T22:04Z

INCIDENT: Production database password pasted into chat.
AFFECTED CREDENTIAL: Supabase project oxzxuafnpyxoravoffrg database password
EXPOSURE VECTOR: User request text in IDE chat
STATUS: CREDENTIAL MUST BE ROTATED BEFORE RELEASE WORK RESUMES

REQUIRED USER ACTIONS:
1. Supabase dashboard -> Project oxzxuafnpyxoravoffrg -> Database -> Reset password
2. Vercel -> Environment Variables -> Update DATABASE_URL / DIRECT_URL with new password
3. Confirm rotation in chat (do NOT paste new password)

Gate 6 credential-dependent work: HALTED pending rotation confirmation.
All Production backup operations: HALTED pending rotation confirmation.

---
## Docker Environment — Verified 2026-09-10T22:04Z

Docker daemon: HEALTHY (v29.7.2)
Docker Server: v29.7.2
Containers found:
  aira-gate29-postgres  pgvector/pgvector:pg16   Exited  127.0.0.1:5432->5432/tcp
  aira-omniroute        ghcr.io/diegosouzapw/omniroute:3.8.50  Up (healthy)  127.0.0.1:20128->20128/tcp
  vx-rest               public.ecr.aws/supabase/postgrest:v13.0.7  Exited
  vx-auth               public.ecr.aws/supabase/gotrue:v2.195.0  Exited
  vx-pg                 public.ecr.aws/supabase/postgres:17.6.1.159  Exited

DO NOT TOUCH: aira-omniroute

REHEARSAL PLAN (post-rotation):
  Image: public.ecr.aws/supabase/postgres:17.6.1.159 (already pulled, exact Supabase PG version)
  Container name: aira-pr127-restore-proof-20260910
  Port: 127.0.0.1:5434->5432/tcp (avoids conflict with aira-gate29-postgres on 5432)
  Reason: Matches exact Production PostgreSQL version (17.6.1) vs pgvector/pg17 which is generic

Release SHA: fe630747a26d256d594c4d0eb00bad7088f2fcff - VERIFIED CLEAN
Branch: integration/aira-ultimate-platform
