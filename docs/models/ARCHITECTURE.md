# AIRA Native Model Architecture

## Verified application boundary

The current OmniRoute branch is a Next.js 16 / React 19 web application with Auth.js, Prisma and PostgreSQL. Production PostgreSQL is Supabase-hosted. Grounded search uses Exa. Provider selection keeps NVIDIA as the product-level Free provider/fallback and uses OmniRoute as the default Pro gateway when configured.

The native-model program does not replace any of those systems.

## Model factory boundary

```text
provenance-reviewed data
        |
        v
      Soup 0.73.3 (pinned commit)
 data -> train -> eval -> ship gate -> merge/export
        |
        v
 versioned AIRA model artifact
        |
        +--> local: GGUF / llama.cpp / Ollama where supported
        |
        +--> hosted persistent inference server
                  |
                  v
          OmniRoute model discovery
                  |
                  v
       AIRA ProviderRouter / Compare
```

Soup is an offline/model-operations dependency. It must not be imported into Next.js route handlers or bundled into Vercel functions.

## Availability truth

The code registry defines the intended IDs `aira/edge`, `aira/core`, `aira/pro`, `aira/ultra`, and `aira/apex`, but every entry starts as `experiment` + `NOT_TESTED`.

A model is exposeable only if the configured OmniRoute gateway returns the exact ID during live model discovery. Registry membership is never treated as proof that weights exist, a server is healthy, or a benchmark passed.

## Data boundary

Production chats, email, files, memories, database rows, API keys and customer data are excluded from training by default. A dataset may become trainable only after its manifest records provenance, license/permission, contamination status and an explicit `training_allowed=true` decision.

## Promotion boundary

A checkpoint moves through:

`experiment -> candidate -> release-candidate -> production -> retired`

Capability evidence moves independently through:

`NOT_TESTED -> BASELINE -> IMPROVED -> CLASS_LEADING -> FRONTIER_COMPETITIVE -> FRONTIER_LEADING`

The release state and evidence state must never be inferred from one another.
