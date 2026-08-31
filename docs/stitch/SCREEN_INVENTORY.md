# AIRA Stitch Screen Inventory

Status: authoritative inventory for the `stitch/aira-intelligence-os` integration branch.

## Export summary

- Code-bearing screens: **31**
- Rendered `screen.png` assets: **32** (includes the standalone logo asset)
- Design specifications (`DESIGN.md`): **5**
- Source batches: **3**
- Design language: **Quiet Power** — Geist, 8px rhythm, Deep Indigo `#253CC0`, warm paper light surfaces, Deep Studio dark surfaces, thin borders, restrained elevation.

## Disposition vocabulary

- **Canonical**: target production representation.
- **Responsive variant**: same capability at a different viewport.
- **State variant**: same route/capability in a different operational state.
- **Merge**: concepts combined into another canonical surface.
- **Capability-gated**: route may exist, but unsupported execution must be represented truthfully.
- **Design source**: component/design reference, not a production route.

## Screen inventory

| ID | Batch / Stitch folder | Domain | Purpose | Canonical route / surface | Disposition | Backend/readiness | Action |
|---|---|---|---|---|---|---|---|
| SCR-AGT-001 | b1 `agent_builder_senior_research_analyst` | Agents | Configure a specialized autonomous agent | `/agents` builder state | Canonical | Existing agents/runs platform | Merge visual language into AgentDashboard/builder flow |
| SCR-AGT-002 | b1 `agent_mode_market_analysis` | Agents | Agent-mode task execution | `/runs` / agent execution state | Merge | Existing run execution | Reuse run detail and execution components |
| SCR-SWM-001 | b1 `agent_swarm_project_phoenix` | Swarms | Multi-agent control-room view | `/swarms` | Merge | Partial orchestration data exists | Build truthful orchestration overview; gate unsupported topology controls |
| SCR-AGT-003 | b1 `agent_task_market_analysis` | Agents | Concrete agent task/run detail | `/runs` detail | State variant | Existing run APIs | Map to run detail rather than new top-level route |
| SCR-ART-001 | b1 `artifact_workspace_dashboard_react_component` | Artifacts | Inspect generated artifacts/work products | Run/project artifact surface | Canonical sub-view | Existing artifact APIs | Integrate with run/project context; not top-level navigation |
| SCR-RES-001 | b1 `chat_marketing_strategy_project` | Research | Primary chat/research workspace | `/` | Canonical | Existing search/chat/conversation stack | Preserve real streaming/citations/conversations in unified shell |
| SCR-RES-002 | b1 `chat_mobile` | Research | Mobile chat layout | `/` | Responsive variant | Existing chat stack | Validate 430/390/360 widths |
| SCR-HOM-001 | b1 `home_aira_ai` | Control / Home | Intelligence OS landing/overview | `/control-center` | Merge | Existing live status APIs | Fold overview intent into live Control Center |
| SCR-KNW-001 | b1 `knowledge_global_core_intel` | Knowledge | Knowledge/files workspace | `/knowledge` | Canonical | Existing knowledge APIs | Align current knowledge workspace to Stitch IA |
| SCR-MDL-001 | b1 `model_lab_llm_evaluation` | Models | Side-by-side model evaluation | `/compare` | Canonical | Existing compare API | Reuse entitlement-aware model comparison |
| SCR-PRJ-001 | b1 `project_hub_project_phoenix_overview` | Projects | Project context, work, agents and artifacts | `/projects` | Canonical concept | Project persistence contract incomplete | Create truthful project workspace/gate unsupported persistence |
| SCR-WFL-001 | b1 `workflow_editor_multi_agent_orchestration` | Workflows | Compose multi-agent workflow | `/runs` workflow/editor state | Canonical concept | Run platform exists; visual editor partial | Reuse run execution; gate unsupported graph editing |
| SCR-RUN-001 | b2 `active_execution_dark_mode` | Runs | Live execution monitoring in Deep Studio | `/runs` detail | Canonical state | Existing run APIs | Integrate active run timeline/tool activity |
| SCR-RUN-002 | b2 `active_execution_signature_interaction` | Runs | Signature execution interaction | `/runs` detail | State variant | Existing run APIs | Merge into active-execution detail |
| SCR-ENT-001 | b2 `enterprise_controls_mobile_view` | Governance | Enterprise controls on mobile | `/governance` / settings | Responsive variant | Partial admin/settings capabilities | Capability-gate controls without backend contracts |
| SCR-MEM-001 | b2 `memory_context_personal_intelligence_layer` | Memory | Review retained context/personal intelligence | `/memory` | Canonical | Existing persistent memory | Preserve ownership/auth and focus-by-query behavior |
| SCR-RES-003 | b2 `research_global_semiconductor_supply_chain_analysis` | Research | Deep research/citation-rich result | `/` | State variant | Existing grounded research | Use as populated/deep-research reference |
| SCR-RES-004 | b2 `research_mobile_view` | Research | Research result on mobile | `/` | Responsive variant | Existing research | Consolidate with canonical Research responsive system |
| SCR-SET-001 | b2 `settings_enterprise_governance_integrations` | Settings | Provider/integration/governance settings | `/settings#integrations` | Canonical | Existing integration status/settings | Keep real status + permission checks |
| SCR-ONB-001 | b2 `welcome_to_aira_ai_onboarding` | Onboarding | First-run product orientation | Onboarding state | Canonical concept | Auth exists; onboarding persistence uncertain | Implement only if state contract exists; otherwise defer after V1 core |
| SCR-ONB-002 | b2 `welcome_to_aira_dark_mode` | Onboarding | Dark onboarding presentation | Onboarding state | Theme/state variant | Same as onboarding | Treat as Deep Studio variant, not separate route |
| SCR-WFL-002 | b2 `workflow_templates_gallery` | Workflows | Browse workflow templates | `/runs` templates state | Canonical concept | Execution exists; template persistence uncertain | Provide real built-in templates only if executable; no fake templates |
| SCR-TEL-001 | b3 `advanced_telemetry_audit_cost_analysis` | Analytics | Cost/telemetry audit view | `/admin/analytics` | Merge | Existing admin analytics partially supports telemetry | Keep admin-only; do not invent costs |
| SCR-HOF-001 | b3 `agent_hand_off_swarm_coordination` | Agents/Swarms | Agent-to-agent handoff | Run detail interaction state | State variant | Orchestration data partial | Surface real handoff events when present; gate unsupported actions |
| SCR-HITL-001 | b3 `agent_interaction_states_human_in_the_loop` | Agents | Human approval/intervention | Run detail interaction state | Canonical state | Cancellation/run controls exist; approval contract partial | Implement truthful approval state only where backend supports it |
| SCR-BRW-001 | b3 `browser_agent_live_viewport` | Browser | Browser agent session + action activity | `/browser-agent` | Canonical concept | Desktop/browser tooling exists; web session contract incomplete | Build capability-aware workspace; never simulate actions |
| SCR-GOV-001 | b3 `data_governance_enterprise_policy_control` | Governance | Policy/data sovereignty controls | `/governance` | Canonical concept | Partial enterprise/admin primitives | Capability-gate unimplemented policy mutation |
| CMP-DS-001 | b3 `design_system_mobile_components` | Design system | Mobile/component behavior specification | Shared component library | Design source | N/A | Translate to tokens/primitives; never expose as route |
| SCR-KNW-002 | b3 `knowledge_graph_cross_project_intelligence` | Knowledge | Cross-project knowledge graph | `/knowledge` graph sub-view | Capability-gated sub-view | Graph-memory infrastructure exists; UI contract incomplete | Render only real graph data; otherwise show setup/unavailable state |
| SCR-SWM-002 | b3 `swarm_management_project_phoenix` | Swarms | Swarm overview/management | `/swarms` | Canonical | Partial agents/runs data | Consolidate SCR-SWM-001 into one swarm workspace |
| SCR-TEL-002 | b3 `telemetry_mobile_oversight` | Analytics | Mobile telemetry oversight | `/admin/analytics` | Responsive variant | Existing admin analytics | Responsive/admin-only variant of telemetry surface |
| AST-LOGO-001 | b1 `logo/screen.png` | Brand | AIRA logo reference | Shared brand component | Design source | Existing `AiraLogo` | Preserve as brand source; no route |

