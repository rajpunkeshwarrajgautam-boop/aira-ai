# AIRA Stitch Canonicalization

This document resolves overlapping Stitch exports into one production target per capability.

## Rules

1. Canonicalize by **user capability**, not by file name or visual novelty.
2. Desktop/mobile/theme/state variants remain attached to the same route.
3. A top-level navigation item exists only for a distinct user job.
4. Artifact, approval, handoff and execution screens are **states/sub-views**, not separate products.
5. Generated Stitch HTML is reference material; production uses shared Next.js components and real APIs.
6. When AIRA lacks a backend contract, preserve the visual/intention as a **capability gate** rather than mock data.

## Consolidation decisions

### Research family

Canonical route: `/`

Merge:
- `chat_marketing_strategy_project`
- `research_global_semiconductor_supply_chain_analysis`

Responsive variants:
- `chat_mobile`
- `research_mobile_view`

The current Research route remains the product entry point. It owns conversation history, composer, streaming, grounded citations and message/inspector states. Global AIRA navigation belongs only to the shared shell; the Research sidebar is contextual history only.

### Agents + execution family

Canonical routes: `/agents` and `/runs`

Agent configuration:
- `agent_builder_senior_research_analyst` → `/agents` canonical builder/configuration state.

Execution/run states:
- `agent_mode_market_analysis`
- `agent_task_market_analysis`
- `active_execution_dark_mode`
- `active_execution_signature_interaction`
- `agent_interaction_states_human_in_the_loop`
- `agent_hand_off_swarm_coordination`

These become run-detail states/components. They must not create six competing execution routes.

### Workflow family

Canonical surface: `/runs`

- `workflow_editor_multi_agent_orchestration` → workflow editor/composition state.
- `workflow_templates_gallery` → templates state.

The existing execution backend is authoritative. Visual graph editing or template persistence is enabled only where real contracts exist.

### Swarm family

Canonical route: `/swarms`

Merge:
- `agent_swarm_project_phoenix`
- `swarm_management_project_phoenix`

Use real run/agent orchestration data. Do not render fictitious agents, health, utilization or topology.

### Model Lab family

Canonical route: `/compare`

- `model_lab_llm_evaluation` is the canonical comparison experience.
- Any simple/advanced comparison differences are interaction states within the same route.

Existing entitlement/provider policy remains authoritative.

### Knowledge family

Canonical route: `/knowledge`

- `knowledge_global_core_intel` → files/knowledge library canonical view.
- `knowledge_graph_cross_project_intelligence` → optional graph sub-view.

The graph view is enabled only when real graph-memory data is available. It is not allowed to fabricate nodes or relationships.

### Memory family

Canonical route: `/memory`

- `memory_context_personal_intelligence_layer` is the canonical design reference.

Existing user ownership, focus-by-query, edit/delete semantics and semantic-memory policy remain authoritative.

### Project family

Canonical route: `/projects`

- `project_hub_project_phoenix_overview` is the canonical conceptual reference.
- `artifact_workspace_dashboard_react_component` contributes artifact/work-product patterns to project and run detail.

Project persistence must be backed by a real model before create/edit controls are enabled. Until then, the route provides a truthful capability/setup state and links to existing Knowledge/Agents/Runs surfaces.

### Browser Agent family

Canonical route: `/browser-agent`

- `browser_agent_live_viewport` is the canonical visual reference.

Desktop/browser tooling and local browser-turn APIs can inform real readiness/status. A web viewport, action stream, takeover button or approval state must never imply that a live browser session exists when it does not.

### Settings / enterprise / governance family

Canonical surfaces:
- `/settings#integrations`
- `/governance`
- `/admin/analytics` (admin only)

Merge/responsive:
- `settings_enterprise_governance_integrations` → Settings/Integrations canonical reference.
- `enterprise_controls_mobile_view` → mobile enterprise/governance variant.
- `data_governance_enterprise_policy_control` → Governance canonical reference.
- `advanced_telemetry_audit_cost_analysis` → admin Analytics/telemetry state.
- `telemetry_mobile_oversight` → responsive Analytics state.

Existing authorization and admin gates must remain intact. Unsupported enterprise policy mutation is capability-gated.

### Onboarding family

Canonical product concept: one first-run onboarding flow.

Merge/theme variants:
- `welcome_to_aira_ai_onboarding`
- `welcome_to_aira_dark_mode`

Any additional welcome variants discovered later are treated as state/theme alternatives, not additional routes. Onboarding is lower priority than the authenticated operating system and must not introduce fake persisted progress.

### Control/home family

Canonical route: `/control-center`

- `home_aira_ai` contributes the Intelligence OS overview hierarchy.
- Premium/system overview concepts should be folded into real Control Center status or billing/entitlement surfaces, not split into a second home application.

### Design sources

Not production routes:
- `design_system_mobile_components`
- standalone logo asset
- all `DESIGN.md` files

These define shared tokens/components and responsive rules.

## Removed architecture patterns

The following are explicitly superseded:

- nested global app rail inside Research conversation history;
- multiple top-level pages for run states;
- separate routes for desktop/mobile versions of the same capability;
- telemetry cards populated with decorative/fake numbers;
- unsupported browser/swarm/project controls that behave as no-ops;
- per-screen hardcoded visual systems that compete with Quiet Power.

## Acceptance criterion

A future Stitch export may add states, but it must be mapped into this capability model before a new top-level production route is created.