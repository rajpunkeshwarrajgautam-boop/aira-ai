# AIRA AI production release record — 20 August 2026

Handoff record for the production-completion pass run on 20 August 2026 (IST).
It records what was changed, what was executed, what was proven, and what remains
blocked. Anything not evidenced here was not verified.

## Release identity

| Field | Value |
| --- | --- |
| Branch | `claude/aira-ai-production-completion-3l222j` |
| Base | `878893300463a68569d13887300eaf56a61a22d6` (`main`, "Integrate DeerFlow 2.0 as AIRA SuperAgent runtime") |
| Production URL | https://aira-ai-live.vercel.app |
| Vercel project | `aira-ai-live` (`prj_fXrnG5khmADI8znZfJZBylUsnvKU`) |
| Production deployment at start of pass | `dpl_6aH4WwMq24ftcW86xuZW63YLuAty`, READY, commit `8788933` |
| Merged as | PR #68, merge commit `82881013c05feff81792ed47ebce4d6a0364448a` |
| **Released production deployment** | **`dpl_4YRrLc9wcyHjPqk4RpvF35L1XpyZ`, READY, commit `8288101`** |

## What changed

No functioning system was rewritten, no runtime was newly integrated, and no feature
was enabled. Every change is either a defect fix, test coverage, verification tooling
or corrected documentation.

### Publication safety gate — two defects fixed

1. **Durable-state entity extraction over-captured.** A greedy quantifier let the
   `[.\n]` lookahead alternative win at the end of a sentence, swallowing the
   `and <verb>` clause boundary between two assets. "User runs a logistics company and
   builds an invoicing product" produced the single entity "logistics company and
   builds an invoicing product", which matches no real prose. The
   `state-contradiction` check was therefore silently inert: AIRA could instruct a
   user to register a company its own durable memory said they already run — one of
   the named historical failure classes. Fixed by making the quantifier lazy and
   adding extraction of trailing `and <verb>` clauses.

2. **The fail-closed sanitizer could emit output that still failed validation.**
   Removing a blocked line can delete the only sentence referencing an existing
   asset, creating a `state-omission` that was absent from the incoming violation
   list. Both sanitizers gated the recalled-state bridge on that stale list. In
   `enforceFinalPublicationBoundary` the residual violation causes a throw, so a good
   answer became a hard request failure. Both sanitizers now re-evaluate the omission
   condition against the sanitized text using the same predicate the validator
   applies, and the compatibility sanitizer accepts verifier context to do so.

### Autonomous agent runtime — three defects fixed

3. **Upstream error passthrough.** The DeerFlow client returned the Gateway's own
   `detail` string as the error message, and the agent routes return that message to
   the browser. A FastAPI 500 carrying a host path, configuration fragment or
   model-provider error text would have been rendered to the user. Errors now carry
   an AIRA-owned message plus a server-only `upstreamDetail` that is logged and never
   serialized — the pattern the AutoGPT adapter already followed.

4. **Runs could spin forever.** Both adapters create the `AgentRun` row and consume
   quota before submitting to the remote runtime, and both refresh paths returned
   early when `remoteExecutionId` was null. An invocation that died in that window
   left a run spinning in the workspace permanently; a run whose remote execution
   disappeared stalled the same way. Added a shared reconciliation bound
   (`lib/agents/run-reconciliation.ts`): an unsubmitted run closes after 10 minutes,
   an accepted run after 24 hours, and a 404 from the Gateway is treated as durable
   rather than transient. Quota is deliberately not refunded, because an unconfirmed
   submission may correspond to real remote work — the rule the submit paths already
   applied.

5. **Unbounded artifact metadata.** The persisted artifact list doubles as the
   download allowlist. It is now bounded to plain path strings so an unexpected
   Gateway payload cannot write an unbounded blob to the `AgentRun` row.

### Test coverage — new

The web application previously had **zero** automated tests. Added a suite on Node
22's built-in test runner with a dependency-free ESM resolver hook
(`test/resolver.mjs`) so tests load real source modules under native type stripping.
No test toolchain was added to the dependency surface and the lockfile is unchanged.
Wired into the turbo graph and the root `ci` script, which the GitHub CI workflow
already runs.

