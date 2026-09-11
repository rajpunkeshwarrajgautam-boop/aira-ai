# AIRA Sidebar Repair — Exact-SHA Certification

- Candidate code SHA before this evidence refresh: `926398b3c14383c96dfe329288e95e88cb8c314c`
- Base production SHA: `81955d915ff3c6cb1027b9ac8ccb462c433c069d`
- Branch: `integration/aira-ultimate-platform`
- PR: #127 (DRAFT / DO NOT MERGE)
- Production touched: NO
- Production DB touched: NO

## Repaired surfaces

The sidebar product-integrity campaign replaced or repaired the production paths for Work, Browser Agent, Projects, Swarms, Workflows, Agents, Artifacts, Global Search, Federated Knowledge, connector health, Governance, and enterprise agent sharing authorization.

## Verification evidence before evidence-document refresh

- Dependency audit: PASS — 0 known vulnerabilities
- Lint: PASS — `eslint --max-warnings 0`
- TypeScript: PASS — `next typegen && tsc --noEmit`
- Canonical unit/integration suite: PASS — 502 passed, 0 failed, 16 expected environment-specific skips (518 total)
- Production build: PASS — 27/27 static pages generated
- Dedicated REAL_DB workflow: PASS — 3/3; includes idempotency, cross-user isolation, independent A→B→C cold-start recovery, durable artifact/checksum recovery, RLS/policy assertions, and workflow secret rejection
- Required GitHub workflows: PASS 5/5 on candidate `926398b3c14383c96dfe329288e95e88cb8c314c`
  - CI run 34151939525
  - Terminal Worker CI run 34151939729
  - PostgreSQL Migration Chain run 34151939492
  - PostgreSQL Migration Failure Recovery run 34151939509
  - Agent Platform Idempotency REAL_DB run 34151939546
- Vercel Preview: READY — `dpl_5HiADz4cjKb723rbuxCLTKX2omyv`, exact candidate git SHA match
- Preview runtime error/fatal query: no matching logs in the certification window

## Security / truthfulness repair

Final diff review found and repaired an enterprise-sharing authorization bypass: generic UserAgent PUT no longer accepts `shares`; enterprise sharing remains fenced through the organization/workspace authorization endpoint. A regression test prevents the bypass from returning.

No unresolved P0/P1 finding is known from the sidebar repair diff review.

## Browser status

Interactive authenticated browser/Reticle certification is **UNVERIFIED in the current certification tool session**. The Vercel Preview is protected by SSO and no connected authenticated browser automation/Reticle tool is available here. This evidence must not be represented as a live browser PASS.

Accordingly the current verdict remains:

**SIDEBAR REPAIR CODE-CERTIFIABLE / BROWSER VERIFICATION BLOCKED**

Because updating this evidence file changes the branch SHA, its resulting commit must itself complete exact-head CI/REAL_DB/migration/Preview verification before PR metadata is synchronized.
