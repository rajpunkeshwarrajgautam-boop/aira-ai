import { prisma } from "@/lib/prisma";

export type KnowledgeSourceKind =
  | "KNOWLEDGE_ASSET"
  | "PERSISTENT_MEMORY"
  | "GOOGLE_DRIVE"
  | "SLACK"
  | "GMAIL"
  | "NOTION";

export interface FederatedSearchMatch {
  readonly id: string;
  readonly source: KnowledgeSourceKind;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly freshness: string;
  readonly acl: { readonly ownerUserId: string; readonly projectId?: string; readonly isPublic: boolean };
  readonly provenanceUri: string;
  readonly trustLevel: "TRUSTED_FIRST_PARTY" | "AUTHORIZED_CONNECTOR" | "EXTERNAL_UNVERIFIED";
}

export interface FederatedSearchRequest {
  readonly userId: string;
  readonly projectId?: string;
  readonly query: string;
  readonly sources?: readonly KnowledgeSourceKind[];
  readonly minScore?: number;
  readonly limit?: number;
}

export interface FederatedSearchResult {
  readonly query: string;
  readonly matches: readonly FederatedSearchMatch[];
  readonly totalMatches: number;
  readonly searchedSources: readonly KnowledgeSourceKind[];
  readonly degradedSources: readonly string[];
}

type KnowledgeRow = { id: string; filename: string; ordinal: number; content: string; updatedAt: Date };
type MemoryRow = { id: string; kind: string; content: string; updatedAt: Date };

function lexicalScore(content: string, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1);
  if (!terms.length) return 0;
  const haystack = content.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return Math.min(0.95, 0.5 + (hits / terms.length) * 0.45);
}

export class FederatedKnowledgeService {
  async search(req: FederatedSearchRequest): Promise<FederatedSearchResult> {
    const targetSources = req.sources ?? ["KNOWLEDGE_ASSET", "PERSISTENT_MEMORY", "GOOGLE_DRIVE", "SLACK", "GMAIL", "NOTION"];
    const minScore = req.minScore ?? 0.5;
    const limit = Math.min(Math.max(req.limit ?? 10, 1), 50);
    const query = req.query.trim();
    const matches: FederatedSearchMatch[] = [];
    const degradedSources: string[] = [];

    for (const source of targetSources) {
      if (source === "KNOWLEDGE_ASSET") {
        try {
          const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
          const rows = await prisma.$queryRaw<KnowledgeRow[]>`
            select kc.id, a.filename, kc.ordinal, kc.content, a."updatedAt"
            from public."KnowledgeChunk" kc
            join public."KnowledgeAsset" a on a.id = kc."assetId"
            where kc."userId" = ${req.userId}
              and a.status = 'READY'
              and kc.content ilike ${pattern}
            order by a."updatedAt" desc
            limit ${Math.min(limit * 3, 100)}
          `;
          for (const row of rows) {
            const score = lexicalScore(`${row.filename} ${row.content}`, query);
            if (score < minScore) continue;
            matches.push({ id: row.id, source, title: row.filename, snippet: row.content.slice(0, 360), score, freshness: row.updatedAt.toISOString(), acl: { ownerUserId: req.userId, projectId: req.projectId, isPublic: false }, provenanceUri: `knowledge://chunk/${row.id}`, trustLevel: "TRUSTED_FIRST_PARTY" });
          }
        } catch (error) {
          degradedSources.push(`${source}: ${error instanceof Error ? error.message : "query failed"}`);
        }
        continue;
      }

      if (source === "PERSISTENT_MEMORY") {
        try {
          const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
          const rows = await prisma.$queryRaw<MemoryRow[]>`
            select id, kind::text as kind, content, "updatedAt"
            from public."UserMemory"
            where "userId" = ${req.userId} and content ilike ${pattern}
            order by "updatedAt" desc
            limit ${Math.min(limit * 2, 100)}
          `;
          for (const row of rows) {
            const score = lexicalScore(row.content, query);
            if (score < minScore) continue;
            matches.push({ id: row.id, source, title: row.kind, snippet: row.content.slice(0, 360), score, freshness: row.updatedAt.toISOString(), acl: { ownerUserId: req.userId, projectId: req.projectId, isPublic: false }, provenanceUri: `memory://persistent/${row.id}`, trustLevel: "TRUSTED_FIRST_PARTY" });
          }
        } catch (error) {
          degradedSources.push(`${source}: ${error instanceof Error ? error.message : "query failed"}`);
        }
        continue;
      }

      // Connected providers require an authenticated user-owned connection. The request
      // currently carries no connectionId, so returning invented provider documents would
      // be a false success. Report these sources as degraded until a live connector search
      // can be authorized for this request.
      degradedSources.push(`${source}: live connector authorization is required`);
    }

    const filtered = matches.sort((a, b) => b.score - a.score).slice(0, limit);
    return { query: req.query, matches: filtered, totalMatches: filtered.length, searchedSources: targetSources, degradedSources };
  }
}

export const globalFederatedKnowledge = new FederatedKnowledgeService();
