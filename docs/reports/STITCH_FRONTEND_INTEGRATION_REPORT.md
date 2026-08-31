# AIRA Stitch Frontend Integration Report

Date: 2026-08-31  
Branch: `stitch/aira-intelligence-os`  
Pull request: #124  
Release code validation baseline: `a75f9184d383bba8c476f1c51122a6d297829311`

## 1. Executive summary

The Google Stitch exports have been converted from isolated design screens into a canonical AIRA Intelligence OS frontend architecture without replacing AIRA's working backend systems. The integration establishes one global application shell, one navigation hierarchy, a semantic Quiet Power design layer, a complete Stitch traceability inventory, and production-safe representations of backend-incomplete Automation concepts.

Core working AIRA capabilities — Research, conversations, citations, Agents/Runs, Knowledge, Memory, Model Lab, Local Runtime, integrations, analytics authorization and billing — remain connected to their existing real APIs and policies. Stitch concepts that require backend contracts not yet exposed by the web application are represented as truthful capability gates rather than mock execution or decorative controls.

Release code validation at `a75f918...` passed the complete repository CI workflow and produced a READY Vercel preview. This report is documentation-only; repository policy still requires CI on the final documentation head before merge.

## 2. Stitch inventory statistics

| Artifact | Count |
|---|---:|
| Code-bearing Stitch screens | 31 |
| Rendered `screen.png` assets | 32 |
| Design specifications (`DESIGN.md`) | 5 |
| Source ZIP batches | 3 |
| Unidentified exported screens | 0 |

The full traceability matrix is maintained in `docs/stitch/SCREEN_INVENTORY.md`.

## 3. Canonicalization decisions

### COMPLETE

- Research chat, deep-research and mobile variants → one `/` capability.
- Agent builder → `/agents`.
- Agent task, active execution, signature interaction, HITL and handoff → run-detail states under `/runs` rather than separate products.
- Workflow editor/templates → workflow states under `/runs`.
- Two swarm designs → one `/swarms` surface.
- Knowledge library + graph concept → `/knowledge`, with graph as a capability-dependent sub-view.
- Telemetry desktop/mobile → `/admin/analytics` states.
- Enterprise settings/mobile controls → `/settings#integrations` + `/governance`.
- Onboarding light/dark → one onboarding family, lower priority than the authenticated OS.
- Artifact workspace → run/project contextual surface, not a separate global product.

Full decisions: `docs/stitch/CANONICALIZATION.md`.

## 4. Final information architecture

### Operate
- `/control-center` — Control Center
- `/` — Research
- `/runs` — Workflows
- `/agents` — Agents

### Intelligence
- `/compare` — Model Lab
- `/local-ai` — Local Runtime
- `/knowledge` — Knowledge
- `/memory` — Memory

### Automation
- `/browser-agent` — Browser Agent
- `/swarms` — Swarms
- `/projects` — Projects

### System
- `/workspace-search` — Global Search
- `/settings#integrations` — Integrations
- `/governance` — Governance
- `/admin/analytics` — Analytics when server-authorized
- `/pricing` — Plans

The full access/data/deep-link contract is in `docs/architecture/FRONTEND_IA.md`.

## 5. Final route table

| Route | Status | Data/capability basis |
|---|---|---|
| `/` | COMPLETE | Existing Research/search/conversation/citation stack |
| `/control-center` | COMPLETE | Integration status, local-runtime status, agent runs |
| `/agents` | COMPLETE | Existing autonomous-agent platform |
| `/runs` | COMPLETE | Existing persisted autonomous runs/artifacts/cancel flow |
| `/compare` | COMPLETE | Existing server-side entitlement-aware compare API |
| `/local-ai` | COMPLETE | Existing llama.cpp/local runtime integration |
| `/knowledge` | COMPLETE | Existing knowledge ingestion/library APIs |
| `/memory` | COMPLETE | Existing user-owned persistent memory |
| `/workspace-search` | COMPLETE | Direct authenticated conversation/message/memory stores |
| `/settings#integrations` | COMPLETE | Existing integration status/destinations |
| `/admin/analytics` | COMPLETE | Existing server-authorized analytics capability |
| `/pricing` / `/upgrade` | COMPLETE | Existing billing/entitlement flow |
| `/browser-agent` | CONDITIONAL | Real local-runtime readiness; live browser-session contract not exposed |
| `/swarms` | CONDITIONAL | Real persisted run activity; durable swarm topology/mutation contract not exposed |
| `/projects` | CONDITIONAL | Knowledge/runs/artifacts exist; durable Project ownership entity not exposed |
| `/governance` | CONDITIONAL | Real admin capability; policy mutation/persistence contract incomplete |

