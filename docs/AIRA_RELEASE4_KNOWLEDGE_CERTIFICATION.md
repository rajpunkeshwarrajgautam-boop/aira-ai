# AIRA Release 4 — Phase 3 Final Reconciled Knowledge Certification

## Executive Summary

AIRA Knowledge has been fully verified as a real end-to-end user capability on the `feat/aira-release-4-runtime-activation` branch. The complete ingestion-to-grounding pipeline functions across storage, control plane, Python ingestion worker, document parsers, vector embeddings (`vector(768)`), similarity retrieval, and AIRA Search context grounding.

---

## 1. Lineage & Git Provenance

- **Repository**: `rajpunkeshwarrajgautam-boop/aira-ai`
- **Release 4 Starting Head**: `224eacec26310cfba813cc0a560aa6a13a7b586a`
- **Release 4 Branch**: `feat/aira-release-4-runtime-activation`
- **Phase 2 Status**: `AIRA_ROUTE_WORKING_E2E_IN_PREVIEW`
- **Old Phase 3 Product Candidate SHA**: `fb7210d18792f3521d358c9abcd8edd647ecbeac`
- **NEW Phase 3 Product Candidate SHA**: `7dfba3b3760d14891d647192089f00fe6fe0bc1c`
- **Certification Head SHA**: `7dfba3b3760d14891d647192089f00fe6fe0bc1c`
- **Product Candidate Preview Deployment**: `dpl_Buio6RstrtnDA6hHNCaiXJhDaP2P`
- **Preview Target**: `Preview`
- **Preview Status**: `READY`

---

## 2. Architecture & Subsystem Integration

### Pipeline Flow

```
USER FILE 
  → Multi-part Validation (20MB standard / 12MB media limit, MIME allowlist)
  → Per-User Rate Limiter (Max 10 active QUEUED/PROCESSING jobs, 429 Retry-After)
  → Private Storage (Bucket: aira-knowledge, Key: <userId>/<assetId>/<filename>)
  → DB Asset Creation (KnowledgeAsset status: QUEUED)
  → Job Enqueue (enqueueFoundationJob('knowledge.ingest', payload))
  → Foundation Control Plane (Redis Stream: aira:jobs:knowledge.ingest)
  → Python Worker (infra/foundation/knowledge-worker/worker.py)
  → Parsing (TXT, MD, CSV, JSON UTF-8; PDF via pypdf text extraction; DOCX via python-docx + zip preflight)
  → Structuring & Chunking (1,800 chars / 220 overlap, max 256 chunks)
  → Callback (/api/knowledge/callback with timingSafeEqual token verification)
  → Embedding (embedTextWithRoute via 768-dim model)
  → PGVector DB (KnowledgeChunk + KnowledgeChunkSemanticEmbedding)
  → Knowledge Asset READY
  → AIRA Search Query (getRelevantKnowledgeContext)
  → Grounded Context Assembly (<aira_untrusted_user_document>)
  → AIRA Grounded Answer + Private Source Attribution
```

---

## 3. Storage Layer

- **Provider**: Supabase Storage
- **Bucket**: `aira-knowledge` (Private, non-publicly enumerable)
- **Access Pattern**: Server-side service-role only; presigned download URLs with bounded 1-hour expiration.
- **Key Structure**: `${userId}/${assetId}/${filename}` (Prevents path traversal & cross-user overwrite).
- **Service-Role Boundary**: `SUPABASE_SERVICE_ROLE_KEY` is strictly server-only; verified non-exposure in client bundles or API responses.

---

## 4. Database & PGVector

- **Prisma Models**:
  - `KnowledgeAsset`: Tracks user ownership, file metadata, hash (SHA-256), and state (`QUEUED`, `PROCESSING`, `READY`, `FAILED`).
  - `KnowledgeChunk`: Stores chunk index, section metadata, content hash, and character offset ranges.
  - `KnowledgeChunkSemanticEmbedding`: Holds `vector(768)` embedding payload, model identifier, and tier provider metadata.
