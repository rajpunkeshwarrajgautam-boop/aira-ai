# AIRA AI — Production Alerting Policy & Severity Framework

## 1. Severity Definitions
| Severity | Description | Target Response Time | Target Resolution | Escalation Path |
| :--- | :--- | :--- | :--- | :--- |
| **P0** | Complete outage, active security vulnerability, data loss, or database corruption. | < 5 minutes | Immediate | On-Call Lead, SRE Lead, Tech Lead |
| **P1** | Major production degradation (e.g. all AI answer providers failing, search latency > 10s, auth login broken). | < 15 minutes | < 2 hours | Primary On-Call, Backend Architect |
| **P2** | Localized degradation (e.g. single fallback provider down, rate-limit false-positives, isolated tool failure). | < 1 hour | < 1 business day | Engineering Team |
| **P3** | Low-impact operational warning (e.g. non-blocking background queue delay, single client malformed probe). | Next business day | Next sprint | Development Backlog |

---

## 2. Actionable Alert Matrix

### Alert 1: HTTP 5xx Outage Spike (P0)
- **Condition**: 5xx HTTP response rate > 2% of total traffic over a 3-minute evaluation window.
- **Source**: Vercel runtime telemetry / API Gateway.
- **Action**: Check `/api/health` and `/api/ready`. If database is unreachable, check Supabase pooler status. If an application bug was recently deployed, initiate instant rollback runbook.

### Alert 2: Database Connection Saturation or Failure (P0)
- **Condition**: `PostgreSQL pool client error` or connection timeout > 3 occurrences in 2 minutes.
- **Source**: Application structured logs (`category: "5xx.DATABASE"`).
- **Action**: Inspect Supavisor connection counts in Supabase dashboard. Verify `DATABASE_POOL_MAX` is within allocated limits.

### Alert 3: Upstream AI Provider Total Failure (P1)
- **Condition**: All configured providers (OmniRoute, NVIDIA, OpenAI) fail circuit health checks simultaneously.
- **Source**: Structured logs (`category: "5xx.PROVIDER"`).
- **Action**: Verify third-party API status dashboards (NVIDIA API, OpenAI status). Verify whether local OmniRoute proxy is healthy.

### Alert 4: Auth Callback / Token Exchange Failure Spike (P1)
- **Condition**: `/api/auth/callback/*` failure rate > 5% over 5 minutes.
- **Source**: Structured logs (`category: "4xx.AUTH"` or NextAuth errors).
- **Action**: Verify Google / GitHub OAuth client IDs, secrets, and callback URL domain settings in developer consoles.

### Alert 5: Search SSE Stream Abort Spike (P2)
- **Condition**: Premature stream terminations exceed 10% of queries over 10 minutes.
- **Source**: Structured logs (`category: "5xx.STREAM"`).
- **Action**: Check network latency and client disconnect metrics. Determine if client timeout is shorter than generation duration.

### Alert 6: Failed Production Migration (P0)
- **Condition**: GitHub Actions `.github/workflows/production-migration.yml` exits with code 1.
- **Source**: GitHub Actions webhook / CI alert.
- **Action**: Inspect preflight / postflight logs immediately. Follow `AIRA_PRODUCTION_MIGRATION_RECOVERY_RUNBOOK.md`.