## 6. Design system specification

### Quiet Power — IMPLEMENTED FOR SHARED SHELL/NEW SURFACES

- Typeface: Geist / Geist Mono through the existing app font stack.
- Spacing: 8px base rhythm.
- Accent: Deep Indigo `#253CC0`.
- Dark: Deep Studio neutral surfaces.
- Light: warm-paper semantic token mapping available under `[data-aira-theme="light"]`.
- Thin low-contrast borders.
- Restrained elevation.
- High information density.
- Explicit focus-visible indigo ring.
- Reduced-motion support for shared shell/new components.

Semantic variables introduced/consolidated include:

- `--aira-canvas`
- `--aira-surface`
- `--aira-surface-raised`
- `--aira-surface-muted`
- `--aira-text-primary`
- `--aira-text-secondary`
- `--aira-text-muted`
- `--aira-border`
- `--aira-border-strong`
- `--aira-accent`
- `--aira-accent-hover`
- `--aira-success`
- `--aira-warning`
- `--aira-danger`
- `--aira-info`

### DEFERRED

Automatic full light-theme activation is deferred because several legacy feature workspaces still contain dark-only hardcoded values. Enabling it now would create mixed-theme output. The semantic token mapping is present for staged migration.

## 7. Components introduced / consolidated

### Introduced
- `CapabilityGate` — common truthful state surface for available/not-configured/offline/unsupported/permission-required capabilities.

### Consolidated
- `AiraV2Frame` — authoritative global application shell.
- Global command palette — shares the same canonical destinations as navigation.
- Mobile drawer — responsive representation of the same global IA.
- Research conversation sidebar — context-only history rather than a second app navigation system.

## 8. Legacy components / behavior removed or superseded

### COMPLETE

- Duplicate global app rail inside Research conversation history.
- Hardcoded shell statement `AIRA online` that was not backed by health telemetry.
- Architectural tests requiring the obsolete duplicated Research rail.
- Static integrity assumptions that did not match the actual authenticated global-search store architecture.

### DEFERRED CLEANUP

Historical CSS generations remain in the repository while feature workspaces are migrated safely. `aira-intelligence-os.css` is the semantic convergence layer. Legacy destructive `.aira-v2-stage` behavior remains intentionally quarantined from the real workspace stage until removal can be proven by visual/browser regression testing.

## 9. Screens completed

Production behavior is implemented or preserved for:

- Control Center
- Research desktop/mobile shell
- Agents
- Runs/active execution foundations
- Knowledge
- Memory
- Model Lab
- Local Runtime
- Global Search
- Integrations/Settings
- Admin Analytics
- Billing/Plans
- Browser Agent readiness
- Swarm activity/readiness
- Project Hub capability state
- Governance capability state

## 10. Screens merged

Merged into canonical routes rather than duplicated:

- Chat + deep Research + mobile Research
- Agent mode + task + active execution + signature interaction
- HITL + handoff as execution states
- Workflow editor + templates
- Swarm Project Phoenix variants
- Knowledge graph as a Knowledge sub-view concept
- Enterprise controls + Governance
- Advanced telemetry + mobile telemetry as Analytics states
- Light/dark onboarding variants

## 11. Screens archived / design-only

Design-only sources are not exposed as routes:

- standalone logo export
- mobile component design-system screen
- five `DESIGN.md` specifications
- superseded duplicate/alternate screen implementations

Original Stitch source exports are retained as provenance and are not destroyed.