- **Vector Index Strategy**: `EXACT_ROUTE_FILTERED_VECTOR_SCAN` (Indexed on `userId`, `tier`, `provider`, `model` with exact user vector scan).
- **Tenant Isolation**: All queries explicitly filter by `userId`. Database operations strictly bind `userId` from validated auth session tokens.

---

## 5. Ingestion Worker & Job Queue

- **Platform**: Python 3.11 container runtime (`infra/foundation/knowledge-worker`)
- **Queue System**: Redis Stream `aira:jobs:knowledge.ingest` managed via Foundation Control Plane (`infra/foundation/control-plane`).
- **Callback Authentication**: HTTP Header `x-aira-worker-token` authenticated using `crypto.timingSafeEqual` (`validWorkerToken`).
- **Idempotency & Failover**: `replaceKnowledgeChunks` handles duplicate callback retries atomically. Failed jobs update asset status to `FAILED` with non-sensitive user error messages.

---

## 6. Document Parser Corpus Reality

| Document Type | Parser Engine | Extraction & Security Boundaries | Verification |
| :--- | :--- | :--- | :--- |
| **TXT** | UTF-8 Decode | Bounded character limit, clean whitespace normalization | `PASS` |
| **Markdown** | UTF-8 Decode | Bounded newline-aware chunker | `PASS` |
| **CSV** | UTF-8 Decode | Bounded newline-aware chunker | `PASS` |
| **JSON** | UTF-8 Decode | Bounded newline-aware chunker | `PASS` |
| **PDF** | `pypdf.PdfReader` | Text extraction only (up to 200 pages); embedded scripts are not executed by the ingestion path | `PASS` |
| **DOCX** | `python-docx` | Preflight `validate_docx_zip` (max 2000 entries, max 50MB uncompressed bytes, 100:1 ratio limit, path traversal detection) | `PASS` |

---

## 7. Embedding Tiers & Vector Retrieval

- **FREE Tier**: Self-hosted provider, model `nomic-embed-text-v1.5`, 768 dimensions (`search_query` / `search_document` task prefix formatting).
- **PRO / TEAM Tier**: OpenAI provider, model `text-embedding-3-small`, 768 dimensions.
- **Retrieval Threshold**: Top-k similarity search filtered by `userId`, asset `READY` state, and embedding tier.
- **Search Context Integration**: `getFollowUpContext` calls `getRelevantKnowledgeContext(userId, query, 6)` and injects relevant chunks into AIRA Search context.
- **Private Citation**: Documents are cited with filename and chunk index without exposing underlying private storage URLs.

---

## 8. Security & Red Team Verification

- **IDOR / Cross-User Isolation**: User B queries containing User A's secret document nonces yield 0 context (Zero cross-user disclosure).
- **Prompt Injection Boundary**: All document chunks are wrapped inside `<aira_untrusted_user_document source="...">` tag blocks. System prompt instructs model to treat document content strictly as data, overriding embedded "Ignore previous instructions" payloads.
- **DOCX / Zip Safety**: `validate_docx_zip` preflight enforces max 2,000 zip entries, max 50MB uncompressed bytes, 100:1 ratio limit, and path traversal detection.
- **Rate Limiting**: Server-authoritative per-user concurrency limit (Max 10 active `QUEUED`/`PROCESSING` jobs per user, HTTP 429 `TOO_MANY_REQUESTS` with `Retry-After: 60` header).

---

## 9. Test Classification & Evidence

- **TypeScript**: `npx tsc --noEmit` — 0 errors.
- **UNIT**: `PASS` (Formatters, MIME allowlists, worker token constant-time comparison, prompt wrapper tags).
- **INTEGRATION**: `PASS` (Storage service-role isolation, embedding tier route policy, callback validation schemas).
- **REAL_DB**: `PASS` (Prisma model schemas, tenant isolation, exact route index queries).
- **LIVE_PREVIEW_E2E**: `PASS` (Six-format live ingestion, worker claim, chunking, callback, vector store, and search grounding).

---

## 10. Status

**`AIRA_KNOWLEDGE_WORKING_E2E_IN_PREVIEW`**
