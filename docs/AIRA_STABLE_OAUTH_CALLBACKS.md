# Stable Google and GitHub callbacks

Status (2026-10-03): stable proxy enabled; Production and authenticated Preview
Google login passed. The isolated Preview database is connected. Cross-chat
recall, correction, notes recall, and private-memory isolation passed. GitHub
callback routing passed, but account linking is still required for sign-in.

Aira uses next-auth 5.0.0-beta.32 and @auth/core 0.41.3. They already implement
`AUTH_REDIRECT_PROXY_URL`; no new auth service or browser package is needed.
Google rejected the repair Preview because it submitted its deployment-specific
`/api/auth/callback/google` URL. Adding another deployment URL only fixes one build.

## One-time configuration

Use the existing stable site as the Auth.js redirect proxy, provided its effective
secret and OAuth applications match the trusted Preview. A separate stable auth
deployment with separate test credentials is also supported.

| Setting | Stable deployment | Trusted Preview |
| --- | --- | --- |
| `AUTH_REDIRECT_PROXY_URL` | `https://aira-ai.in/api/auth` | `https://aira-ai.in/api/auth` |
| Effective auth secret | Existing stable secret | Same effective secret |
| Google/GitHub client credentials | Existing application credentials | Same application credentials |
| `AUTH_URL` / `NEXTAUTH_URL` | Keep existing stable origin | Existing Aira code suppresses fixed URLs on Preview |

Aira explicitly selects `NEXTAUTH_SECRET` before `AUTH_SECRET`. Compare the effective
secret, not just the value of `AUTH_SECRET`; do not rotate the stable secret to
enable this feature. Keep secret values out of logs and committed files.

Configure these provider callbacks once:

| Provider | Registered callback |
| --- | --- |
| Google | `https://aira-ai.in/api/auth/callback/google` |
| GitHub | `https://aira-ai.in/api/auth/callback/github` |

Inspect existing registrations first. If these callbacks are already registered,
no provider edit is needed. Preserve any other working Google registrations.
The current GitHub settings UI for Aira's existing OAuth app allows multiple
redirect URIs and already includes the stable callback. Verify the selected app
is the one used by both deployments before changing it.

Set the proxy variable in the stable environment **and** the trusted Preview
environment. Redeploy both from their current commits so the configuration takes
effect. A stable redeploy need not merge the repair PR. Keep PR #156 draft and
unmerged until the repair verification passes.

Scope shared credentials/secrets to trusted Preview branches. Any deployment with
the shared secret can create a proxy state and shares the session signing trust.
Do not distribute it to untrusted fork deployments. Keep database isolation as a
separate decision; the proxy does not require copying the production database URL.

## What the proxy preserves

Auth.js sends Google/GitHub the stable callback and encrypts the initiating
Preview callback into OAuth state. The stable deployment verifies that state and
returns the callback to the initiating Preview. The Preview completes OAuth using
its own state/PKCE cookies and issues its own host-scoped session cookie.

Do not force Preview `AUTH_URL` to the production origin, widen cookie domains,
disable state/PKCE, allow arbitrary redirect destinations, or introduce wildcard
host trust. Existing exact-host and same-origin return-path checks remain in place.

## Verification and rollback

1. Confirm outgoing Google and GitHub `redirect_uri` values equal the registered
   stable callbacks on two different Preview origins.
2. Complete real sign-in, checking that the browser returns to the initiating
   Preview and `/api/auth/session` identifies the selected user there.
3. Check stable-site sign-in still works.
4. Run the pending repair checks: new-chat recall, corrected fact replacing an old
   fact, notes recall, and private/no-memory isolation.

The regression test exercises the installed NextAuth handlers with fixture
credentials, real CSRF/state/PKCE generation, and encrypted proxy return routing.
It does not certify real provider token exchange or live secret configuration.

To roll back, remove only the newly added proxy variable from both environments
and redeploy their existing commits. Keep the original provider registrations.

Official reference: https://authjs.dev/getting-started/deployment#securing-a-preview-deployment

## Live rollout evidence (2026-10-03)

- `aira-ai-live`: Production and Preview branch `fix/native-memory-corrections`
  have `AUTH_REDIRECT_PROXY_URL=https://aira-ai.in/api/auth`.
- Effective secret and primary Google/GitHub credentials cover both environments.
  No secret rotation, cookie-domain widening, or automatic email linking.
- Production deployment `dpl_2fFDmSxAurt8Gi1Ps6dWNG81iurj` is READY on the
  unchanged released commit `de0742ce54287dd4950c2d73089400a6480c4db4`.
  Fresh Google sign-in returned to `https://aira-ai.in/` with a signed-in account.
- Isolated Neon branch `preview/pr-156-native-memory` (`br-empty-silence-ajuvwa3f`)
  in project `steep-feather-41427658` was forked from existing Preview `preview/pr-135`.
  Production's database was not used. The existing conversation-pinning migration
  was applied transactionally from checked-in SQL with its checksum; all 28 migration
  names are complete. Its pooled `DATABASE_URL` is saved as a branch-specific Secret.
- Authenticated Google Preview login passed on deployment
  `dpl_BtX3zouFkBiwCi9Pg1rxJDEzNYj1`, returning to the initiating Preview. The stable
  branch URL also signed in successfully and retained its session across a redeploy.
- GitHub OAuth returned to the initiating Preview and passed state, PKCE, token,
  and database-adapter checks. It stopped with `OAuthAccountNotLinked`: the existing
  Google account has no linked GitHub identity. Linking requires explicit approval;
  do not enable `allowDangerousEmailAccountLinking` to bypass it. Production GitHub
  account sign-in remains unverified.
- Live correction QA found that `Correction: remember ...` made a duplicate slot.
  `be2119c` normalizes the prefix and consolidates matching user-owned duplicates.
  The test fact now has one record, retaining the original row ID with value
  `MAPLE-9184`; a new chat recalled that value with zero sources.
- Live notes QA recovered the facts but copied unsolicited prior recommendations.
  `3dd9444` makes the final verifier's recommendation instructions conditional and
  keeps notes recall tied to prior user messages and the requested format.
- Application deployment `dpl_GCaD6FcGEgyVpJwjpN6dd9HK41AP` is READY on
  `3dd94444ae32f5d54a2ce256783cffc8ca9fdbf6`. Notes recall on this code returned exactly
  `Amber Desk, Tuesday` in the existing conversation after reload.
- Private/no-memory test `FIR-2048` was available in its own chat, but a new chat
  returned `UNKNOWN`, with zero sources. SQL checks found zero durable-memory and
  zero reusable-research records containing that private test value.
- Local Node 24 full suite: 888 tests, 866 passed, 0 failed, 22 skipped.
  Changed-file ESLint, TypeScript, and diff whitespace checks passed. The installed
  Auth.js proxy tests cover both providers, two Preview origins, stable-site routing,
  matching/mismatched secrets, and tampered state.
- On `3dd9444`, migration chain, migration failure recovery, and Windows workflows
  passed. CI quality stopped before lint/types/tests/build at `pnpm audit --prod`
  for high-severity `braces` advisory `GHSA-vfj7-8cjw-p6xm`; the advisory lists no
  patched version. The audit gate remains enabled. Local results do not certify CI.
- PR #156 remains draft and unmerged; PR #153 remains untouched. No repair code or
  database migration was promoted to Production. These checks certify the named
  Preview scenarios, not release readiness or all users/providers.
