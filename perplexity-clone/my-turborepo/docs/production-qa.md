# Production QA & Launch Checklist

This document serves as the definitive guide for pre-launch quality assurance, beta testing procedures, and deployment verification for the application. Use these checklists before deploying major releases to production.

## 1. Production Smoke Checklist

Run this quick checklist immediately after a deployment or during daily health checks:

- [ ] **Routing & Health**
  - [ ] Homepage returns `200 OK`
  - [ ] Invalid share route (e.g., `/share/test`) returns `404 Not Found`
- [ ] **Core Search Flow**
  - [ ] Guest search completes and streams fully
  - [ ] Signed-in search completes and streams fully
  - [ ] Source cards appear with visible titles, snippets, and domains
  - [ ] Citations scroll smoothly to their corresponding source cards
  - [ ] Clicking a source card successfully opens the external link
- [ ] **Sharing & Auth Limits**
  - [ ] Guest share teaser triggers after a search is completed
  - [ ] Clicking "Sign in to share" as a guest redirects cleanly to `/signin`
  - [ ] Signed-in users can successfully generate a public share link
  - [ ] Public share pages load correctly (titles, markdown, and source cards render)
- [ ] **UI & Layout**
  - [ ] Mobile layout scales properly with no horizontal overflow (test at `375px`)
- [ ] **Administration**
  - [ ] Admin dashboard (`/admin/analytics`) is visible and functional for authorized admin accounts

## 2. Beta Tester Checklist

Use this flow when onboarding beta testers or conducting user-acceptance testing (UAT):

### Testing Flows
- [ ] **Guest Flow**: Start logged out. Ask 2 questions. Verify the 5/day guest quota tracks correctly. Verify share gating.
- [ ] **Signed-In Flow**: Sign up / Sign in. Ask questions. Verify search history appears in the sidebar.
- [ ] **Source Card Flow**: Review the generated sources. Verify "Open source" affordance is clear and functional.
- [ ] **Share Flow**: Generate a public link and view it in an incognito window.
- [ ] **Mobile Flow**: Access the site from a mobile device and verify standard interactions (keyboard behavior, scroll, no horizontal scrolling).

### Bug Report Template
If you encounter an issue, please report it using the following format:
```text
**Device & Browser:** (e.g., iPhone 14 Pro, Safari)
**Account State:** (Guest / Signed-in)
**Action Taken:** (e.g., Asked a math question)
**Expected Behavior:** 
**Actual Behavior:** 
**Screenshot / Error Message:**
```

## 3. Known Limitations

Be aware of the following known architectural constraints during testing:

- **Deep Research**: Requires a signed-in Pro or Team account.
- **Quotas**: 
  - Guest users are strictly limited to **5 searches per day**.
  - Signed-in Free users are limited to **250 searches per month**.
- **Environments**: 
  - Vercel Preview Deployments do not have live database credentials or OAuth secrets enabled by default. Therefore, guest searches and sign-ins will fail on preview URLs with `500` errors unless env vars are explicitly mapped.
  - Automated Playwright/Browser testing for authenticated routes requires provisioning real (or mocked) OAuth credentials.

## 4. Deployment Checklist

Before merging to `main` and deploying to Vercel production:

- [ ] `pnpm --filter web build` completes successfully from the monorepo root.
- [ ] All GitHub PR checks (type-checking, linting, format) are green.
- [ ] Verify Supabase configuration: Migrations are only required if `schema.prisma` or backend RLS policies were modified.
- [ ] Post-deploy: Verify the live homepage returns `200` and the app shell loads without client-side console errors.

## 5. Analytics Checklist

Verify that the following product events are actively tracking in your analytics dashboard (or visible in the Network tab payload during QA):

- [ ] `search_submitted`
- [ ] `answer_stream_started`
- [ ] `answer_completed`
- [ ] `search_failed`
- [ ] `citation_clicked`
- [ ] `source_opened`
- [ ] `share_clicked`
- [ ] `sign_in_clicked`
- [ ] `guest_quota_reached`
- [ ] `deep_research_clicked`
