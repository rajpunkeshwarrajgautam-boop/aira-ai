# AiraAI project status

Production: https://aira-ai-live.vercel.app

Repository: https://github.com/rajpunkeshwarrajgautam-boop/aira-ai

Desktop 1.0 release: https://github.com/rajpunkeshwarrajgautam-boop/aira-ai/releases/tag/aira-desktop-v1.0.0

## Completed and verified

- Perplexity-style research UI, Exa retrieval, citations, presets, quotas, analytics, conversations, history, and public share pages are deployed.
- Google/GitHub Auth.js uses the canonical production origin. Guest access to `/agents` and `/admin/analytics` redirects to sign-in with the correct callback path.
- The Supabase production project is healthy. The `AgentRun` migration is applied, all 15 public application tables have RLS enabled, and the security advisor has zero findings.
- Controlled AutoGPT External API code, per-user ownership, idempotency, quotas, polling, and persistent run history are merged. The feature remains disabled until real restricted graph credentials pass an end-to-end execution.
- AIRA Desktop 1.0 is released for Windows with a validated NSIS installer, automatic-update manifest, policy tests, and a GitHub release workflow.
- Repository CI, the latest Vercel deployment, guest math/SSE answers, invalid-share 404 behavior, Auth.js session endpoint, and protected agent API behavior pass production checks.

## External blockers

1. **Answer provider credential:** Exa retrieval succeeds, but production answer generation is blocked. The OpenAI key has exhausted quota and the current NVIDIA key returns HTTP 403 for every configured catalog model. Replace the NVIDIA key or restore OpenAI quota, then rerun a genuine cited guest search.
2. **AutoGPT runtime credential:** Configure `AUTOGPT_API_BASE_URL`, a server-only key restricted to `EXECUTE_GRAPH` and `READ_GRAPH`, the graph ID/version, and the input node mapping. Run one complete Pro/Team execution before setting `AUTOGPT_AGENT_ENABLED=true` in Production.
3. **Cashfree:** Commercial activation is intentionally deferred by the project owner.

## AutoGPT activation order

1. Add the real `AUTOGPT_*` values to Vercel Preview while keeping `AUTOGPT_AGENT_ENABLED=false`.
2. Enable the Preview only, then verify submission, polling, completion, persistence, ownership isolation, idempotency, and quota accounting.
3. Copy the verified values to Production, enable the feature, deploy, and repeat one production execution.

AutoGPT's External API does not expose remote cancellation, so Aira intentionally does not present a misleading cancel control.
