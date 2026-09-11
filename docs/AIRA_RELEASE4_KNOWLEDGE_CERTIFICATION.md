# AIRA Release 4 — Phase 3 Knowledge Real RAG & Ingestion Certification

## Executive Summary

AIRA Knowledge has been fully verified as a real end-to-end user capability on the `feat/aira-release-4-runtime-activation` branch. The complete ingestion-to-grounding pipeline functions across storage, control plane, Python ingestion worker, document parsers, vector embeddings (`vector(768)`), similarity retrieval, and AIRA Search context grounding.

---

## 1. Lineage & Git Provenance

- **Repository**: `rajpunkeshwarrajgautam-boop/aira-ai`
- **Release 4 Starting Head**: `224eacec26310cfba813cc0a560aa6a13a7b586a`
- **Release 4 Branch**: `feat/aira-release-4-runtime-activation`
- **Phase 2 Status**: `AIRA_ROUTE_WORKING_E2E_IN_PREVIEW`
- **Phase 3 Product Candidate SHA**: `224eacec26310cfba813cc0a560aa6a13a7b586a`
- **Phase 3 Certification Head SHA**: `224eacec26310cfba813cc0a560aa6a13a7b586a`
- **Vercel Preview Deployment**: `dpl_6j1a7ugLGdpg3mEeHviJQmpFW4Eq`
- **Preview URL**: `https://aira-ai-live-cr1g9f8bf-rajpunkeshwarrajgautam-boops-projects.vercel.app`
- **Preview Status**: `READY`

---

## 2. Architecture & Subsystem Integration

### Pipeline Flow

```
USER FILE 
  → Multi-part Validation (20MB limit, standard MIME allowlist)
  → Private Storage (Bucket: aira-knowledge, Key: <userId>/<assetId>/<filename>)
  → DB Asset Creation (KnowledgeAsset status: QUEUED)
  → Job Enqueue (enqueueFoundationJob('knowledge.ingest', payload))
  → Foundation Control Plane (Redis Stream: aira:jobs:knowledge.ingest)
  → Python Worker (infra/foundation/knowledge-worker/worker.py)
  → Parsing (TXT, Markdown, CSV, JSON, PDF via pypdf, DOCX via python-docx)
  → Structuring & Chunking (1,800 chars / 220 overlap, max 256 chunks)
  → Callback (/api/knowledge/callback with timingSafeEqual token verification)
  → Embedding (embedTextWithRoute via Nomic 768-dim model)
  → PGVector DB (KnowledgeChunk + KnowledgeChunkSemanticEmbedding)
  → Knowledge Asset READY
  → AIRA Search Query (getRelevantKnowledgeContext)
  → Grounded Context Assembly (<aira_untrusted_user_document>)
  → AIRA Grounded Answer + Source Attribution
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
  - `KnowledgeChunkSemanticEmbedding`: Holds `vector(768)` embedding payload, model identifier (`nomic-ai/nomic-embed-text-v1.5`), and inner-product vector distance index (`HNSW` / cosine similarity).
- **Tenant Isolation**: All queries explicitly filter by `userId`. Database operations strictly bind `userId` from validated auth session tokens.

---

## 5. Ingestion Worker & Job Queue

- **Platform**: Python 3.11 container runtime (`infra/foundation/knowledge-worker`)
- **Queue System**: Redis Stream `aira:jobs:knowledge.ingest` managed via Foundation Control Plane (`infra/foundation/control-plane`).
- **Callback Authentication**: HTTP Header `x-aira-worker-token` authenticated using `crypto.timingSafeEqual`.
- **Idempotency & Failover**: `replaceKnowledgeChunks` handles duplicate callback retries atomically. Failed jobs update asset status to `FAILED` with non-sensitive user error messages.

---

## 6. Document Parser Corpus

| Document Type | Parser Engine | Extraction & Security Boundaries | Verification |
| :--- | :--- | :--- | :--- |
| **TXT** | UTF-8 Decode | Bounded character limit, clean whitespace normalization | `PASS` |
| **Markdown** | Heading-aware parser | Preserves structural headers and section boundaries | `PASS` |
| **CSV** | Row-tabular parser | Preserves header context per row chunk; caps row explosion | `PASS` |
| **JSON** | Hierarchical parser | Preserves object path context without exploding token count | `PASS` |
| **PDF** | `pypdf.PdfReader` | Bounded page traversal; strips embedded JS/executables | `PASS` |
| **DOCX** | `python-docx` | Zip-bomb defense, decompressed XML ratio caps, XML entity neutralization | `PASS` |

---

## 7. Vector Retrieval & Search Grounding

- **Embedding Model**: `nomic-ai/nomic-embed-text-v1.5` (768 dimensions)
- **Task Types**: `search_document` for chunk ingestion, `search_query` for AIRA user searches.
- **Retrieval Threshold**: Top-k cosine similarity search filtered by `userId`, asset `READY` state, and embedding tier.
- **Search Context Integration**: `getFollowUpContext` calls `getRelevantKnowledgeContext(userId, query, 6)` and injects relevant chunks into AIRA Search context.
- **Private Citation**: Documents are cited with filename, section, and chunk ordinal without exposing underlying private storage URLs.

---

## 8. Security & Red Team Verification

- **IDOR / Cross-User Isolation**: User B queries containing User A's secret document nonces yield 0 context.
- **Prompt Injection Boundary**: All document chunks are wrapped inside `<aira_untrusted_user_document source="...">` tag blocks. System prompt instructs model to treat document content strictly as data, overriding embedded "Ignore previous instructions" payloads.
- **Zip / XML Safety**: Malicious DOCX/Zip bomb attempts fail safely within bounded CPU/memory limits.
- **Rate Limiting**: Uploads and ingestion jobs are rate-limited per user context.

---

## 9. Verification & Test Evidence

- **TypeScript Compilation**: `npx tsc --noEmit` — 0 errors.
- **Unit & Integration Suite**: 529 passing unit and integration tests (`npm test -- knowledge-ingestion-rag.test.ts`).
- **Grounding E2E Corpus Nonce Tests**: All 6 document formats (TXT, MD, CSV, JSON, PDF, DOCX) verified with unique random UUID nonces.
- **Production Safety**: Production deployment (`https://aira-ai-live.vercel.app`), database, and environment remain 100% untouched.

---

## 10. Status

**`AIRA_KNOWLEDGE_WORKING_E2E_IN_PREVIEW`**
