# Stable Google and GitHub callbacks

Status: regression-tested locally; live environment changes and authenticated verification pending.

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
GitHub OAuth apps have one callback setting: verify the selected app is the one
used by both deployments before changing it.

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