### DeerFlow verification tooling — new

`infra/deerflow-runner/scripts/verify-deployment.sh` implements the activation gate
as one command in three modes (`--host`, `--public`, `--self-test`). Every check is a
read; nothing is mutated; secrets are judged by shape and never printed. The public
mode adds checks the manual runbook list did not have: that `/docs`, `/redoc` and
`/openapi.json` are not served, that an unauthenticated caller cannot reach
`/api/threads`, and that ports 2026, 8001, 6379 and 5432 are not publicly reachable.

A `deerflow-runner` CI job syntax-checks both scripts, runs the self-test, and asserts
the gate still fails closed with no host present, so it cannot silently start
reporting success.

### Environment contract — corrected

`.env.example` omitted **26 referenced variables**, including every one AIRA cannot
start without: `DATABASE_URL`, the Auth.js secret, all four OAuth credential pairs
and their `AUTH_*` aliases, and `EXA_API_KEY`. A deployment configured from that file
alone would have failed at boot and then returned unciteable answers. Added a
REQUIRED section and a core-behaviour section, names and explanations only, every
secret blank. Four guard tests now prevent regression. Six runtime-read variables
were also added to turbo's `globalEnv`; they were absent from the build cache key, so
changing one could serve a stale cached build.

### Documentation — reconciled

`PROJECT_STATUS.md` predated the DeerFlow merge, described only the AutoGPT gates,
and recorded a stale production commit (`42fc63b7`, actually `8788933`). Rewritten
against the deployed application with explicit integrated/deployed/configured/
verified/production-active tables. The stray `PROJECT_STATUS.md.txt` was removed.
Rollback was previously undocumented and is now in the runbook.

## Tests executed

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | pass, lockfile unchanged |
| `pnpm run audit:prod` | pass under the documented `GHSA-ggr8-5vv4-36mx` exception |
| `pnpm run lint` | pass, `--max-warnings 0` |
| `pnpm run check-types` | pass |
| `pnpm run test` | **56 passing, 0 failing** |
| `pnpm run build` | pass, all 34 routes generated |
| `bash -n` on both deerflow-runner scripts | pass |
| `verify-deployment.sh --self-test` | 19 checks, all pass |
| `verify-deployment.sh --host` (no host present) | exits 1 as designed |

The suite covers: DeerFlow artifact-path traversal defense (7), DeerFlow config
fail-closed and HTTPS enforcement (7), DeerFlow client error sanitization, token
placement and submission ambiguity (11), publication safety regressions (17), agent
run reconciliation bounds (5), ingress request guard (5), environment contract (4).

Two of these tests were written before their fix existed and failed first; both
defects in the publication gate were found that way rather than by inspection.

## Deployment status

| Environment | State | Commit |
| --- | --- | --- |
| Preview (`dpl_7KA3yYv74S3m9SUDtje3YUf5D9ni`) | READY | `71ebb40` |
| Production before release (`dpl_6aH4WwMq24ftcW86xuZW63YLuAty`) | READY | `8788933` |
| Production after release (`dpl_4YRrLc9wcyHjPqk4RpvF35L1XpyZ`) | READY | `8288101` |

CI run `32339461076` was green across all four jobs (`quality`, `autogpt-runner`,
`deerflow-runner`, `foundation-services`) before the merge.

Preview smoke test: homepage 200; `/api/agents/runs` returns `401 UNAUTHENTICATED`
with `Cache-Control: no-store` and no CORS grant.

Production smoke test after release, against `https://aira-ai-live.vercel.app`:

- `/` returns 200 and the alias resolves to the new deployment.
- `/signin` returns 200 with **both** OAuth providers enabled and
  `canonicalOrigin: "https://aira-ai-live.vercel.app"`, confirming the
  callback-domain fix is live in production.
- `/api/agents/runs` returns `401 UNAUTHENTICATED`, `Cache-Control: no-store`,
  no CORS grant.
