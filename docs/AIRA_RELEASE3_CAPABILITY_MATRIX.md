# AIRA AI — Release 3 Capability Matrix

| Feature Surface | User-Facing Name | Status | Truthful State & Behavior |
| :--- | :--- | :--- | :--- |
| **Authentication** | Sign In / Sign Up | `WORKING_E2E` | Clean SVG geometry in Google button, standard OAuth/Credentials integration, zero DOM console errors. |
| **Search Engine** | AIRA Search | `WORKING_E2E` | Production grounded search, citation engine, and live streaming response. |
| **Model Lab** | AIRA Models | `PARTIALLY_WORKING` | Target discovery returns explicit configuration/entitlement states rather than blanket `0 targets available`. |
| **Gateway Routing** | AIRA Route | `BLOCKED_BY_CONFIGURATION` | Client displays truthful `AIRA Route` status; backend relies on `OMNIROUTE_*` environment variables. Fallbacks to direct provider routes when permitted. |
| **Knowledge Engine** | AIRA Knowledge | `BLOCKED_BY_CONFIGURATION` | Full ingestion pipeline defined; upload UI truthfully reports missing vector/storage credentials without fake ingestion. |
| **Agent Runtime** | AIRA Agents | `BLOCKED_BY_EXTERNAL_RUNTIME` | Agent definitions persist in DB; execution capabilities report truthful runtime requirements. |
| **Work Execution** | AIRA Work | `PARTIALLY_WORKING` | Planning mode active; execution mode reports runtime dependency truthfully. |
| **Builder / Sandbox**| AIRA Builder | `PARTIALLY_WORKING` | Code generation operational; full containerized preview requires preview sandbox worker. |
| **Browser Runtime** | AIRA Browser | `BLOCKED_BY_EXTERNAL_RUNTIME` | Canonical `/browser` route configured; remote browser driver requires active runtime endpoint. |
| **Automations** | AIRA Automations | `WORKING_E2E` | Workflow persistence, DAG validation, and status tracking active. |
| **Teams / Swarms** | AIRA Teams | `HIDDEN_UNTIL_READY` | Multi-agent swarm orchestration reserved for post-single-agent activation. |
| **Governance** | AIRA Governance | `WORKING_E2E` | Resolved infinite loading; enterprise identity displays `NOT CONFIGURED` or `PERMISSION REQUIRED` deterministically. |
| **Projects** | AIRA Projects | `WORKING_E2E` | Streamlined empty state without dead canvas placeholders. |
| **Commercial / Billing** | Plans & Billing | `WORKING_E2E` | Fail-closed checkout gate active; pricing display truthfully states commercial activation status. |
