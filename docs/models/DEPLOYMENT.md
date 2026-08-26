# AIRA Native Model Deployment

## Principle

Vercel hosts AIRA's web/control surface. Large-model inference and Soup training require a separate persistent runtime. Soup is never imported into normal Next.js request execution.

## Development path

For a passing Core candidate:

1. Load base + adapter directly for deterministic verification.
2. Merge only after adapter verification.
3. Export one or more deployment artifacts (for example GGUF for llama.cpp/Ollama where architecture support is verified).
4. Run local or isolated hosted inference.
5. Expose an OpenAI-compatible endpoint through the selected persistent inference server.
6. Register/discover that model through OmniRoute.
7. Let AIRA use it only when OmniRoute live discovery returns the exact `aira/*` ID.

## Serving choices

Evaluate, do not assume, the serving engine for each tier:

- llama.cpp server for quantized/local deployment;
- vLLM for compatible high-throughput hosted models;
- SGLang where model/tool/structured-generation support is stronger;
- Soup's OpenAI-compatible server for development/testing or production only when measured operationally suitable.

Measure TTFT, tokens/s, p50/p95 latency, memory, concurrency, structured generation, tool-call behavior and cost.

## Model IDs

Reserved AIRA-native discovery IDs:

- `aira/edge`
- `aira/core`
- `aira/pro`
- `aira/ultra`
- `aira/apex`

They are registry contracts, not assertions of deployment. AIRA's UI/API must not surface them as available unless OmniRoute actually discovers them.

## Routing

The current application keeps NVIDIA as Free-tier provider/fallback and OmniRoute as the Pro gateway. AIRA-native models join the OmniRoute model set; they do not replace the provider abstraction.

Routing aliases such as `auto`, `auto/smart`, `auto/coding`, `auto/fast`, `auto/cheap`, and `auto/offline` should choose an AIRA-native model only after real benchmark/cost/availability evidence supports the policy.

## Local RX 9070 XT

Local training and local inference are separate compatibility questions. The RX 9070 XT path remains `PARTIALLY_VERIFIED` for Soup training until the pinned smoke run succeeds. GGUF/llama.cpp deployment should be evaluated independently after a candidate artifact exists.

## Promotion gate

A model is not production-deployed until:

- artifact provenance and hashes exist;
- inference starts cleanly after restart;
- health/model discovery passes;
- streaming works;
- the identity reported to AIRA matches the actual loaded model;
- timeout/error behavior is bounded;
- regression evaluation passes;
- OmniRoute discovers the exact model ID;
- one model failure does not break unrelated providers/comparison targets;
- no credential is present in client bundles, committed config or model artifacts.
