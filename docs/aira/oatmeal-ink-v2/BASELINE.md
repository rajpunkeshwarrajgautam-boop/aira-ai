# AIRA AI — Baseline Specification (Oatmeal & Ink 2.0)

> **Document**: Authoritative Implementation Baseline  
> **Date**: 2026-09-22  
> **Master Directive**: Oatmeal & Ink 2.0 Autonomous Production-Preserving Execution  
> **Branch**: `integration/aira-oatmeal-ink-v2`  
> **Worktree Path**: `c:\Users\WORKSTATION\aira-ai-v5.1`

---

## 1. System Baseline Identifiers

| Identifier | Value | Verification Proof |
| :--- | :--- | :--- |
| **Repository Root** | `c:\Users\WORKSTATION\aira-ai-v5.1` | Linked worktree of `C:\Users\WORKSTATION\aira-ai` |
| **Current Branch** | `integration/aira-oatmeal-ink-v2` | `git branch --show-current` |
| **Current Commit SHA** | `fb68d01645295b40db77b8dda95af73de21c612d` | `git rev-parse HEAD` |
| **Remote Main SHA** | `fb68d01645295b40db77b8dda95af73de21c612d` | `git rev-parse origin/main` |
| **Vercel Production Deployment** | `dpl_9dFaD2egKpx8wBf8kgoX8MxNJvfi` | `vercel inspect https://aira-ai-live-rd9onv1nm-rajpunkeshwarrajgautam-boops-projects.vercel.app` |
| **Live Production Domain** | `https://aira-ai.in` | HTTP 200, Vercel alias verified |
| **Prior Branch Status** | `integration/aira-ui-production-polish` | Preserved on origin & local at `fb68d016` |
| **Working Tree Status** | Clean (tracked files) | `git status -s` (0 tracked modifications) |
| **Preserved Untracked Work** | `.ignore`, `graft/` | Intact without discard or reset |

---

## 2. Tool & Specialist Capability Matrix

| Capability / Framework | Location / Provider | Status | Assigned Role / Purpose |
| :--- | :--- | :--- | :--- |
| **Superpowers Workflow** | `plugins/superpowers` | Active | `using-git-worktrees`, `test-driven-development`, `systematic-debugging`, `verification-before-completion` |
| **Agency Agents** | `.gemini/config/skills/agency-*` | Active | Specialist engineering coordination (Roles 1–8) |
| **Project Skills** | `.agents/skills/*` | Active | `minimalist-ui`, `aira-verification`, `agentic-tdd`, `taste-and-craft` |
| **Playwright MCP** | Local MCP Server | Registered | Responsive headless & browser QA verification |
| **Graft MCP** | Local MCP Server | Registered | AST & codebase structure investigation |
| **Reticle MCP** | Local MCP Server | Registered | Visual verification and browser interaction |
| **Vercel CLI** | v59.1.4 | Connected | Deployment inspection & Preview build validation |
| **Prisma ORM** | PostgreSQL instance | Connected | Persistent memory & conversation storage (7 users, 21 threads) |

---

## 3. Preserved Route & Architectural Contracts

The following 18 canonical routes are protected and will remain functionally invariant:

- Research: `/`
- Work: `/work`
- Knowledge: `/knowledge`
- Models: `/compare`
- Settings: `/settings`
- Builder: `/build`
- Agents: `/agents`
- Workflows: `/workflows`
- Browser: `/browser`
- Projects: `/projects`
- Memory: `/memory`
- Outputs: `/artifacts`
- Route: `/omniroute`
- Connections: `/settings#integrations`
- Command Center: `/control-center`
- Governance: `/governance`
- Plans & Billing: `/pricing`
- Global Search: `/workspace-search`

---

## 4. Known Baseline Failures & Active Feature Guards

1. **Fail-Closed Autonomous Execution Guards**: Work runtime, Browser worker, and Autonomous Swarms remain fail-closed without server-authoritative credentials.
2. **Paid Checkout**: Cashfree subscriptions remain in sandbox/test gating; no real funds or automatic production mutations.
3. **P0 Provider Routing**: NVIDIA is active primary free-tier provider (`meta/llama-3.2-11b-vision-instruct` / `meta/llama-3.3-70b-instruct`) with OmniRoute fallback.
4. **Targeted Seven Verified Defects**: Slated for immediate correction in Phase 1 (D1 through D7).
