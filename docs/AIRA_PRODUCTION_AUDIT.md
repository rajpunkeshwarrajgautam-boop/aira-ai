# AIRA Production Audit

Status: implementation baseline for `feat/aira-production-agent-os`

## Executive summary

AIRA is already a multi-surface product, not a blank agent prototype. The current production line contains a Next.js web workspace, authenticated user-owned persistence, provider routing, autonomous DeerFlow/AutoGPT runners, an immutable agent-run event ledger, durable step projections, approval-gated tool execution, MCP integration, memory/knowledge systems, model comparison, global search, foundation runtime services, and a separately packaged Electron Windows desktop agent.

The principal product gap is not UI. It is orchestration convergence: AIRA has several capable execution loops, but the web product does not yet have one truthful AIRA-owned Manager -> Planner -> DAG -> specialist scheduler -> Verifier runtime that coordinates those capabilities as child work under one parent objective.

This branch adds the first safe convergence layer: explicit roles/task states, DAG validation, bounded scheduling, retry/delegation/time/token/tool/cost budgets, repeated-action protection, role-scoped tool permissions, a private structured planner, an independent verifier, and adapters into the existing durable run-step ledger. The canonical ToolRegistry, approvals, provider routing, and existing run persistence remain authoritative.

## 1. Existing architecture

### Web application

- Next.js/React application under `perplexity-clone/my-turborepo/apps/web`.
- Auth.js-backed authentication and Prisma/PostgreSQL persistence.
- Conversation history, persistent memory, research history, model comparison, global search, settings/integration surfaces, billing/entitlements and analytics.
- Server-selected provider routing through NVIDIA, OpenAI-compatible providers and OmniRoute with health/circuit/fallback/residency controls.

### Autonomous execution

- User-owned `AgentRun` records.
- DeerFlow and AutoGPT external execution adapters.
- Idempotent client request IDs and quota accounting.
- Remote-acceptance checkpoints prevent ambiguous retries from duplicating remote work.
- Background reconciliation closes stale runs and refreshes accepted executions.
- Immutable `AgentRunEvent` records are the durable lifecycle/event source.
- `RUN_STEP` events project that immutable ledger into Run Center steps.
- Durable, user-owned `AgentToolApproval` records enforce privileged tool approval.

### Tool layer

- One canonical executable `ToolRegistry`.
- Zod validation before execution.
- Explicit tool permission classes: READ, WRITE, EXTERNAL_COMMUNICATION, BROWSER_ACTION, CODE_EXECUTION, ACCOUNT_MUTATION, DESTRUCTIVE and HIGH_IMPACT.
- `auto` executes only READ tools without approval; privileged actions remain approval-gated.
- Built-ins include web search, citation formatting, memory lookup and calculator; Python sandbox is configuration-gated.
- MCP tools enter through the same ToolRegistry rather than bypassing execution policy.
- Web runtime exposes the browser capability truthfully as unavailable until a production browser service is activated.

### Windows desktop

- Electron application under `desktop-agent`.
- Local agent loop, Ollama/OpenAI-compatible model paths, memory/RAG, browser controller, computer/file/terminal/Android tool surfaces, voice/scheduling/audit/configuration code and approval/policy tests.
- Browser controller uses a sandboxed Electron BrowserWindow, HTTP(S)-only navigation, permission denial by default, semantic DOM snapshots, click/type/back and screenshots.
- NSIS packaging, GitHub release support and automatic-update dependency are configured.

### Foundation/runtime services

- Containerized control/sandbox foundation with CI smoke validation.
- Dedicated DeerFlow and AutoGPT runner validation/build jobs.
- Vercel/web deployment configuration and OmniRoute gateway/operator infrastructure already exist on the production development line.

## 2. Functional systems verified by automated evidence

- Web production dependency audit.
- Web lint/typecheck/tests/build through the repository CI quality gate.
- AutoGPT adapter contract tests and authenticated image build.
- DeerFlow provisioning/verification scripts and fail-closed host gate.
- Foundation control/sandbox Compose smoke tests and isolation verification.
- AIRA runtime bootstrap/edge configuration validation.
- Windows dependency audit, typecheck/policy tests/build, Electron packaging and installer artifact upload in AIRA Desktop Windows run #95 for commit `a628e95785d482dd522f43c8d7ca69b1dc543dac`.
- New AIRA DAG/scheduler/runtime-policy tests in this branch.

## 3. Partially functional systems

### Unified AIRA multi-agent runtime

The branch now has explicit Manager/Planner-era runtime contracts, but the planner/scheduler is not yet the submission path for `/api/agents/runs`. Existing DeerFlow/AutoGPT runs still accept one objective as one external provider execution. Presenting their opaque work as multiple AIRA specialists would be false, so no synthetic swarm is rendered.

