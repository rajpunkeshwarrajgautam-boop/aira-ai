# Virexa Local AI Engine

## Purpose

Virexa Local AI Engine makes a small local llama.cpp model a first-class private worker inside AIRA without pretending it is a frontier model.

The initial target is `MiniCPM5-1B-Claude-Opus-Fable5-V2-Thinking` in GGUF format. The engine is model-agnostic as long as the runtime exposes llama.cpp's OpenAI-compatible API.

The local worker owns low-cost, constrained work:

- classification and triage
- structured extraction
- short summarization and rewriting
- lead qualification
- email triage
- private AIRA memory / knowledge retrieval
- simple coding and formatting
- tool selection and bounded tool loops

AIRA routes work that needs current web information, citations, high-stakes reasoning, complex architecture, large coding changes, or long context to the existing stronger provider router.

## Architecture

```text
AIRA authenticated user
        |
        v
/api/local-ai/*
        |
        +--> deterministic task router
        |       |
        |       +--> routine/private --> llama.cpp / MiniCPM
        |       |
        |       +--> complex/fresh ----> existing ProviderRouter
        |
        +--> user-scoped AIRA memory
        +--> user-scoped uploaded knowledge
        +--> bounded function/tool loop
```

The local model does not receive database credentials or direct database access. AIRA executes approved tools server-side using the authenticated user's ID and returns only the tool result to the model.

## Implemented product surfaces

### `/local-ai`

A connected AIRA workspace containing:

- live llama.cpp runtime status
- private local workspace chat
- AIRA memory/knowledge context
- model-generated tool calls with server-side execution
- lead qualification worker
- email triage worker
- routing/fallback metadata

### Existing surfaces extended

- **Model Compare** now exposes the local engine as `Virexa Local` when configured.
- **Integrations** reports the Virexa Local AI configuration without exposing endpoint URLs or credentials.
- Existing Knowledge and Memory stores are reused rather than duplicated.

## API endpoints

All AIRA endpoints require an authenticated AIRA session.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/local-ai/status` | GET | configuration, health, model discovery, capabilities |
| `/api/local-ai/route` | POST | explain local-vs-cloud routing decision |
| `/api/local-ai/chat` | POST | local/hybrid chat with private context and tools |
| `/api/local-ai/business/lead` | POST | structured lead qualification |
| `/api/local-ai/business/email` | POST | structured inbox triage |

## Windows / pendrive setup

The GGUF may remain on the pendrive. Inference runs on the computer's CPU/GPU; the pendrive is model storage.

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\local-ai\start-virexa-local-ai.ps1 `
  -ModelPath "E:\models\MiniCPM5-1B-Claude-Opus-Fable5-V2-Thinking-F16.gguf" `
  -LlamaServerPath "C:\llama.cpp\llama-server.exe"
```

The launcher defaults to:

- loopback only: `127.0.0.1`
- port `8080`
- context `8192`
- GPU layers `99`
- stable API model alias `minicpm5-fable-v2`
- Jinja chat templates enabled
- llama.cpp Web UI disabled
- no llama.cpp built-in host tools

The launcher deliberately does **not** enable llama.cpp's built-in shell/file tools. Virexa tools execute through AIRA's authenticated, user-scoped application boundary instead.

## Smoke test

With llama-server running:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\local-ai\test-virexa-local-ai.ps1
```

This proves:

1. `/v1/health` is ready.
2. `/v1/models` returns a model.
3. `/v1/chat/completions` returns normal chat output.
4. The model/template can emit a parsed OpenAI-style function call.

To treat missing parsed function calls as a hard failure:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\local-ai\test-virexa-local-ai.ps1 -RequireToolCalling
```

Normal local chat remains usable if step 4 warns, but AIRA tool loops should not be relied on until the tool-call smoke test passes.

## AIRA configuration

For AIRA running on the **same Windows PC** as llama.cpp:

```dotenv
VIREXA_LOCAL_AI_ENABLED=true
SELF_HOSTED_LLM_BASE_URL=http://127.0.0.1:8080/v1
SELF_HOSTED_LLM_API_KEY=
SELF_HOSTED_LLM_MODEL=minicpm5-fable-v2
VIREXA_LOCAL_AI_TIMEOUT_MS=45000
VIREXA_LOCAL_AI_MAX_TOKENS=1600
AIRA_LOCAL_FIRST_ENABLED=false
AIRA_LOCAL_AI_REQUIRED=false
```

`SELF_HOSTED_LLM_API_KEY` may be blank when llama-server has no `--api-key`. If an API key is enabled on llama-server, put the same server-only key in AIRA.

### Routing modes

`AIRA_LOCAL_FIRST_ENABLED=false` is the recommended starting mode. It does not mean local AI is disabled. It means the deterministic router sends only clearly suitable routine work to the 1B model.

