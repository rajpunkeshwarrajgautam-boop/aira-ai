# AIRA Browser Runtime

## Status

The first runtime-foundation change does not claim a production browser worker. This document defines the contract that later browser implementation must satisfy before `/browser` or autonomous browser controls are exposed as working features.

## Browser observation model

A browser worker should combine:

- DOM state,
- accessibility tree,
- screenshot/frame observation,
- URL/navigation state,
- console errors,
- failed network requests.

No single source is sufficient for reliable visual QA or computer-use behavior.

## Required actions

The eventual adapter should support capability-gated operations such as navigation, click, double-click, typing, selection, scrolling, hover, drag/drop, upload/download, tab management, screenshot capture and structured extraction.

Arbitrary JavaScript execution must be a separately permissioned operation.

## Session isolation

Every session is scoped to:

- authenticated user,
- project,
- task/run,
- allowed domains,
- action permissions,
- creation/expiry timestamps.

Cookies, storage and downloaded artifacts must not cross user/project boundaries.

## Control modes

### Observe

Read-only navigation/inspection. State-changing interactions are denied.

### Assisted

Normal interactions are allowed within scope; consequential operations enter an approval state.

### Autonomous

The user grants a bounded mission. Domain/action restrictions remain active and protected operations still require policy approval.

## Human takeover

Takeover must transfer input ownership, not create a second browser:

1. stop automated input,
2. preserve the exact session,
3. mark control owner as human,
4. permit manual interaction,
5. resume the agent only after explicit handback.

The event log records ownership transitions.

## Browser security

Browser workers are execution-plane services, not ordinary Next.js request handlers. They require resource/time limits, isolated profiles, egress controls, download mediation and audit events.

Credentials must be injected by a server-side broker or browser-session service and must not be included in model prompts. Prompt-visible data should contain credential references only.

## Implementation direction

Playwright/Chromium or a compatible remote-browser runtime is the preferred baseline. Agent Swarm's qa-use/browser-use integration patterns may inform the worker design, but AIRA owns the permission, session and audit contracts.
