# AiraAI project status

Production: https://aira-ai-live.vercel.app

Repository: https://github.com/rajpunkeshwarrajgautam-boop/aira-ai

## Production capabilities

- Perplexity-style web research with grounded streaming answers and citations
- Standard and Deep Research modes, research presets, provider routing, and source ranking
- Google/GitHub authentication, persistent conversations, research history, and public share pages
- Guest and paid-plan quotas, Cashfree subscription flows, analytics, and CI quality gates
- Controlled AutoGPT graph execution with per-user run ownership, idempotency, quotas, persistent history, polling, and bounded stored outputs

## Deployment gates for the AutoGPT workspace

1. Restore the inactive Supabase project and apply `prisma/migrations/20260811_add_agent_runs/migration.sql`.
2. Configure the Vercel variables documented in `.env.example`, using an AutoGPT key restricted to `EXECUTE_GRAPH` and `READ_GRAPH`.
3. Set `AUTH_URL` and `NEXTAUTH_URL` to `https://aira-ai-live.vercel.app`; remove the old `perplexity-clone-saas.vercel.app` values.
4. Validate the feature-branch preview, then merge and promote the verified deployment.

## Current external limitation

AutoGPT's External API exposes graph execution and result polling but no remote cancellation endpoint. Aira therefore does not present a misleading cancel control.
