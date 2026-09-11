# AIRA AI — Release 4 Knowledge Subsystem Architecture & Reconnaissance

## Subsystem Architecture Mapping

```mermaid
graph TD
    User([User Workspace]) --> UploadUI[Knowledge Upload Component /knowledge]
    UploadUI --> UploadAPI[POST /api/knowledge]
    UploadAPI --> Storage[Private Supabase Storage Bucket: aira-knowledge]
    UploadAPI --> AssetDB[PostgreSQL KnowledgeAsset: UPLOADING -> QUEUED]
    UploadAPI --> ControlPlane[Foundation Control Plane: /v1/jobs/enqueue]
    
    ControlPlane --> JobQueue[Redis Job Stream: aira:jobs:knowledge.ingest]
    JobQueue --> PythonWorker[Knowledge Worker: infra/foundation/knowledge-worker/worker.py]
    
    PythonWorker -->|1. Download Signed URL| Storage
    PythonWorker -->|2. Parse TXT / Markdown / CSV / JSON / PDF / DOCX| Parsers[Document Parsers]
    PythonWorker -->|3. Chunk Text| Chunker[Chunking Engine]
    PythonWorker -->|4. Callback| CallbackAPI[POST /api/knowledge/callback]
    
    CallbackAPI --> AuthToken[Worker Token Timing-Safe Verification]
    CallbackAPI --> ChunkDB[PostgreSQL KnowledgeChunk]
    CallbackAPI --> Embedder[Embedding Engine: embedTextWithRoute]
    Embedder --> VectorDB[PostgreSQL KnowledgeChunkSemanticEmbedding: vector(768)]
    CallbackAPI --> AssetReady[PostgreSQL KnowledgeAsset: READY]
    
    SearchQuery[AIRA Search Query] --> Router[getFollowUpContext / lib/conversation-memory.ts]
    Router --> Retrieval[getRelevantKnowledgeContext]
    Retrieval --> VectorSearch[PGVector Cosine Similarity Search]
    VectorSearch --> Grounding[Knowledge-Grounded Model Context & Citation Attribution]
```

---

## Subsystem Reconnaissance & Component Audit

| Component | Repository Path / Location | Implemented? | Configured? | Tested? | Preview-Ready? | Security Boundary | Failure Mode | Current Blocker / Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Upload API** | `app/api/knowledge/route.ts` | `YES` | `YES` | `YES` | `YES` | Auth session required, 20 MB size limit, MIME whitelist, filename sanitization | 401 Unauthenticated, 413 Size Limit, 415 Unsupported MIME, 503 Pipeline Unconfigured | Operational |
| **Library List API** | `app/api/knowledge/library/route.ts` | `YES` | `YES` | `YES` | `YES` | User-scoped database query (`userId = session.user.id`), `no-store` cache control | 401 Unauthenticated, 503 Multimodal Ingestion Disabled | Operational |
| **Callback API** | `app/api/knowledge/callback/route.ts` | `YES` | `YES` | `YES` | `YES` | Constant-time `x-aira-worker-token` header check via `timingSafeEqual` | 401 Invalid Token, 400 Invalid Payload, 500 Chunk Persistence Error | Operational |
| **Asset Persistence** | `lib/knowledge-assets.ts` | `YES` | `YES` | `YES` | `YES` | User-scoped queries, transaction-wrapped chunk replacement | Error logged, asset status updated to `FAILED` | Operational |
| **Object Storage** | `lib/foundation-storage.ts` | `YES` | `YES` | `YES` | `YES` | `SUPABASE_SERVICE_ROLE_KEY` server-only, user-scoped keys `<userId>/<assetId>/<filename>` | 503 Storage Unconfigured, HTTP 403 / 500 on fetch | Operational |
| **Control Plane Client** | `lib/foundation-control-plane.ts` | `YES` | `YES` | `YES` | `YES` | Token header `X-AIRA-Control-Token`, timeout-bounded HTTP request | Degrades gracefully or fails closed if required | Operational |
| **Control Plane Server** | `infra/foundation/control-plane/app.py` | `YES` | `YES` | `YES` | `YES` | Token HMAC auth, atomic Lua scripts for queue enqueue/claim/ack | HTTP 500, queue capacity limit | Operational |
| **Ingestion Worker** | `infra/foundation/knowledge-worker/worker.py` | `YES` | `YES` | `YES` | `YES` | Service-role worker token, bounded memory, max 256 chunks, text/PDF/DOCX parsers | Retry up to 3 attempts, callback status `failed` | Operational |
| **Semantic Embedding** | `lib/semantic-memory.ts` | `YES` | `YES` | `YES` | `YES` | Entitlement-based route resolution (`free` vs `pro`), circuit breaker for PRO OpenAI | Degrades to lexical memory on embedding failure | Operational |
| **Vector Storage** | `prisma/migrations/20260824_tiered_semantic_embeddings` | `YES` | `YES` | `YES` | `YES` | PGVector extension (`vector(768)`), HNSW cosine index, RLS `deny_direct_data_api_access` | Dimension mismatch error | Operational |
| **Knowledge Retrieval** | `lib/knowledge-assets.ts#getRelevantKnowledgeContext` | `YES` | `YES` | `YES` | `YES` | Multi-table join enforcing `userId` and `READY` status, cosine similarity >= 0.55 | Returns empty context array | Operational |
| **Search Integration** | `lib/conversation-memory.ts#getFollowUpContext` | `YES` | `YES` | `YES` | `YES` | Wraps context in `<aira_untrusted_user_document>` to enforce untrusted data boundary | Fails open to normal Search | Operational |

