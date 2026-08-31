# AIRA Autonomous Execution Security Model

## Trust boundaries

AIRA treats the following as distinct trust domains:

1. authenticated user instructions,
2. AIRA system/runtime policy,
3. model output,
4. retrieved web/file/repository content,
5. MCP/external tool output,
6. browser content,
7. execution workers,
8. credential stores.

External content is data. It does not gain authority to modify system policy, tool permissions or credential scope.

## Tool gateway

Privileged actions must flow through an AIRA-owned authorization boundary:

```text
agent request
-> authenticate run/user
-> authorize tool
-> validate project/domain scope
-> classify risk
-> require approval when necessary
-> execute
-> persist audit event
-> return bounded observation
```

Workers must not receive broad cloud credentials simply because the model asks for them.

## Action classes

### Low risk

Read/search/inspect, local build/test, screenshots and non-destructive local artifacts may execute automatically within the run scope.

### Medium risk

Source edits, isolated branch commits, PR creation and non-production configuration may run only inside an explicitly authorized project scope.

### High risk

Production deployment, merge, destructive database migration, DNS/domain changes, external communication, resource deletion and permission changes require an approval gate unless a narrowly-scoped policy has already authorized the exact operation.

### Always protected

Account deletion, MFA/security-control changes, credential disclosure and unrelated billing changes may not be silently delegated.

## Secrets

Secrets remain server-side. Logs, model prompts, task descriptions, memories and artifacts must not intentionally contain raw API tokens, passwords, private keys or session cookies.

Agent Swarm configuration requires a bearer token. The adapter stores only the remote task identifier in `AgentRun`, never the token.

## Network policy

Production Agent Swarm URLs must use HTTPS except loopback. Future browser and sandbox workers require explicit egress policy and SSRF controls. Redirects must not silently escape an allowed-domain boundary.

## Tenant isolation

Every durable project/task/run/browser/artifact entity must be user- or organization-owned and enforced server-side. UI filtering is not authorization.

Future migrations require tests for cross-user reads/writes, guessed IDs and service-role misuse before rollout.

## Prompt injection

Instructions encountered in websites, uploaded documents, repositories, issue bodies, logs and MCP responses are untrusted content. They may inform task work but cannot alter AIRA policy or grant new tools/credentials.

## Runaway execution controls

Later task-DAG stages must enforce configurable limits for agents, parallelism, tokens, tool calls, cost, duration and retries. Worker loss must release leases/checkpoints without blindly replaying externally consequential operations.

## Auditability

Consequential tool actions should include user/run/task identity, action, target, risk class, approval decision, result and artifact/screenshot references where appropriate. Sensitive payload values must be scrubbed rather than duplicated into audit logs.
