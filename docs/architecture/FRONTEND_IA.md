# AIRA Intelligence OS — Frontend Information Architecture

Status: architecture freeze for the Stitch integration sprint.

## Principles

- One authenticated application shell owns global navigation.
- Feature sidebars are contextual only.
- Navigation exposes real capabilities or truthful capability gates.
- State variants do not become top-level routes.
- Authentication, entitlement and admin authorization remain server-authoritative.
- Deep links must restore the intended resource/state without requiring the user to re-navigate manually.

## Top-level hierarchy

### Operate

| Route | Label | Job | Access | Primary data |
|---|---|---|---|---|
| `/control-center` | Control Center | Inspect AIRA health, integrations, runtime and recent activity | Authenticated workspace | `/api/integrations/status`, `/api/local-ai/status`, `/api/agents/runs` |
| `/` | Research | Ask, investigate, stream answers, inspect citations, save/open conversations | Public/guest behavior + authenticated persistence as currently implemented | Search/chat/conversation APIs |
| `/runs` | Workflows | Launch/monitor autonomous work and inspect results/artifacts | Authenticated/entitlement rules already in app | Agent/run APIs |
| `/agents` | Agents | Configure agents and launch autonomous tasks | Authenticated/entitlement rules already in app | Agents/run configuration |

### Intelligence

| Route | Label | Job | Access | Primary data |
|---|---|---|---|---|
| `/compare` | Model Lab | Compare available model answers side-by-side | Pro-or-higher entitlement as existing API enforces | `/api/compare` |
| `/local-ai` | Local Runtime | Inspect/connect private llama.cpp runtime and use local inference | Authenticated workspace / local bridge constraints | `/api/local-ai/status`, local bridge APIs |
| `/knowledge` | Knowledge | Upload/manage files and retrieve workspace context | Authenticated | Knowledge APIs/library |
| `/memory` | Memory | Inspect retained user context and manage memories | Authenticated owner | `/api/memory` / persistent memory |

### Automation

| Route | Label | Job | Access | Readiness rule |
|---|---|---|---|---|
| `/browser-agent` | Browser Agent | Inspect browser-agent readiness/session capability | Authenticated | Show real local/desktop readiness; live execution UI only when a real session contract exists |
| `/swarms` | Swarms | Inspect multi-agent orchestration across runs | Authenticated | Use real agents/runs data; unsupported control-plane actions are gated |
| `/projects` | Projects | Organize context, agents, runs and artifacts around a project | Authenticated | Do not enable project mutation until durable project persistence exists |

### System

| Route | Label | Job | Access | Primary data |
|---|---|---|---|---|
| `/workspace-search` | Global Search | Search conversations/messages/memory | Authenticated | Direct user-scoped conversation + memory stores |
| `/settings#integrations` | Integrations | Inspect/provider runtime setup and integration status | Authenticated | `/api/integrations/status` and existing settings destinations |
| `/governance` | Governance | Inspect enterprise/data-control readiness | Authenticated; admin/enterprise controls where required | Real authorization/config only; unsupported mutation gated |
| `/admin/analytics` | Analytics | Owner/admin telemetry | Analytics admin only | Existing analytics/admin APIs |
| `/pricing` | Plans | Compare plans and enter upgrade flow | Public | Existing billing status/upgrade routes |

## Contextual navigation

### Research

Contextual sidebar contains only:
- New chat
- Search conversations
- Conversation history/groups
- Account/workspace usage link

It must not duplicate global AIRA product navigation.

### Runs

Context may expose:
- current run summary
- status/timeline
- tool activity
- artifacts
- intervention/cancel controls when real backend semantics exist

### Knowledge

Context may expose:
- library/filtering
- ingestion state
- search
- optional graph sub-view when backed by graph data

## Command palette

`Ctrl/Cmd + K` is the global quick switch. It mirrors capability-aware visible navigation. It must not surface destinations the current user cannot access.

## Mobile behavior

- Global rail becomes an explicit drawer.
- Drawer closes after navigation and on Escape.
- Contextual sidebars collapse independently of the global drawer.
- No desktop-only route exists; every canonical route must degrade to a usable mobile workflow.
- Tables become scrollable/stacked without obscuring primary actions.

## Deep links and browser history

- `/?conversation=<id>` restores a saved conversation owned by the authenticated user.
- `/memory?memory=<id>` focuses the exact memory result.
- Run/artifact deep links must resolve through server-authorized identifiers.
- Browser Back should return to the previous workspace/list state rather than reset the entire OS shell.

## Capability gating

A capability gate is not a placeholder. It must state:
1. what capability is being checked;
2. its current real status (`available`, `not configured`, `offline`, `unsupported`, `permission required`);
3. what existing action can resolve it (e.g. Local Runtime, Integrations, sign-in, plan upgrade);
4. what is intentionally unavailable.

No fake controls, fake browser sessions, fake swarm members, fake project persistence, fake telemetry or hardcoded `connected` states are allowed.

## Access-control requirements

- User-scoped conversation, memory, knowledge and run access remains bound to authenticated ownership.
- Model comparison retains existing server-side entitlement enforcement.
- Analytics remains capability-aware and admin-only.
- Client navigation may hide restricted destinations, but server/API authorization is still mandatory.
- No security control is weakened to match a Stitch mockup.

## Critical journeys

1. Research: prompt → search/stream → citations → save/open conversation.
2. Agent: configure → launch → run → activity/intervention → result/artifact.
3. Workflow: template/create → configure → execute → monitor → complete/fail/cancel → inspect.
4. Knowledge: upload → processing → ready/error → retrieve in Research.
5. Memory: recall → inspect/focus → edit/delete where supported → reuse.
6. Model Lab: prompt → compare → inspect → select preferred model/provider behavior.
7. Browser Agent: readiness → session only if real → actions → approval only if real → completion.
8. Integrations: status → configure destination → verify/recover.
9. Runtime: online → degraded/offline/not configured → recovery.

## Definition of architectural completion

- Exactly one global shell/navigation architecture.
- Every visible destination resolves to a real route.
- Every route has a documented purpose, access rule and data/capability owner.
- Responsive variants remain within the same canonical route.
- Unsupported execution is capability-gated, never simulated.