### Browser operator

A real local browser controller exists in AIRA Desktop. The web ToolRegistry intentionally reports the browser runtime unavailable because no production web-side browser service is activated. A shared Browser Operator must converge these capabilities rather than pretending the web capability is live.

### Coder/computer operator

AIRA Desktop contains real local tools. The web runtime has an isolated Python sandbox path but does not yet expose a general authorized repository filesystem/terminal coding workspace through the canonical web ToolRegistry.

### Killer workflow

The component capabilities exist across different runtimes, but `Build this business/app for me` is not yet one verified end-to-end AIRA-owned workflow from research through code, browser QA, repair and deployment.

### Physical Windows acceptance

CI proves the installer can be produced. It does not prove clean install, first launch, real Ollama connectivity, update behavior, crash recovery, uninstall/reinstall or long-running computer/browser use on a physical Windows machine.

## 4. Broken systems observed

No repository-wide build/type/lint/test failure remains at the current validated runtime checkpoint. CI #616 exposed a Node strip-only TypeScript compatibility defect in newly added constructor parameter properties; commit `1c26e24ba2f4621e460ad99fbff1fc3c96076cc8` removes the unsupported syntax and CI #617 validates the repair.

External integrations can still be unavailable at runtime when deployment credentials/services are absent; these are configuration/runtime availability states rather than silently passing features.

## 5. Placeholder/mock systems

Repository searches performed during this audit did not return TODO, FIXME or literal `placeholder` code results. This is not proof that every product surface is complete.

The web browser descriptor is deliberately a truthful virtual capability with state `UNAVAILABLE`; it must not be converted into fake execution or fake progress.

Deterministic fake routers used by unit tests are test doubles only and are not production provider implementations.

## 6. Security risks requiring continued attention

1. Browser, terminal, filesystem and code-execution tools have materially higher privilege than chat/research.
2. Webpages and uploaded files are untrusted prompt-injection sources and must never redefine system/tool policy.
3. Agent-to-agent delegation can amplify privileges unless role capability checks remain enforced at the final ToolRegistry boundary.
4. Repeated or recursive autonomous work can create runaway spend/side effects without hard budgets.
5. Cross-workspace/user data isolation depends on server-side ownership checks and database policy staying authoritative.
6. Provider output must not be trusted as evidence that an external action actually happened.
7. Desktop local execution has different trust boundaries from the server web runtime; secrets and privileged IPC must remain isolated from the renderer.

## 7. Reliability risks

- One parent AIRA objective is still mapped to one opaque remote DeerFlow/AutoGPT execution rather than durable child-task execution.
- No production web Browser Operator is active.
- Physical Windows lifecycle testing is outstanding.
- Live credentials/provider quotas can fail independently of CI.
- Long-lived agent runs require restart-safe scheduling state beyond transient process memory.
- Verification and retry must be driven by observable evidence, not worker self-report.

## 8. Architectural debt

- Multiple execution loops exist: web research orchestration, external DeerFlow/AutoGPT runs and the AIRA Desktop local agent loop.
- Parent/child specialist execution is not yet represented as a first-class persisted AIRA orchestration object.
- Desktop and web tool capability descriptions/policies are not yet generated from one shared contract.
- Cost/token accounting is not normalized across every provider/runtime.
- The browser capability is split between a real Desktop controller and an unavailable web descriptor.

## 9. Missing high-value tests

- Clean Windows install/launch/uninstall/reinstall on a clean Windows 10/11 VM.
- Desktop Ollama live smoke test.
- Desktop browser multi-step navigation/form/screenshot recovery test.
- End-to-end parent objective -> plan -> parallel specialist tasks -> verifier -> repair -> completion.
- Persisted scheduler resume after process/application restart.
- Approval requested -> restart -> approve/deny -> resume.
- Provider timeout/rate limit during a multi-task run with deterministic fallback/replan.
- Browser prompt-injection resistance and dangerous-action approval tests.
- Authorized coding workspace rollback/checkpoint test.

## 10. Recommended implementation order

1. Keep the new runtime foundation green in CI.
2. Persist AIRA execution plans and child task state using the existing immutable run ledger or an additive parent/child schema where necessary.
3. Add a Manager execution loop that dispatches only real specialist executors and never synthetic progress.
4. Converge browser execution: Desktop first, then a sandboxed server/browser service for web.
5. Add authorized coding workspace/file/terminal execution with checkpoints and rollback.
6. Wire independent verifier failure into bounded repair/retry/replan.
7. Expose the real DAG/agents/tool calls/approvals/artifacts/costs in Run Center.
8. Run physical Windows acceptance.
9. Execute the flagship business/app workflow end-to-end.
10. Only then measure design-partner activation, completion, intervention, cost and retention.
