# Analytics & launch readiness checklist (Perplexity clone SaaS)

## 1) Analytics data model deployed
1. Prisma schema contains:
   - `AnalyticsEventType` enum
   - `AnalyticsEvent`
   - `AnalyticsVisitorState`
   - `AnalyticsSignupState`
2. DB schema is in sync (your usual workflow):
   - run Prisma client generation: `node prisma-generate.js` (or `npx prisma generate`)
   - run schema push: `node prisma-db-push.js` (or `npx prisma db push --accept-data-loss`)

## 2) Admin-safe analytics access
1. In production, set:
   - `ANALYTICS_ADMIN_EMAIL` (or `ANALYTICS_ADMIN_EMAILS` as a comma-separated list)
2. Verify these are admin-only:
   - `GET /api/admin/analytics/daily`
   - `GET /api/admin/analytics/funnel`
   - `GET /api/admin/analytics/errors`
   - `/admin/analytics` dashboard page
3. Confirm no write endpoints accept arbitrary user identifiers (public visitor tracking only uses an anonymous cookie).

## 3) Visitor + signup funnel integrity
1. Visitor landing:
   - visit `/` as a logged-out user
   - verify `VISITOR_LANDED` events appear
2. Signup:
   - sign in / create account
   - verify the first successful authenticated action records `SIGNUP_COMPLETED`
3. Searches:
   - run Standard search → verify `SEARCH_STANDARD`
   - run Deep Research search → verify `SEARCH_DEEP`

## 4) Share + upgrade funnel integrity
1. Share:
   - after a completed research, click “Share research”
   - verify `SHARE_CREATED` events appear
2. Upgrade checkout started:
   - start billing checkout → verify `UPGRADE_CHECKOUT_STARTED`
3. Upgrade completed:
   - verify Cashfree webhook sync sets the paid plan
   - verify `UPGRADE_COMPLETED` appears (only when remote status is ACTIVE/TRIALING)

## 5) Rate limit visibility
1. Force quota gates to fail (temporarily lower `monthlySearchLimit` for a test user).
2. Verify `QUOTA_EXCEEDED` events appear in:
   - `/admin/analytics` daily table
   - `GET /api/admin/analytics/daily`
3. Force Deep Research plan gate to fail.
4. Verify `PLAN_REQUIRED` events appear.

## 6) Error logging hooks
1. Trigger an upstream search failure (invalid EXA key / temporary upstream outage).
2. Verify:
   - `SEARCH_ERROR` events are recorded
   - `GET /api/admin/analytics/errors` shows recent failures

## 7) Privacy / no private data exposure
1. Confirm analytics metadata does not include user prompts, full queries, or assistant content.
2. Confirm share pages (`/share/[id]`) display only:
   - query title
   - assistant answer
   - citations
3. Confirm share pages do not leak user identity or account data.