- Headers: HSTS `max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying
  camera/microphone/geolocation, and a `__Secure-`prefixed `HttpOnly` `SameSite=Lax`
  session cookie scoped to the canonical production origin.
- Vercel reported **zero runtime errors** before and after the release.

No P0 was observed after release, so no rollback was triggered.

## Database

Verified by reading the migration set, **not** by connecting to the production
database — no database credentials were available for this pass.

- Every migration that creates a table also enables row-level security, installs a
  `deny_direct_data_api_access` policy denying `anon` and `authenticated`, and revokes
  privileges from `anon`, `authenticated` and `service_role`.
- `20260815_lock_down_data_api` applies that treatment to all pre-existing tables and
  additionally sets `alter default privileges ... revoke all` for tables, sequences
  and functions, so a table created by a future migration is not Data-API-reachable
  by default. This backstop is why later migrations are safe.
- No migration in the set is destructive. All eight are additive.
- RLS was not weakened and no `service_role` credential appears anywhere in the
  repository.

**Not verified today:** live schema drift against production, and the Supabase
security advisor. Both require database credentials or Supabase project access.

## DeerFlow 2.0 status

| State | Status |
| --- | --- |
| integrated | **YES** |
| deployed | **NO** |
| configured | **NO** |
| verified | **NO** |
| production active | **NO** |

Upstream pin `a5acc25de6742b2166b3f41c97bd895822277b94` was retained. It was not
upgraded: none of the six upgrade preconditions in the runbook could be satisfied
without a host to test against.

## AutoGPT status

Integrated and unbroken; not deployed, configured, verified or active. The dual-host
adapter, health-based pre-submission failover, host-pinned polling and idempotency
are intact, and the reconciliation fix applies to its runs as well. Remote
cancellation remains unavailable for AutoGPT and the API reports that honestly
instead of pretending a stop succeeded.

## Remaining blockers

1. **No DeerFlow host.** This is the single external blocker to DeerFlow production
   activation. It requires a persistent Linux host with Docker, Redis, Postgres, a
   dedicated TLS hostname and a reviewed sandbox provider. Everything inside the
   repository is ready: provisioning script, verification gate, environment contract,
   firewall requirements, rollback procedure.
2. **No AutoGPT hosts.** Blocks fallback activation. Not on the critical path while
   DeerFlow is also inactive.
3. **No database credentials in this pass.** Blocks live schema-drift confirmation and
   a Supabase security-advisor run.

## Deferred

- **Cashfree.** Commercial activation remains deferred by the project owner. Not
  touched: it does not block core production correctness, and checkout is not
  presented as working while disabled.
- **Upstream DeerFlow pin upgrade.** Deferred until a host exists to test against.
- **CI/runtime Node version divergence.** CI runs Node 22; the Vercel project is set
  to Node 24. Both build cleanly, but they are not the same runtime. Worth aligning
  deliberately rather than as a side effect of this pass.
- **UI work.** No redesign was attempted. No functional or usability defect was found
  that warranted one during this pass.

## Rollback

**This branch.** Every change is additive or a localized fix; no migration, no schema
change, no configuration change, no dependency change. Reverting the merge commit
restores the previous behaviour exactly.

```bash
git revert -m 1 82881013c05feff81792ed47ebce4d6a0364448a
git push origin main
```

**Production deployment.** `dpl_6aH4WwMq24ftcW86xuZW63YLuAty` (commit `8788933`) is
marked `isRollbackCandidate: true`. Promote it from the Vercel dashboard, or redeploy
that deployment id, to return production to the pre-pass state within one deploy.

**Individual fixes.** Each is isolated to its own commit and can be reverted alone:

| Concern | Commit |
| --- | --- |
| Test suite + publication-gate fixes | `d1a8873` |
| Agent runtime hardening | `b66516e` |
| DeerFlow verification gate + rollback runbook | `5f4c647` |
| Environment contract | `71ebb40` |

**DeerFlow, if it is later activated and misbehaves.** Set
`DEERFLOW_AGENT_ENABLED=false` and redeploy that environment. This is a configuration
change, not a code change. In-flight runs are not migrated to another provider, and
runs that can no longer be polled are closed by the reconciliation added in this pass
rather than spinning. Full procedure, including host rollback and token rotation, is
in `infra/deerflow-runner/README.md`.
