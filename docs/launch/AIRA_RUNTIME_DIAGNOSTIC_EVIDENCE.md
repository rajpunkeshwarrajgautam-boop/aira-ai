# AIRA Runtime Diagnostic Evidence

Status: captured from authenticated Vercel Preview access before removal of the temporary runtime-status route.

## Source

- Preview deployment: `dpl_7H1hdNNqUJayseaHdrWzeBXwxFfg`
- Preview URL: `https://aira-ai-live-8vfzci9u9-rajpunkeshwarrajgautam-boops-projects.vercel.app`
- Endpoint: `/api/launch-readiness/runtime-status`
- Environment reported by endpoint: `preview`
- Git SHA reported by endpoint: `1e9aa55dfb553caa7d6757c412fe0275001fe771`
- Authenticated Vercel CLI request ID: `p5d6c-1788885319113-a2e493a3bcd1`

## Runtime Result

| Capability | Enabled | Configured | Healthy / Connected | Ready | Result |
|---|---:|---:|---:|---:|---|
| DEERFLOW | false | false | false | false | unavailable; must remain truthfully gated |
| AUTOGPT | false | false | false | false | unavailable; must remain truthfully gated |
| AGENT_SWARM | false | false | false | false | unavailable; Swarms must remain truthfully gated |
| Browser runtime | false | false | false | false | unavailable; Browser surfaces must gate cleanly |
| OmniRoute | false | false | false | n/a | disconnected; modelCount=0; surface must report actual disabled state |

## Certification Interpretation

The diagnostic proves that no autonomous execution runtime is currently certified ready. This is an acceptable launch-candidate state only when Work, Build, Swarms, and Browser capability paths fail closed with explicit unavailable/gated responses and do not fabricate execution or return unexplained 5xx errors.

OmniRoute is also disabled/unconfigured/disconnected in this Preview and therefore must not be represented as operational.

The temporary diagnostic endpoint is evidence-only and must be removed before establishing the final launch-candidate SHA.
