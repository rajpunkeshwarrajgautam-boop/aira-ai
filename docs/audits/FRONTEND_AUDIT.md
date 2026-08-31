# AIRA Frontend Integration Audit

Branch: `stitch/aira-intelligence-os`

## Executive finding

AIRA's backend/product capabilities are materially ahead of the Stitch mockups. The primary frontend risk is not missing AI infrastructure; it is presentation fragmentation caused by multiple historical shells/CSS layers and design generations. The integration strategy therefore preserves existing backend/auth/entitlement behavior and converges the presentation layer incrementally.

## P0 — critical/security/data integrity

Current sprint finding: **none introduced by the Stitch integration**.

Controls explicitly preserved:
- authenticated user ownership for conversations/memory/knowledge/runs;
- server-side model-comparison entitlement checks;
- capability-aware admin analytics;
- fail-closed local/runtime configuration;
- no client-exposed secret changes;
- no weakening/removal of runtime/security tests.

## P1 — critical UX/functionality

### P1-01 Duplicate global navigation inside Research — FIXED

Previous state: Research conversation history carried its own global app rail while other workspaces used the shared AIRA frame.

Resolution:
- Research is mounted inside `AiraV2Frame`;
- the conversation sidebar is contextual history only;
- global navigation exists once.

### P1-02 Inconsistent product IA — FIXED/ONGOING MIGRATION

Previous state: capabilities existed across Research, Agents, Runs, Compare, Knowledge, Memory and Settings without one canonical hierarchy.

Resolution:
- freeze Operate / Intelligence / Automation / System hierarchy;
- add capability-aware Browser Agent, Swarms, Projects and Governance routes;
- command palette mirrors the same route model;
- admin Analytics remains permission-aware.

### P1-03 Fake/decorative system-status language — FIXED

Previous shell displayed a hardcoded `AIRA online` indicator unrelated to live telemetry.

Resolution:
- shell now uses neutral `AIRA workspace` language;
- actual runtime health lives in Control Center and capability-specific pages that call real APIs.

### P1-04 Stitch-only Browser/Swarm/Project/Governance interactions — FIXED AS CAPABILITY GATES

Risk: copying Stitch screens would create fake browser sessions, swarm topology, project persistence and enterprise policy switches.

Resolution:
- `/browser-agent` reads real local-runtime readiness and does not fabricate a viewport/action stream;
- `/swarms` reads real persisted agent runs and does not fabricate topology;
- `/projects` documents the missing durable Project ownership contract and routes to existing Knowledge/Agents/Runs;
- `/governance` verifies real server-side admin capability and does not expose unsupported policy mutation.

## P2 — consistency/maintainability

### P2-01 Historical CSS layers remain

Observed layers include `aira-v2.css`, Research/chat-specific styling, Impeccable iterations and other legacy presentation files.

Mitigation this sprint:
- `aira-intelligence-os.css` is the semantic convergence layer;
- shared shell and new routes use Quiet Power tokens;
- destructive legacy `.aira-v2-stage` selectors remain quarantined from `.aira-v2-workspace-stage`.

Follow-up:
- migrate domain-by-domain and delete superseded selectors only after screenshot/E2E parity is established.

### P2-02 Hardcoded colors remain inside legacy domain pages

Examples include Control Center and pre-existing operational cards using Tailwind arbitrary values.

Mitigation:
- shell/new surfaces now use semantic `--aira-*` tokens;
- token contract includes Deep Studio and warm-paper mappings;
- migrate existing domain pages incrementally to avoid destabilizing working flows during the 48-hour sprint.

### P2-03 Light theme cannot be safely auto-enabled yet

Reason: legacy feature workspaces contain dark-only hardcoded surfaces. Automatically following system light mode would produce mixed-theme output.

Resolution:
- warm-paper light semantic token mapping exists on `[data-aira-theme="light"]`;
- do not auto-switch until each major workspace is tokenized.

## P3 — polish

- Continue harmonizing card radius/density in legacy pages.
- Replace remaining gold/violet historical accents with Deep Indigo as legacy domains migrate.
- Add visual regression baselines after final production rendering stabilizes.
- Consider an explicit user theme control once all core workspaces consume semantic tokens.

## Code/runtime observations

### Positive architecture already present

- Next.js route structure with real API-backed Research, Agents/Runs, Knowledge, Memory, Compare, Local AI and Settings.
- Direct user-scoped global search stores instead of unauthenticated cross-route scraping.
- CI includes audit, lint, TypeScript, tests and production build.
- Dedicated runtime jobs validate AutoGPT, DeerFlow, foundation services and AIRA edge/runtime scripts.
- Existing no-dead-link/no-no-op integrity tests are useful release gates.

### Client/server boundaries

The sprint intentionally keeps new status surfaces client-side only where they need live authenticated fetches. Static capability explanations remain server-renderable. No broad conversion of working server/client boundaries is attempted without measurable benefit.

## Performance risks to monitor

- historical CSS payload from overlapping design generations;
- duplicated visual primitives across older pages;
- client-side status requests on multiple operational pages;
- large chat/research bundle due mature feature surface.

No speculative rewrite is authorized solely to chase bundle size. Use measurement before removing established functionality.

## Accessibility requirements applied

- shared shell exposes keyboard command palette and Escape handling;
- mobile navigation has explicit open/close controls and backdrop action;
- focus-visible uses a high-contrast indigo ring;
- new capability states use text + icon, not color alone;
- reduced-motion disables shell/new-component transitions;
- capability routes use semantic sections/headings/labels.

## Release gates

The branch is not `READY` until:
1. `pnpm run ci` passes on the final head;
2. all runtime jobs pass;
3. Vercel preview is `READY`;
4. new canonical routes render successfully;
5. no P0/P1 defect remains.

Any lower-priority Stitch feature without a complete backend contract remains truthfully capability-gated rather than mocked.