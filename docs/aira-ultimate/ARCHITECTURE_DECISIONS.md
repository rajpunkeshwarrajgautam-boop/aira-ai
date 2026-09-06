# AIRA AI — Architecture Decision Records (ADRs)

## ADR-001: Universal Mission & Deliverable Contracts (Wave 1)
- **Status**: ACCEPTED
- **Context**: Autonomous operations require a unified schema across Chat, Work Mode, Build, Swarms, and Workflows.
- **Decision**: Define typed `MissionInput`, `Deliverable`, `AcceptanceCriteria`, and `DeliverableValidation` in `lib/contracts/mission.ts`.

## ADR-002: Reusable Connector Framework & Tool Gateway Boundary (Wave 5)
- **Status**: ACCEPTED
- **Context**: Direct untrusted third-party API calls risk prompt injection, credential exposure, and unaccounted mutations.
- **Decision**: All connector operations (read/write) MUST route through the authenticated Tool Gateway with risk levels (LOW, MEDIUM, HIGH) and persisted approvals.

## ADR-003: Deterministic Multi-Format Artifact Engine (Wave 3)
- **Status**: ACCEPTED
- **Context**: File outputs must not just return without throwing; they must be structured, parsable, previewable, and cryptographically verified.
- **Decision**: Create an artifact pipeline supporting Markdown, JSON, CSV, ZIP, DOCX, XLSX, and HTML with metadata, preview generators, and lineage hashing.

## ADR-004: Versioned AI Behavioral Canaries & Evaluation Corpus (Wave 11)
- **Status**: ACCEPTED
- **Context**: Model behavior can silently drift across prompt revisions, model updates, or provider failovers.
- **Decision**: Maintain a versioned test corpus of 20-50+ evaluated missions with scored rubrics for instruction retention, citation correctness, and security boundaries.
