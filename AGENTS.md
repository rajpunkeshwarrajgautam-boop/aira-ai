# AIRA AI Agent Guide

## PROJECT

AIRA AI is a production AI workspace for research, chat, models, agents, runs,
knowledge, memory, integrations, and administration. Keep changes practical,
truthful, secure, and ready for real users.

## CHANGE SCOPE

- Inspect the minimum files needed to understand and complete the task.
- Use targeted search; do not scan the whole repository unless explicitly required.
- Do not reread unchanged files unnecessarily.
- Make the smallest complete change and avoid unrelated refactors.
- Preserve existing architecture unless a change is justified by the task.

## EXISTING DOCUMENTATION

Use repository documentation when relevant instead of rediscovering architecture.
Read `DESIGN.md`, `PRODUCT.md`, or `PROJECT_STATUS.md` only when the task needs
that context. Do not duplicate their contents here.

## FRONTEND

- Preserve responsive behavior and accessibility.
- Support loading, error, empty, and disabled states.
- Do not add placeholder, fake, or misleading functionality.
- Reuse existing design-system components and patterns.
- Avoid monolithic global CSS; migrate legacy CSS incrementally without rewriting
  unrelated surfaces.

## BACKEND AND SECURITY

- Never bypass authentication; enforce authorization server-side.
- Admin access must fail closed.
- Keep secrets server-only; never expose service credentials through `NEXT_PUBLIC_*`.
- Integration and provider status must reflect real backend configuration.
- Never fabricate metrics, quotas, health, cost, benchmark, or connection states.
- Preserve owner/session scoping for Knowledge and Memory.

## DATABASE

- Do not weaken authorization or RLS to make functionality work.
- Validate access server-side.
- Make migrations explicit.
- Do not fabricate database records for testing.

## CONTEXT / CODEX USAGE EFFICIENCY

- Treat context and tool calls as expensive.
- Inspect only relevant files and their direct dependencies.
- Use `git diff` rather than repeatedly rereading modified areas.
- Avoid repository-wide searches and repeated browser sweeps unless necessary.
- Run targeted tests first; avoid repeated full builds.
- Keep progress updates brief and stop when acceptance criteria are met.
- Ask before substantially expanding task scope.

## VALIDATION

Use the narrowest validation appropriate to the change:

1. Targeted tests
2. Affected type and lint checks
3. Broader tests only when needed
4. Full production build only for integration- or release-sensitive changes

Do not run an expensive full verification cycle after every small modification.

## GIT

- Inspect `git status` and `git diff` before finishing.
- Never discard unrelated user changes or rewrite history without explicit request.
- Keep commits focused.
- Do not push or merge unless requested.

## COMPLETION REPORT

Report only:

- What changed
- Files changed
- Validation performed
- Genuine remaining blockers

Avoid repeating repository architecture or narrating every tool call.
