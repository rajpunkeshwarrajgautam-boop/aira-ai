# AIRA V2 frontend architecture

Status: **parallel preview architecture; legacy frontend and backend remain authoritative**.

## Goal

AIRA V2 is a new product surface built beside the current frontend. It deliberately reuses the
existing authenticated backend contracts while establishing a cleaner workspace architecture that
can later be extracted into its own Next.js application without rewriting business logic.

## Safety boundary

- Production `/` remains unchanged.
- V2 is mounted at `/v2`.
- V2 does not read the database directly.
- V2 does not import backend services, Prisma, billing enforcement, safety gateways, or agent runners.
- All data access goes through the existing `/api/*` contracts using same-origin authenticated fetches.
- Legacy pages remain available as fallback controls while modules are migrated.
- No schema migration is required for this milestone.

## Compatibility layer

`src/v2/compat/aira-api.ts` is the only V2 module allowed to know legacy endpoint shapes.

Initial adapters:

- `POST /api/search` — grounded/deep research SSE stream
- `GET /api/conversations`
- `GET /api/conversations/:id/messages`
- `GET /api/agents/runs`

The UI consumes V2-owned types rather than importing legacy React component types. This keeps the
new interface independent from the current frontend while preserving backend behavior.

## Product model

V2 treats Research, Agents, Library, and Memory as contextual capabilities of one workspace.

Desktop:

`Navigation | Work surface | Context`

The context rail carries sources today and is intended to carry files, memory, tool activity,
agent steps, and approvals as their adapters reach parity.

Mobile:

- navigation becomes a drawer;
- context becomes a future bottom sheet;
- the composer remains the primary interaction.

## Migration sequence

1. **Milestone 1 — shell + research compatibility**
   - new V2 workspace
   - existing search stream
   - existing conversations
   - citation context rail
   - read-only agent activity

2. **Milestone 2 — conversation parity**
   - branch/follow-up controls
   - share
   - research history
   - billing/quota presentation
   - error parity

3. **Milestone 3 — agent parity**
   - start/cancel/sync
   - provider capability model
   - agent steps
   - artifacts/diffs
   - human approval surfaces

4. **Milestone 4 — memory + library**
   - typed memory adapter
   - artifact index and previews
   - source-to-artifact traceability

5. **Milestone 5 — extraction**
   - freeze compatibility contracts
   - move V2 to its own workspace app
   - preserve same-origin auth through a gateway/BFF
   - switch production traffic only after parity + E2E acceptance

## Acceptance gates before replacing `/`

- current search, citations, follow-ups, anonymous quota, authenticated quota, and deep-research plan
  enforcement behave identically;
- auth/session behavior is identical;
- agent start/poll/cancel behavior reaches parity;
- memory and artifact ownership is preserved;
- desktop and mobile E2E suites pass;
- accessibility and reduced-motion checks pass;
- Vercel preview build/type/lint/test gates are green;
- no production API contract is changed merely to accommodate V2.