## 12. API integrations

### Existing real APIs preserved/used

- `/api/search`
- `/api/conversations`
- `/api/global-search`
- `/api/agents/runs`
- `/api/agents/runs/[runId]`
- run cancellation/artifact APIs
- `/api/knowledge`
- `/api/knowledge/library`
- `/api/memory`
- `/api/compare`
- `/api/local-ai/status`
- `/api/local-ai/chat`
- `/api/local-ai/browser-turn`
- `/api/integrations/status`
- `/api/admin/access`
- admin analytics APIs
- billing status/checkout/verification APIs

### New surface bindings

- Browser Agent → real `/api/local-ai/status` readiness.
- Swarms → real `/api/agents/runs?limit=12` persisted activity.
- Governance → real `/api/admin/access` capability check.
- Project Hub → intentionally no fake mutation API; routes users to existing Knowledge/Agents/Runs foundations.

## 13. Permission and capability rules

- Conversation, message, memory, knowledge and run ownership remains user-scoped.
- Compare remains server-entitlement controlled.
- Analytics remains admin-only through server authorization.
- Governance fails closed when admin capability is absent.
- Unsupported browser/swarm/project/governance execution is not represented as available.
- No Stitch screen weakened authentication, authorization, billing policy or secret handling.

## 14. Responsive coverage

### IMPLEMENTED / SOURCE-VALIDATED

- Global navigation converts to mobile drawer below the shell breakpoint.
- Drawer closes on navigation and Escape.
- Shared shell top bar compresses on small screens.
- New capability facts collapse from three columns to one.
- New run/activity lists collapse for narrow screens.
- Command palette adapts to mobile width.
- Reduced-motion support is explicit.

### CONDITIONAL

The repository does not currently contain Playwright or another full browser-device test framework. Responsive CSS is implemented and production builds succeed, but pixel-level validation at every requested 1440/1280/1024/768/430/390/360 viewport is not claimed as automated E2E evidence.

## 15. Accessibility results

### IMPLEMENTED / STATIC-VALIDATED

- semantic links/buttons on new surfaces;
- no literal empty/hash-only core links via integrity test;
- no decorative `type=button` controls without actions via integrity test;
- focus-visible ring on shared shell/new surfaces;
- Escape behavior for global palette/mobile navigation;
- capability states use icon + text, not color alone;
- headings/labels/ARIA descriptions on new operational surfaces;
- reduced-motion handling.

### CONDITIONAL

No axe/Playwright runtime accessibility suite is installed in the web package. Therefore WCAG AA is not claimed as fully browser-audited by automation.

## 16. Test results

Release code baseline `a75f918...`:

| Gate | Result |
|---|---|
| Production dependency audit | PASS according to repository policy (one high advisory is explicitly ignored by existing policy) |
| ESLint | PASS |
| TypeScript / Next route typegen | PASS |
| Node unit/integration/integrity suite | PASS |
| Production Next.js build | PASS |
| AutoGPT runner contracts/image build | PASS |
| DeerFlow runner/provisioning gates | PASS |
| Foundation services smoke/isolation | PASS |
| AIRA runtime/bootstrap/edge validation | PASS |

The frontend suite contains source-level architecture/integrity coverage for dead links, no-op controls, global search ownership, command destinations, sharing, integration anchors, billing selection, admin analytics, Research shell, local routing/memory policy and Automation capability truthfulness.

## 17. CI results

GitHub Actions CI run **#848** on release code baseline `a75f918...`: **SUCCESS**.

All five jobs succeeded:
- `quality`
- `autogpt-runner`
- `deerflow-runner`
- `foundation-services`
- `aira-runtime`

The final documentation-only head must also pass before merge.

## 18. Vercel deployment result

Matching preview deployment for `a75f918...`: **READY**.

The production build generated all canonical routes, including:
- `/browser-agent`
- `/swarms`
- `/projects`
- `/governance`
- all existing Research/Agents/Runs/Knowledge/Memory/Compare/Local Runtime/Settings routes.

