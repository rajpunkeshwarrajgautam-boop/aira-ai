# Research workspace UX audit

## Scope and baseline

A source-level audit of the public research workspace and shared frame found overlapping visual styles, a light guest shell inconsistent with the graphite-and-brass direction in `DESIGN.md`, specialized starter prompts, and a navigation palette presented as content search although it only searches destinations. The research flow already has streaming, retry, citations and error states; those behaviors were preserved.

The initial redesign predates browser availability in this environment, so no pre-redesign screenshots were captured. Headless Chromium was subsequently used to capture the updated guest page at 1440×900 and 390×844. No horizontal overflow or uncaught page errors were seen at those widths. Ctrl+K opens the navigation palette and Escape closes it. On mobile the drawer opens and reports its expanded state; starter prompts populate and focus the composer. Submitting a guest query without configured services produces an accessible retry error. Guest visits to Agents and Memory redirect to sign-in.

## Direction and changes

Keep Geist and the application structure. Use a restrained graphite research starting surface with brass accents, clear language and functional prompts, not marketing-page layouts or decorative effects. This pass improves the start state, adds Agents and Memory to the guest shell, labels the navigation palette accurately, adds a visible composer label and mobile menu state, improves guest guidance and footer contrast, focus indicators, reduced-motion treatment and mobile tap sizes, guards IME submission, labels attachment removal, and makes malformed citation hostnames non-fatal. Playfair Display is now self-hosted with its OFL license, removing a build-time Google Fonts dependency. The authenticated shell and Agents/Memory screens were subsequently reviewed with isolated fixtures, as described below.

## Initial verification (superseded by the follow-up below)

- Web lint, TypeScript and production build passed; the test suite reported 881 passing, 22 skipped, zero failing. Prisma client generation used `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` because the schema-engine download host was unreachable. Generation succeeded, but this is **not** a substitute for a real schema engine for migrations or other engine-dependent operations.
- Taste Skill's quick consistency checker was run at desktop and mobile widths. It reported 24 failures and 24 warnings on its last run. Some are website-specific checks (section-per-screen, hero copy and layout) that do not fit a working application; remaining accessibility and responsive findings still require individual review. After that run, focus rings on the dark panel were adjusted; the checker was not rerun after that final adjustment.
- The browser check covers guest behavior, not real citations, saved threads or authenticated Agents and Memory. No database, OAuth or answer-provider configuration is present locally. Supabase has an active project, but its connection to this checkout and a safe test account were not established. Do not run writes against an unidentified live project. A configured, isolated test environment and sign-in are needed to finish the connected workflow audit and extend the authenticated UI safely.
- For a sandboxed iframe preview only, `AIRA_ALLOW_PREVIEW_EMBED=1` removes the frame header in development; production retains `X-Frame-Options: DENY`. Set exact preview origins via `AUTH_TRUSTED_ORIGINS` rather than weakening host validation.

## Follow-up verification (2026-11-07)

- The quick Taste Skill run reported 21 failures and 14 warnings before the final mobile sign-in target adjustment. Almost all failures were marketing-site assumptions (full-screen hero/sections, marketing copy/action counts, equal edges around a sidebar application, and illustrative imagery); the remaining focus warning pointed at the Next.js development overlay. The real low-contrast dark-panel focus rings, navigation menu state, and mobile navigation tap sizes were addressed; a final browser measurement confirmed a 44px sign-in target. The full checker was not rerun after that last adjustment. These results are not a blanket accessibility certification.
- The guest mobile drawer now hides its closed content from keyboard navigation, traps focus while open, and returns focus on Escape. Chromium verified these behaviors at 390px.
- Authenticated Memory and Agents were inspected at 1440px and 390px with a locally signed disposable test session and intercepted fixture API responses. Memory's failed-load state no longer claims the list is empty; retry and fixture create/unpin/delete were exercised. Agents now has explicit loading/empty state, retryable refresh errors, form labels, and distinguishes unavailable task history from an empty list. Graphite/brass accents were applied to the definition and memory interfaces. These are UI fixture checks, not evidence of real OAuth or provider execution.
- A disposable in-memory PGlite database was initialized with the historical baseline and the persistent-memory migration. Real generated Prisma client calls successfully created, listed, owner-scoped, unpinned and deleted a memory. This is a narrow PostgreSQL-compatible integration check, not a full PostgreSQL/migration-chain test.
- Final lint, type-check, production build and test suite passed (884 passed, 22 skipped). Prisma generation still used `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`; the actual schema engine remains inaccessible. No real provider, OAuth sign-in, live cited answer, persistent conversation, or end-to-end agent run was verified. The connected account exposes projects, but no suitable isolated test database or provider access was established; no live data was modified.

## Reproducible isolated smoke checks

The checks below use synthetic content and a disposable database. They do not certify a real OAuth login, external answer provider, PostgreSQL deployment, or full migration chain. They never require production credentials.

Install optional QA tools outside the checkout, generate the Prisma client using the normal engine in an unrestricted environment, and start a **loopback-only, disposable** development server with `AUTH_SECRET=local-development-only-not-for-production`. Do not use this secret in production or expose that test server publicly. Then run:

```sh
npm install --prefix /tmp/aira-qa @electric-sql/pglite @electric-sql/pglite-socket puppeteer-core @sparticuz/chromium
AIRA_QA_MODULES=/tmp/aira-qa node scripts/qa/memory-db-smoke.mjs
AIRA_QA_MODULES=/tmp/aira-qa AIRA_QA_URL=http://localhost:3000 node scripts/qa/browser-fixture-smoke.mjs
```

The browser check accepts `CHROME_PATH` for an existing Chromium installation. On minimal Linux systems Chromium may additionally require OS libraries; in this sandbox, the packaged AL2023 libraries were extracted into `/tmp/lib` and `LD_LIBRARY_PATH=/tmp/lib` was set. The database check binds only to `127.0.0.1:55432`, uses the historical baseline plus only the two migrations needed for memory and pinned conversations, and removes its in-memory data at exit. It verifies real Prisma calls for scoped memory and conversation/citation persistence. The browser check stubs API responses and exercises a fixture answer and citation, memory retry/create/unpin/delete, agent states, and the keyboard skip link at desktop and mobile widths.

Latest verification: lint, type-check, and production build passed; 884 tests passed and 22 were skipped. The sandbox still required `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` for client generation: this is not a real schema-engine or migration verification. The final quick Taste Skill run reported 21 failures and 11 warnings: the remaining focus warning refers to the Next.js development overlay, while its full-screen section, marketing-copy, and marketing-layout rules are not appropriate for the application workspace. The checker passed skip-link, mobile menu-toggle, field-label and text-contrast checks; its result is not an accessibility certification. External OAuth, live research/citations, and end-to-end agent execution remain unverified because the sandbox has no configured provider or isolated external database and cannot reach their hosts.
