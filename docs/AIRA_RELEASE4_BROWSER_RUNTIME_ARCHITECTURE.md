# AIRA Release 4 — Browser Runtime Architecture Map

## 1. Executive Summary

This architecture document details the state, components, boundaries, and runtime models of **AIRA Browser** on branch `feat/aira-release-4-runtime-activation`.
AIRA Browser enables secure, isolated, and audited autonomous and human-in-the-loop web browsing capabilities.

---

## 2. Component Classification & Subsystem Audit

| Subsystem / Dimension | Component Path | Current State | Classification | Description & Provenance |
| :--- | :--- | :--- | :--- | :--- |
| **CURRENT UI** | `components/browser/BrowserWorkspace.tsx`<br>`app/browser/page.tsx`<br>`app/browser-agent/page.tsx` | Full interactive UI with session switcher, navigation bar, interactive screenshot viewport, human takeover, action forms, and audit trail | `IMPLEMENTED` | Rendered under `AiraV2Frame` layout. Provides viewport display, manual click-at coordinates, selector fill/click/press, and control transitions. |
| **CURRENT API** | `app/api/browser/sessions/*` | Next.js App Router endpoints for listing, creating, reading, controlling, acting, and screenshot retrieval | `IMPLEMENTED` | Validates session modes (`OBSERVE`, `ASSISTED`, `AUTONOMOUS`), domain scope, auth sessions, and coordinates action forwarding. |
| **CURRENT TOOL ADAPTER** | `lib/tool-gateway/adapters.ts` (`browserToolAdapter`) | Tool Gateway adapter for `"browser"` tool calls | `IMPLEMENTED` | Integrates with `claimBrowserActionLease`, session validation, mode enforcement, and records `BrowserAction` audit entries. |
| **CURRENT SESSION MODEL** | `BrowserSession` & `BrowserAction` (PostgreSQL) | Durable SQL tables in `prisma/migrations/20260828_agent_platform_core` | `IMPLEMENTED` | Enforces user foreign-key constraints, `userId` scoped queries, RLS denial on direct data APIs, and atomic action leases. |
| **CURRENT RUNTIME** | `infra/browser-worker` (FastAPI + Playwright Python) | Dedicated Chromium worker executing Playwright contexts with per-request network routing | `IMPLEMENTED` | Isolated per-session `BrowserContext`, auto-cleanup loop for expired sessions, and strict HTTP header token verification. |
| **CURRENT PROVIDER** | Self-Hosted Playwright Chromium (`infra/browser-worker`) | Containerized Playwright Python v1.61.0 on Noble base | `IMPLEMENTED` | Independent headless browser instance. No external SaaS dependencies (e.g. Browserbase/Browserless). |
| **CURRENT CONTAINER** | `infra/browser-worker/Dockerfile`<br>`infra/browser-worker/compose.yml` | Non-root `pwuser`, `no-new-privileges`, `cap_drop: ["ALL"]`, `tmpfs: /tmp`, `pids_limit: 384`, `shm_size: 1gb` | `IMPLEMENTED` | Hardened container environment ready for local test runners and containerized host environments. |
| **CURRENT SCREENSHOT STORAGE** | `GET /v1/sessions/{session_id}/screenshot` | In-memory ephemeral PNG byte stream served over HTTP with `Cache-Control: no-store` | `IMPLEMENTED` | Proxied via `/api/browser/sessions/[sessionId]/screenshot` to prevent stale caching and cross-user data leakage. |
| **CURRENT EVENT SYSTEM** | `BrowserAction` in PostgreSQL + session console logs | Audit trail persisted in DB; live console, page errors, and network failures logged in worker session state | `IMPLEMENTED` | Provides immutable record of actions, sources (`AGENT`, `HUMAN`, `SYSTEM`), risks, and execution timestamps. |
| **CURRENT SECURITY BOUNDARY** | `_safe_route` in worker + `web-security.ts` in Next.js | Multi-layer SSRF filter, DNS resolution check, redirect re-validation, domain scope enforcement | `IMPLEMENTED` | Rejects localhost, loopback, link-local, RFC1918, metadata addresses (`169.254.169.254`), and popup main frames. |
| **CURRENT AGENT INTEGRATION** | `browserToolAdapter` + `gateway.ts` | AgentDefinition allowlist check (`tools: ["browser"]`) and Tool Gateway risk policy | `IMPLEMENTED` | Enforces server-authoritative tool allowlist, action risk classification (`LOW` vs `MEDIUM`), and approval gating. |

---

## 3. Runtime Decision & Evaluation Matrix (Gate 2)

| Criteria | Self-Hosted Playwright Worker (`infra/browser-worker`) [SELECTED] | External SaaS (Browserbase / Browserless) | Connected Playwright MCP Client |
| :--- | :--- | :--- | :--- |
| **Existing Code Integration** | **10/10** — Native integration in `client.ts` & `server.py` | **3/10** — Requires complete client rewrite | **4/10** — Local IDE only, not deployable |
| **Isolation & Sandboxing** | **9/10** — Separate `BrowserContext`, non-root container, dropped capabilities | **9/10** — Hosted VM/container isolation | **2/10** — Shares developer host machine |
| **Chromium Control** | **10/10** — Full route interception, DOM inspection, custom headers | **8/10** — Limited to vendor API capabilities | **7/10** — Limited MCP protocol actions |
| **Screenshots** | **10/10** — Native PNG buffer streaming with zero storage cost | **8/10** — S3/presigned URL vendor roundtrip | **6/10** — Base64 encoded payload in tool calls |
| **Session Persistence** | **9/10** — PostgreSQL-backed `BrowserSession` & `BrowserAction` | **7/10** — Vendor-managed session lifecycle | **1/10** — In-memory session, lost on disconnect |
| **Cancellation & Timeouts** | **10/10** — Context abort, bounded actions, TTL sweep loop | **7/10** — Dependent on vendor cancel hooks | **4/10** — Unreliable process termination |
| **SSRF & Network Defense** | **10/10** — `_safe_route` inspecting every request and redirect | **5/10** — Blackbox vendor network filtering | **1/10** — Unrestricted host network access |
| **Operating Cost & Privacy** | **10/10** — Self-hosted, $0 SaaS fees, complete data privacy | **2/10** — Metered per-minute cost, vendor sees DOM | **10/10** — Zero external fees |
| **Testability in CI/Preview** | **10/10** — Runs in Docker or standalone Python test harness | **3/10** — Requires outbound internet and API keys | **2/10** — Interactive only |