## Design specifications

| ID | Source | Use |
|---|---|---|
| SPEC-001 | b1 `aira_ai/DESIGN.md` | Core AIRA visual language |
| SPEC-002 | b2 `aira_ai_1/DESIGN.md` | Alternate/extended AIRA design guidance |
| SPEC-003 | b2 `aira_ai_2/DESIGN.md` | Alternate/extended AIRA design guidance |
| SPEC-004 | b2 `premium_intelligence/DESIGN.md` | Premium/advanced intelligence surfaces |
| SPEC-005 | b3 `aira_ai/DESIGN.md` | Final batch design guidance/component behavior |

## Production traceability summary

### Existing real routes to retain and refine

- `/` — Research/chat
- `/control-center` — operational overview
- `/agents` — agents
- `/runs` — workflows/runs
- `/compare` — Model Lab
- `/local-ai` — local runtime
- `/knowledge` — knowledge/files
- `/memory` — retained context
- `/workspace-search` — global search
- `/settings#integrations` — integrations/settings
- `/admin/analytics` — capability-aware owner analytics
- `/pricing` / `/upgrade` — plans and billing

### New/capability-aware surfaces targeted by this sprint

- `/browser-agent`
- `/swarms`
- `/projects`
- `/governance`

These routes must never fabricate execution, metrics, connectivity, project persistence, policies or browser activity. Unsupported backend capability is represented as a truthful gate with recovery/setup paths.

## Inventory completion rule

Every exported Stitch screen above has a production disposition. The design exports remain reference artifacts; canonicalization determines what is implemented, merged, archived or capability-gated.