`AIRA_LOCAL_FIRST_ENABLED=true` gives borderline tasks a bias toward local execution. Hard cloud signals still override that preference.

`AIRA_LOCAL_AI_REQUIRED=true` disables cloud fallback for local-eligible tasks. Use it only when data must remain local and failed local execution should fail closed.

## Vercel topology

A Vercel deployment cannot connect to `127.0.0.1` on a user's Windows PC. There are two supported topology classes:

### Same-machine AIRA

Run the AIRA web/desktop process and llama-server on the same PC. Keep llama-server bound to `127.0.0.1`.

This is the simplest and most private option.

### Remote AIRA + private inference bridge

Expose the local inference service through an authenticated HTTPS ingress that the deployed AIRA server can reach. Keep the bridge server-only and protect it with a strong bearer key, TLS, allowlisting/rate limits where available, and no public Web UI.

Do not change llama-server to `0.0.0.0` and port-forward it directly to the public Internet.

## Business workers

### Lead qualification

Input:

```json
{
  "name": "Prospect name",
  "company": "Company",
  "role": "Role",
  "source": "CRM/import",
  "notes": "Observed prospect information"
}
```

Validated output fields:

- industry
- buyer/partner/vendor/investor/unknown intent
- 0-100 lead score
- low/medium/high priority
- recommended Virexa service
- next action
- rationale

The worker is instructed not to invent company size, budget, contacts, revenue, or intent.

### Email triage

Input contains sender, subject and body. Output is validated into:

- category
- priority
- whether a reply is required
- summary
- requested action
- suggested next step
- explicitly present entities

The endpoint classifies mail; it does not send or modify Gmail.

## Private knowledge and RAG

The local chat endpoint reuses AIRA's existing stores:

- lexical/semantic persistent memory
- uploaded KnowledgeAsset / KnowledgeChunk retrieval

Knowledge retrieval remains user-scoped. Retrieved documents are labeled as untrusted data in the local model's system context so content inside a document cannot redefine the model's application-level instructions.

When semantic memory / multimodal ingestion is disabled, uploaded vector knowledge retrieval returns no vector context and AIRA continues with the available memory path rather than fabricating knowledge.

## Tool calling

The initial approved tool set is intentionally small:

- `search_virexa_workspace` — user-scoped AIRA memory + knowledge retrieval
- `score_lead_baseline` — deterministic weighted lead-score helper

The model never gets arbitrary SQL, filesystem, shell, or credential tools through this engine.

Additional business tools should follow the same pattern:

1. declare a narrow JSON schema;
2. validate arguments server-side;
3. enforce authenticated ownership/authorization;
4. execute deterministic application code;
5. return bounded data;
6. cap tool rounds;
7. log operational metadata without logging secrets.

## Model routing policy

Examples routed local:

- "Classify these CRM notes and return JSON."
- "Summarize this internal email."
- "Extract company, role and requested service."
- "Rewrite this support response."
- "Search my AIRA memory for our prior pricing decision."

Examples routed cloud:

- "Research today's AI regulation and cite sources."
- "Do a production security architecture review."
- "Refactor this large multi-file codebase."
- "Give current market/news information."
- high-stakes legal/medical/financial reasoning

This policy is deliberately deterministic. The 1B model is not allowed to decide by itself that a difficult task is easy enough for the 1B model.

## Operational security

- Local AI is disabled by default in `.env.example`.
- New endpoints require an authenticated AIRA session.
- Input/output pass through the existing AIRA safety gateway boundary when enabled.
- User knowledge/memory lookups are scoped by `userId`.
- Secrets remain server-only.
- Remote self-hosted URLs require HTTPS in production, except loopback-only addresses.
- Endpoint URLs containing credentials, query strings or fragments are rejected.
- Local failure can fall back before publication; mandatory-local mode fails closed.
- llama.cpp built-in agent/shell tools are not enabled by the launcher.

## Recommended quantization

The engine accepts the current F16 model. For everyday Virexa worker use, benchmark the model author's Q8_0 build as well; it is much smaller and is the repository's recommended default. Keep whichever build wins your own structured-worker/tool-call tests.

## Acceptance gate

Do not claim the local runtime is active until all of the following are true on the target machine:

- launcher starts the exact GGUF successfully;
- smoke-test health passes;
- model discovery passes;
- normal chat passes;
- tool-call test passes if tool features will be enabled;
- AIRA `/api/local-ai/status` reports reachable;
- authenticated `/local-ai` chat succeeds;
- lead and email workers produce schema-valid results;
- a local failure is observed to fall back correctly, or fail closed when mandatory-local mode is configured;
- no local endpoint is unintentionally exposed to the public Internet.