---

## Data Flow & Security Contracts

1. **Upload Phase**:
   - `POST /api/knowledge` receives `multipart/form-data`.
   - Validates user auth (`session.user.id`), `MULTIMODAL_INGESTION_ENABLED === "true"`, and pipeline environment variables (`AIRA_KNOWLEDGE_WORKER_TOKEN`, `AIRA_KNOWLEDGE_BUCKET`, `SUPABASE_SERVICE_ROLE_KEY`).
   - Computes SHA-256 hash of file bytes and sanitizes filename.
   - Saves `KnowledgeAsset` record with `status: "UPLOADING"`.
   - Uploads file bytes to private bucket `aira-knowledge` under key `${userId}/${assetId}/${filename}`.
   - Generates a 1-hour signed URL and updates asset status to `"QUEUED"`.
   - Enqueues job `knowledge.ingest` via Control Plane `/v1/jobs/enqueue`.

2. **Ingestion & Parsing Phase**:
   - Worker `worker.py` claims job from Control Plane `/v1/jobs/claim`.
   - Downloads file from signed URL (enforcing max size limit).
   - Parses text based on MIME type (`text/plain`, `text/markdown`, `text/csv`, `application/json`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`).
   - Segments text into contiguous chunks (target 1800 chars, overlap 220 chars, max 256 chunks).
   - Posts completion callback to `/api/knowledge/callback` with `X-AIRA-Worker-Token`.

3. **Embedding & Persistence Phase**:
   - `/api/knowledge/callback` verifies `x-aira-worker-token` using `timingSafeEqual`.
   - Updates asset status to `"PROCESSING"`.
   - Calls `replaceKnowledgeChunks` in `lib/knowledge-assets.ts`.
   - Resolves user embedding route (`resolveSemanticEmbeddingRouteForUser`).
   - Generates 768-dim vector embeddings for each chunk via `embedTextWithRoute`.
   - Transactionally replaces `KnowledgeChunk` and `KnowledgeChunkSemanticEmbedding` rows.
   - Updates asset status to `"READY"`.

4. **Retrieval & Search Grounding Phase**:
   - `getFollowUpContext` in `lib/conversation-memory.ts` calls `getRelevantKnowledgeContext(userId, query, 6)`.
   - Embeds search query with `embedTextWithRoute` (workload `"query"`).
   - Performs cosine vector distance search (`1 - (embedding <=> query_vector)`).
   - Filters strictly by `userId`, `READY` status, `tier`, `provider`, `model`, and similarity threshold (`>= 0.55`).
   - Formats chunks into `<aira_untrusted_user_document source="filename" chunk=N>...` and injects into prompt context as untrusted data.
