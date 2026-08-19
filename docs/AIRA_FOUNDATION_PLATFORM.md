# AIRA Foundation Platform

## Purpose

This document combines AIRA's semantic memory, multimodal ingestion, distributed control plane, sandbox execution, self-hosted inference, AutoGPT, offline model training, and GPU-fabric work into one dependency-ordered architecture. It distinguishes **code present** from **infrastructure deployed** and **production activated**.

## Three-plane architecture

### 1. Application plane

The existing AIRA web/search stack remains the survivable product boundary. Authentication, quotas, grounded retrieval, conversation persistence, lexical durable memory, provider fallback, verifier safety, and SSE streaming continue to operate when every new foundation flag is disabled.

### 2. Control and agent plane

The foundation control plane uses a Redis-compatible distributed data store for:
- admission leases and load shedding,
- global provider health/circuit state,
- bounded job streams for ingestion/worker tasks.

A production deployment may use a Redis Cluster/managed HA endpoint; the repository compose file is the local/single-host baseline. The web client supports degraded local operation unless `FOUNDATION_CONTROL_PLANE_REQUIRED=true`.

The Python sandbox is a separate non-root container with no application secrets and an internal Docker network. It has wall-clock, memory, CPU, process, file-descriptor, file-size, output, and code-size limits. It is registered as an agent tool only when explicitly enabled.

AutoGPT remains a distinct execution service. Production configuration now requires two distinct HTTPS runner targets. A preflight supports both `healthy-both` and a real `primary-down-secondary-up` failover drill. No environment flag should be enabled until both observations pass.

### 3. Foundation/model plane

Self-hosted inference is an optional OpenAI-compatible provider and an opt-in GPU Compose profile. It is not a default dependency of AIRA.

Offline model post-training is operator-only. The repository defines data contracts and immutable run manifests for SFT, reward modeling, DPO, PPO, and mandatory evaluation. Training uses an operator-approved image and cannot be initiated through the public AIRA API.

GPU fabric promotion requires observed hardware/topology/RDMA/NCCL checks. Repository files describe and validate the gate; they do not imply that NVLink, InfiniBand, RoCE, or a multi-node GPU cluster has actually been provisioned.

## Semantic memory and uploaded knowledge

The database migration is additive:
- current `UserMemory` remains canonical,
- `UserMemoryEmbedding` stores a separately versioned 1536-dimensional embedding plus model/content hash,
- `KnowledgeAsset` tracks private uploaded objects,
- `KnowledgeChunk` stores extracted chunks and optional embeddings,
- HNSW cosine indexes support semantic recall.

If embeddings fail or semantic memory is disabled, lexical memory still works. Uploaded documents are inserted into context as explicitly untrusted data, so instructions inside a PDF/image/document cannot become system instructions simply by being retrieved.

## Multimodal ingestion

The authenticated API accepts a bounded allowlist of text, PDF, DOCX, and image formats. Objects are uploaded to private storage and passed to a worker through a short-lived signed URL. The worker has no database credentials. It extracts/chunks text and calls a token-authenticated callback; images require a separately configured vision-capable model endpoint.

## Queue and load shedding

Admission is applied before expensive search/deep-research work and agent submission. Capacity exhaustion returns a retryable 503 rather than allowing uncontrolled request buildup. Leases are released when streams complete/abort. Ingestion jobs use bounded Redis streams and consumer groups.

## Provider health

The existing per-process circuit remains the immediate guard. Provider outcomes are additionally mirrored into the distributed control plane, and warm application instances refresh a short-lived cached global circuit. This avoids a mandatory network round trip per token while allowing failures observed by one instance to influence others.

## Activation matrix

| Capability | Code | External infrastructure required | Default |
|---|---|---|---|
| pgvector schema | present | Supabase migration | not applied until validation |
| semantic memory | present | vector schema + embedding endpoint | OFF |
| multimodal ingestion | present | private bucket + control plane + worker + callback + embeddings; vision endpoint for images | OFF |
| control plane | present | Redis-compatible HA endpoint/services | OFF |
| Python sandbox | present | isolated sandbox service | OFF |
| self-hosted inference | present | GPU host + approved inference image/model | not selected |
| AutoGPT | existing + hardened | two healthy runner hosts; failover drill | OFF |
| SFT/DPO/reward/PPO | pipeline contract present | approved data, model license, training image, GPU capacity | operator-only |
| GPU fabric | validator/inventory present | real accelerators + RDMA/NCCL-capable network for multi-node | not provisioned by repo |

## Non-overlap rule

Frontend redesigns, database activation, foundation-service deployment, AutoGPT activation, model promotion, and physical GPU/network provisioning remain independently reversible changes even though they are parts of one architecture. In particular, the foundation branch does not modify PR #63's frontend files.

## Production sequence

1. CI validates application + foundation service syntax/builds.
2. Apply additive vector migration and verify extension/tables/indexes/RLS.
3. Deploy Redis/control-plane and verify degraded/required modes.
4. Deploy sandbox and test isolation/resource limits.
5. Create private knowledge bucket, deploy ingestion worker, test text/PDF/DOCX, then image path.
6. Enable semantic memory for a canary user set and compare hybrid recall against lexical fallback.
7. Provision GPU inference host, run fabric validator, load-test, then canary `self-hosted` as fallback before primary.
8. Run AutoGPT `healthy-both` preflight, intentionally take primary down, run `primary-down-secondary-up`, restore primary, then and only then enable production agent runs.
9. Build authorized/provenance-reviewed training datasets, run SFT/preference stages offline, mandatory eval, and only promote an artifact that beats the existing production baseline without safety regression.
10. For multi-node GPU expansion, require peer RDMA tests and NCCL collectives before distributed inference/training.
