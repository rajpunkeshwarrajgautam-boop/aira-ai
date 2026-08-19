# AIRA Sovereign Cognition Extension

## Status language

This extension deliberately separates **code present**, **schema present**, **service deployed**, **hardware observed**, and **production activated**. Repository files are never evidence that a physical accelerator, RF mesh, post-quantum transport, gVisor runtime, distributed KV fabric, or cryptographic proof system is actually running.

## Added software controls

- Graph-relational long-term memory beside existing lexical + pgvector memory.
- Optional offline consolidation candidates; no automatic fact promotion without provenance/confidence gates.
- Optional pre-inference and post-inference safety gateway with observe/enforce modes and configurable fail-closed behavior.
- Deterministic adaptive-compute classification and reasoning-depth instructions without exposing private chain-of-thought. Token-ceiling fields are defined for a later canary but are not yet wired to provider limits.
- Provider placement policy for declared inference regions. Enforced mode fails closed when a provider has no declared allowed region.
- GPU health agent for temperature, memory pressure and uncorrected ECC telemetry; unhealthy nodes can open the distributed provider circuit.
- Autonomous-task capability policy separating read/sandbox actions from actions requiring explicit human approval (write/deploy/send/purchase/delete/credential use).
- Synthetic-data provenance validator requiring generator revision, prompt-set hash, verifier and reviewed license before a generated dataset can enter training.
- PQC readiness probe that reports ML-KEM/Kyber support only when the installed cryptographic runtime actually exposes it.
- Optional gVisor `runsc` Compose override for the isolated Python executor; activation requires real-host runtime validation.

## Graph memory

`MemoryEntity`, `MemoryRelation`, and `MemoryConsolidation` are additive tables. Current `UserMemory` remains canonical. Graph recall is a bounded supplement to lexical/vector recall. Graph mutation accepts already-curated extraction only and records a source memory id; it does not silently promote arbitrary model guesses into durable facts.

## Safety pipeline

The safety gateway is server-only and disabled by default. In observe mode it can collect only decisions/metrics at the caller boundary; application code must not log the raw prompt. In enforce mode an explicit `block` decision prevents search/agent submission. `AIRA_SAFETY_GATEWAY_REQUIRED=true` changes gateway outage behavior from fail-open to fail-closed. Post-inference inspection intentionally buffers publication when enabled; this is a latency trade-off and must be canaried before broad rollout.

## Adaptive compute

A deterministic complexity scorer assigns default/balanced/deep tiers using query size, task markers, code markers and the existing response mode. It never stores or publishes private reasoning traces. The tier currently changes the model-facing reasoning-depth instruction only. The scorer also emits answer/verifier token-ceiling fields for a later controlled canary; current provider token ceilings do not change until those fields are explicitly wired and tested.

## Multimodal expansion

Image/document ingestion remains the verified baseline. Audio/video ingestion is an optional contract only after a bounded media endpoint is configured and a canary proves size limits, transcription/description quality, prompt-injection treatment and cost controls. Spatial telemetry should enter as typed JSON data until a native multimodal model is actually deployed; the repository does not claim unified omni-token processing.

## Long context / KV cache

The self-hosted inference plane may use paged KV-cache implementations and larger model context windows when the selected engine supports them. Claims such as tens of millions of active tokens, decentralized KV cache, Mamba/state-space hybrid execution, or microsecond remote-KV access require benchmark evidence on the actual model/engine/fabric. They are research targets, not feature flags.

## Autonomous execution

AutoGPT remains behind the existing dual-host failover gate. A capability policy is an additional gate, not a replacement for sandboxing. gVisor may be used on supported hosts. Actions that publish, deploy, purchase, delete, send, modify repositories, or use credentials require explicit authorization and must not be inferred from a broad goal.

## Sovereign placement

Provider-region enforcement covers inference placement only. Full data sovereignty additionally requires verified database, object-storage, logging, backup, queue, embedding, monitoring and key-management placement. Air-gapped RF/Wi-Fi swarm operation and zero-knowledge geofencing are architecture research items until dedicated edge hardware and protocol implementations are observed.

## Hardware/research-only gates

The following are **not production capabilities** merely because they appear in the master architecture: photonic matrix accelerators, neuromorphic SNN arrays, RF mesh failover, multi-node remote KV memory, ML-KEM on every internal link, and per-token zk-SNARK proofs. Each requires a dedicated prototype, threat model, benchmark, cryptographic review and observed deployment before status can move beyond research.

## Activation order

1. Apply and verify additive graph schema; keep `GRAPH_MEMORY_ENABLED=false` initially.
2. Populate graph only from reviewed durable memories; compare recall quality against lexical+vector baseline.
3. Deploy safety gateway in observe mode, measure false positives/negatives, then canary enforce mode.
4. Enable adaptive reasoning instructions for a small cohort and measure latency/cost/quality before wiring any token-ceiling changes.
5. Deploy GPU health agent on the real inference host and prove circuit removal/recovery with injected unhealthy fixtures plus real telemetry.
6. Enforce provider-region placement only after every active/fallback provider has declared, verified regions.
7. Add gVisor on the real sandbox host and rerun isolation/resource tests under `runsc`.
8. Expand audio/video only after a real media model endpoint passes bounded-ingestion tests.
9. Synthetic data may enter training only with provenance + verifier + license + eval gates.
10. PQC/verifiable-inference status remains `BLOCKED` until the real transport/attestation stack demonstrates the required algorithms and proof verification.
