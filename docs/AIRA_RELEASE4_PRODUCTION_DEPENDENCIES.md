# AIRA Release 4 — Production Dependency Graph

**Authoritative Public Launch Infrastructure & External Service Dependencies**  
**Repository:** `rajpunkeshwarrajgautam-boop/aira-ai`  
**Phase:** Release 4 — Phase 6 (AIRA Work)  
**Security Notice:** NEVER store secret values in this ledger. Only document configuration keys, contracts, and capacities.

---

## 1. Dependency Topology & Readiness Matrix

| Service / Dependency | Preview Configuration | Production Target Configuration | Secret Names (Values Redacted) | Capacity Requirement | Failure Impact | Rollback Strategy | Cost Class |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Vercel Web Hosting** | Preview branch deployments (`apps/web`) | Production project (`https://aira-ai-live.vercel.app`) | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Multi-region Serverless / Edge | Site unavailable | Instant alias rollback via Vercel CLI | Low–Medium |
| **PostgreSQL Database** | Neon branch database (test/preview DB) | Neon production primary database (high availability) | `DATABASE_URL`, `DIRECT_URL` | 50+ pooled connections, pgvector enabled | Core platform offline | Point-in-time branch restore, backward-compatible migrations | Low |
| **Blob / Object Storage** | Neon bytea (`DurableBlob`) + local scratch | Supabase S3-compatible Storage or AWS S3 | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 100 GB+ durable object storage | Artifact downloads fail, fallback to bytea | Switch store adapter to internal database blob | Low |
| **LLM Provider Gateway (OmniRoute)** | NVIDIA NIM + OpenAI preview endpoints | Multi-provider router (NVIDIA NIM, OpenAI, Anthropic, Groq) | `NVIDIA_NIM_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OMNIROUTE_API_KEY` | 100+ requests/sec, 1M+ tokens/day | Model reasoning degrades to fallback tier | Automatic OmniRoute provider failover | Medium |
| **Embedding Provider** | NVIDIA NIM `nvidia/llama-3.2-nv-embedqa-1b-v2` | Primary hosted embedding endpoint | `NVIDIA_NIM_API_KEY`, `EMBEDDING_MODEL_ID` | 500 QPS batch embedding capacity | Knowledge indexing halted; cached search unaffected | Re-route to OpenAI text-embedding-3-small | Low |
| **Web Search Provider** | Exa AI / Tavily search API | Dedicated enterprise search subscription | `EXA_API_KEY`, `TAVILY_API_KEY` | 5,000 queries/day | Research agent lacks live web sources | Graceful degradation to direct URL fetch / knowledge | Low |
| **Agent Execution Runtime** | Native in-process (`AIRA_AGENT`) + local DeerFlow | Dedicated managed worker cluster or DeerFlow container | `AIRA_AGENT_RUNTIME_URL`, `AIRA_AGENT_RUNTIME_TOKEN`, `AIRA_RUNTIME_TOOL_GATEWAY_TOKEN` | 20+ concurrent agent tasks | Work tasks queued or rejected with 503 | Disable autonomous execution via killswitch | Medium |
| **Browser Worker Runtime** | Local Docker + Cloudflare Quick Tunnel (Preview) | 24/7 dedicated hosted Chromium container on VM/K8s | `AIRA_BROWSER_RUNTIME_URL`, `AIRA_BROWSER_RUNTIME_TOKEN` | 10+ concurrent browser tabs with sandbox isolation | Browser-assisted tasks fail gracefully with error | Degrade to static HTTP scraper / disable browser tool | Medium |
| **Background Queue / Workers** | Synchronous Next.js runtime + periodic cron | Redis Stream + containerized Python/Node workers | `REDIS_URL`, `REDIS_PASSWORD` | 1,000 tasks/min throughput | Asynchronous ingestion & routines delayed | In-process fallback execution for high priority | Low |
| **Authentication Providers** | Google OAuth & GitHub OAuth (Preview apps) | Google OAuth & GitHub OAuth (Production verified apps) | `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | 10,000 active sessions | Login unavailable; existing JWT sessions valid | Rotate client secrets; maintain active session table | Free |
| **Cashfree Billing (India Payments)** | Cashfree Sandbox environment | Cashfree Production merchant account | `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_WEBHOOK_SECRET` | Subscription webhooks and one-time orders | Payment upgrades paused; free tier operational | Maintain active entitlement records | Transaction % |
| **Observability & Logging** | Console JSON logging + Vercel deployment logs | Vercel Log Drains / Axiom / Datadog | `AXIOM_TOKEN` or `DATADOG_API_KEY` | Ingest all structured errors, audit logs, tool executions | Loss of real-time monitoring; execution unaffected | Local fallback to stdout JSON logging | Low |

---

## 2. Capacity & Ceiling Safeguards

1. **Server-Side Quota Ceilings**:
   - `FREE` tier: max 6 agents per run, 2 parallel, $5.00 cost limit, 250k tokens, 3 active runs max.
   - `PRO` tier: max 12 agents per run, 4 parallel, $25.00 cost limit, 1M tokens, 5 active runs max.
   - `TEAM` tier: max 24 agents per run, 6 parallel, $100.00 cost limit, 2M tokens, 10 active runs max.

2. **Emergency Kill Switches**:
   - `AIRA_WORK_RUNTIME_ENABLED=false`: Immediately disables all managed Work launches (returns 503 `WORK_RUNTIME_UNAVAILABLE`), preserves historical runs, artifacts, and read-only inspection.
   - `AIRA_BROWSER_RUNTIME_ENABLED=false`: Immediately disables all browser actions, degrades Work to non-browser research tasks.
   - `AIRA_TOOL_GATEWAY_ENABLED=false`: Immediately fences all external side-effect tool execution.