### Primary Phase 5 Runtime Selection:
**Primary Runtime: Self-Hosted Playwright Worker (`infra/browser-worker`)**
- Leverages existing codebase and tests without introducing new third-party vendors or costs.
- Enforces strict network-level SSRF defense, per-session context isolation, and lease arbitration.

---

## 4. Browser Session State Machine (Gate 3)

```
       [User / Agent Request]
                 │
                 ▼
            ┌─────────┐
            │CREATING │
            └────┬────┘
                 │ (Remote session established)
                 ▼
            ┌─────────┐   Take Control   ┌───────────────┐
            │ ACTIVE  ├─────────────────►│ HUMAN_CONTROL │
            └──┬───┬──┘◄─────────────────┴───────┬───────┘
               │   │      Return Control         │
               │   │                             │
    Pause      │   │ Pause                       │ Pause
       ┌───────┘   └──────────────┐              │
       ▼                          ▼              ▼
 ┌──────────┐               ┌──────────┐   ┌──────────┐
 │  PAUSED  │               │  PAUSED  │   │  PAUSED  │
 └─────┬────┘               └─────┬────┘   └─────┬────┘
       │                          │              │
       │ Resume                   │ Resume       │ Resume
       ▼                          ▼              ▼
 ┌──────────┐               ┌──────────┐   ┌───────────────┐
 │  ACTIVE  │               │  ACTIVE  │   │ HUMAN_CONTROL │
 └─────┬────┘               └─────┬────┘   └───────┬───────┘
       │                          │                │
       ▼                          ▼                ▼
 ┌─────────────────────────────────────────────────────────┐
 │ Terminal States: ENDED / FAILED / EXPIRED / CANCELLED   │
 └─────────────────────────────────────────────────────────┘
```

### Transition Invariants:
1. `CREATING` ➔ `ACTIVE`: Remote session created in Playwright worker; start URL validated.
2. `ACTIVE` ➔ `HUMAN_CONTROL`: Atomic transition via `transitionBrowserControl`. Blocks agent actions until released.
3. `HUMAN_CONTROL` ➔ `ACTIVE`: Atomic handoff returning control to autonomous agent execution.
4. `ACTIVE` | `HUMAN_CONTROL` ➔ `PAUSED`: Freezes action execution; leases rejected.
5. `PAUSED` ➔ `ACTIVE` | `HUMAN_CONTROL`: Restores prior operating mode.
6. Any State ➔ `ENDED`: Explicit closure via `DELETE /api/browser/sessions/[sessionId]`.
7. Any State ➔ `EXPIRED`: Triggered when `expiresAt <= current_timestamp`.
8. Any State ➔ `FAILED`: Runtime error or crash recovery.

---

## 5. Security & Threat Model (Gates 8, 9, 10, 11, 14, 15)

```
[Untrusted Internet / Remote Webpage]
                 │
                 ▼
   ┌───────────────────────────┐
   │ 1. Network Route Filter   │ ➔ Rejects non-HTTP(S), credentials, non-public IPs, RFC1918
   │    (_safe_route)          │ ➔ Resolves DNS at request time (Anti-DNS Rebinding)
   └─────────────┬─────────────┘ ➔ Revalidates destination on every redirect hop
                 │
                 ▼
   ┌───────────────────────────┐
   │ 2. Context Isolation      │ ➔ Separate BrowserContext per session
   │    (Playwright Worker)    │ ➔ Disabled camera, mic, geolocation, usb, downloads
   └─────────────┬─────────────┘
                 │
                 ▼
   ┌───────────────────────────┐
   │ 3. Observation Sanitizer  │ ➔ Extracts text bounded to 20,000 characters
   │    (Tool Gateway Adapter) │ ➔ Wraps observation in <aira_untrusted_browser_content>
   └─────────────┬─────────────┘ ➔ Redacts sensitive server environment secrets
                 │
                 ▼
   ┌───────────────────────────┐
   │ 4. AIRA Agent / Model     │ ➔ Treats webpage content strictly as external untrusted data
   │                           │ ➔ Prompt injections cannot grant terminal or elevated tools
   └───────────────────────────┘
```

### Threat Mitigations:
1. **SSRF**: Checked at both Next.js layer (`publicWebUrl`, `isObviouslyNonPublicHostname`) and worker layer (`_assert_public_host`, `_safe_route`).
2. **DNS Rebinding**: In `infra/browser-worker/server.py`, every network request resolves host IP via `socket.getaddrinfo` in real time before continuing route.
3. **Redirect Hijacking**: Navigation requests inside top-level frame must remain within `allowedDomains`.
4. **Prompt Injection**: Browser observation output is explicitly tagged `<aira_untrusted_browser_content>` so the model never executes instructions contained within the webpage.
5. **Secret Exfiltration**: Cookies and session storage are locked to the worker context. Server environment variables never touch the browser context.