A previous Turborepo warning for five real free-embedding environment variables was fixed by declaring these names in `turbo.json`:
- `AIRA_FREE_EMBEDDING_PROVIDER`
- `AIRA_FREE_EMBEDDING_API_KEY`
- `AIRA_FREE_EMBEDDING_BASE_URL`
- `AIRA_FREE_EMBEDDING_MODEL`
- `AIRA_FREE_EMBEDDING_DIMENSIONS`

The later Vercel build no longer emitted that warning.

## 19. Known technical debt

### P2

- Legacy workspace CSS still contains hardcoded colors and multiple historical presentation layers.
- Warm-paper light mode cannot be safely enabled globally until those workspaces migrate to semantic tokens.
- A full visual-regression/browser-responsive suite is not installed.

### P3

- Continue replacing historical violet/gold accents with the final Quiet Power palette domain-by-domain.
- Establish screenshot baselines after remaining legacy token migration.
- Add an explicit user theme selector after all core pages support the semantic light/dark contract.

## 20. Backend-dependent features

### Browser Agent — CONDITIONAL

Available now:
- real local-runtime readiness;
- real configuration/offline states;
- valid recovery links.

Blocked until backend contract:
- durable server-authorized browser session ID;
- live action stream;
- web takeover/approval/resume semantics.

### Swarms — CONDITIONAL

Available now:
- real autonomous execution readiness;
- real recent/active persisted run activity.

Blocked until backend contract:
- durable swarm membership;
- topology persistence;
- multi-agent topology mutations.

### Projects — CONDITIONAL

Available now:
- project-ready Knowledge, Agents, Runs and artifacts.

Blocked until backend contract:
- durable Project entity;
- resource ownership links;
- project CRUD/authorization/migrations.

### Governance — CONDITIONAL

Available now:
- server-authoritative admin capability check;
- fail-closed state.

Blocked until backend contract:
- persistent policy rules;
- retention/sovereignty mutation;
- associated authorization/audit semantics.

## 21. Recommendations

1. Merge this frontend architecture only after final-head CI remains green.
2. Treat Browser Session, Project entity, Swarm topology and Governance policy persistence as four backend epics rather than faking them in UI.
3. Run the next UI sprint as domain token migration: Research → Agents/Runs → Knowledge/Memory → Model Lab/Local Runtime → Settings/Admin.
4. Add Playwright + axe once authenticated test fixtures are available; cover the critical journeys defined in `FRONTEND_IA.md`.
5. Enable the warm-paper light theme only after core legacy pages consume semantic tokens.
6. Keep the integrity tests that reject dead links/no-op buttons and add visual-regression checks when browser automation is introduced.

## Feature classification

| Capability | Status |
|---|---|
| Stitch inventory/traceability | COMPLETE |
| Duplicate canonicalization | COMPLETE |
| Information architecture | COMPLETE |
| Single application shell | COMPLETE |
| Global navigation / command palette / mobile drawer | COMPLETE |
| Quiet Power semantic shared-shell design system | COMPLETE |
| Research integration | COMPLETE |
| Agents foundation | COMPLETE |
| Workflows/Runs foundation | COMPLETE |
| Knowledge | COMPLETE |
| Memory | COMPLETE |
| Model Lab | COMPLETE |
| Local Runtime | COMPLETE |
| Control Center | COMPLETE |
| Integrations | COMPLETE |
| Analytics authorization | COMPLETE |
| Browser Agent full execution | CONDITIONAL |
| Swarm topology/control | CONDITIONAL |
| Durable Projects | CONDITIONAL |
| Governance policy mutation | CONDITIONAL |
| Full warm-paper theme rollout | DEFERRED |
| Full Playwright multi-viewport E2E | DEFERRED |
| Automated axe browser audit | DEFERRED |

## Release classification

**CONDITIONAL** for the entire original Stitch vision because four advanced surfaces correctly remain backend-dependent and browser E2E/accessibility automation is not installed.

**READY for merge as the AIRA Intelligence OS frontend architecture/integration baseline** once the documentation-only final head passes the same CI gate.