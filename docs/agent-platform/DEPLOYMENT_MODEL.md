# AIRA Agent Platform — Deployment Model

## Principle

AIRA's web application is the control plane. Long-running autonomous work belongs to a durable execution plane.

Do not implement autonomous persistence with an in-memory loop inside a short-lived HTTP request.

## Control plane

The existing Next.js/Vercel application remains responsible for:

- authenticated APIs,
- project/run/task management,
- runtime selection,
- policy and approvals,
- normalized status,
- billing/usage controls,
- event delivery to the UI,
- references to artifacts and credentials.

## Execution plane

Persistent workers may run through:

- AIRA foundation/sandbox services,
- DeerFlow runner,
- AutoGPT runner,
- Agent Swarm Docker workers,
- future E2B-compatible or dedicated Linux workers.

The web application communicates with these services over authenticated, bounded APIs.

## Agent Swarm deployment

Agent Swarm is initially an optional runtime adapter. AIRA expects:

```text
AGENT_SWARM_ENABLED=true
AGENT_SWARM_BASE_URL=https://swarm.example.com
AGENT_SWARM_API_TOKEN=<server-only bearer token>
```

Optional routing controls:

```text
AGENT_SWARM_MODEL_TIER=regular
AGENT_SWARM_TIMEOUT_MS=8000
AIRA_AGENT_RUNTIME_PRIORITY=DEERFLOW,AUTOGPT,AGENT_SWARM
```

The Agent Swarm API and workers should be deployed independently from the Vercel request lifecycle. Its database/worker storage requires durable volumes or an equivalent production persistence design.

## Rollout sequence

1. Merge runtime abstraction only after CI is green.
2. Deploy with Agent Swarm variables absent/disabled. Verify DeerFlow/AutoGPT behavior is unchanged.
3. Provision Agent Swarm execution host and bearer authentication.
4. Verify health and task API from the AIRA server environment.
5. Enable Agent Swarm but leave it last in runtime priority.
6. Run explicit `provider=AGENT_SWARM` canary tasks.
7. Verify create/status/cancel plus quota/idempotency behavior.
8. Only then consider changing default priority.

## Rollback

Stage 1 requires no database migration. Rollback is therefore straightforward:

- disable `AGENT_SWARM_ENABLED`, and/or
- revert the runtime-registry API refactor.

Existing `AgentRun` rows for DeerFlow/AutoGPT remain compatible.

If Agent Swarm canary rows exist, retain the adapter until those rows are terminal or explicitly reconciled; do not revert into code that interprets an unknown provider as AutoGPT.

## Future swarm/browser deployment

Task DAGs and browser sessions require durable event/task storage plus workers that survive frontend deploys. Browser workers additionally require session streaming and isolated Chromium profiles. These should be introduced as separate deployment units and migrations with independent health checks and rollback procedures.
