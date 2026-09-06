export type ArtifactFormat =
	| "TXT"
	| "MARKDOWN"
	| "JSON"
	| "CSV"
	| "HTML"
	| "PDF"
	| "DOCX"
	| "XLSX"
	| "PPTX"
	| "ZIP"
	| "DOCX_OUTLINE"
	| "PPTX_DECK"
	| "ZIP_METADATA"
	| "IMAGE_METADATA"
	| "DESIGN_SVG"
	| "DESIGN_TOKENS"
	| "MULTIMODAL_MEDIA";

export interface ArtifactProvenance {
	readonly runId: string;
	readonly taskId?: string;
	readonly agentRole?: string;
	readonly parentArtifactId?: string;
	readonly codeSha?: string;
	readonly promptVersionId?: string;
	readonly inputChecksum: string;
	readonly generatedAt: string;
	readonly generator: string;
}

export interface ArtifactValidationResult {
	readonly isValid: boolean;
	readonly format: ArtifactFormat;
	readonly score: number; // 0 - 100
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
	readonly metrics: {
		readonly sizeBytes: number;
		readonly rowCount?: number;
		readonly columnCount?: number;
		readonly wordCount?: number;
		readonly slideCount?: number;
		readonly pageCount?: number;
		readonly structureDepth?: number;
		readonly archiveFilesCount?: number;
	};
}

export interface ArtifactVersion {
	readonly version: number;
	readonly content: string; // UTF-8 text or Base64 binary
	readonly storageUri?: string;
	readonly checksum: string;
	readonly sizeBytes: number;
	readonly validation: ArtifactValidationResult;
	readonly provenance: ArtifactProvenance;
	readonly createdAt: string;
}

export interface StoredArtifact {
	readonly id: string;
	readonly userId: string;
	readonly projectId?: string;
	readonly name: string;
	readonly format: ArtifactFormat;
	readonly mimeType: string;
	readonly currentVersion: number;
	readonly versions: readonly ArtifactVersion[];
	readonly tags: readonly string[];
	readonly isPublic: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface TableStats {
	readonly rowCount: number;
	readonly columnCount: number;
	readonly columns: readonly string[];
	readonly stats: Record<
		string,
		{
			readonly count: number;
			readonly distinct: number;
			readonly isNumeric: boolean;
			readonly sum?: number;
			readonly avg?: number;
			readonly min?: number;
			readonly max?: number;
		}
	>;
}

export interface ProvenanceLineageNode {
	readonly artifactId: string;
	readonly name: string;
	readonly version: number;
	readonly checksum: string;
	readonly runId: string;
	readonly generator: string;
	readonly generatedAt: string;
	readonly parentArtifactId?: string;
}

export function parseTableStats(content: string): TableStats {
	const lines = content
		.trim()
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length === 0) return { rowCount: 0, columnCount: 0, columns: [], stats: {} };
	const columns = (lines[0]?.split(",") ?? []).map((c) => c.trim().replace(/^["']|["']$/g, ""));
	const rows = lines.slice(1).map((line) => line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, "")));
	const stats: Record<string, { count: number; distinct: number; isNumeric: boolean; sum?: number; avg?: number }> = {};
	for (let i = 0; i < columns.length; i++) {
		const col = columns[i]!;
		const values = rows.map((r) => r[i] ?? "");
		const numbers = values.map((v) => Number(v)).filter((v) => !isNaN(v) && v !== 0);
		const isNumeric = numbers.length > 0 && numbers.length >= values.length * 0.7;
		stats[col] = {
			count: values.length,
			distinct: new Set(values).size,
			isNumeric,
			sum: isNumeric ? numbers.reduce((a, b) => a + b, 0) : undefined,
			avg: isNumeric && numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : undefined,
		};
	}
	return { rowCount: rows.length, columnCount: columns.length, columns, stats };
}
