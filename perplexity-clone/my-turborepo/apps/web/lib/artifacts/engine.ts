import { createHash } from "node:crypto";
import { z } from "zod";

export type ArtifactFormat =
	| "TXT"
	| "MARKDOWN"
	| "JSON"
	| "CSV"
	| "HTML"
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
		readonly structureDepth?: number;
	};
}

export interface ArtifactVersion {
	readonly version: number;
	readonly content: string;
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

// Validation logic for each format
export class ArtifactValidator {
	validate(format: ArtifactFormat, content: string): ArtifactValidationResult {
		const sizeBytes = Buffer.byteLength(content, "utf8");
		const errors: string[] = [];
		const warnings: string[] = [];
		let metrics: ArtifactValidationResult["metrics"] = { sizeBytes };

		if (sizeBytes === 0) {
			return {
				isValid: false,
				format,
				score: 0,
				errors: ["Artifact content is empty"],
				warnings: [],
				metrics,
			};
		}

		switch (format) {
			case "JSON": {
				try {
					const parsed = JSON.parse(content);
					const depth = this.calculateJsonDepth(parsed);
					metrics = { ...metrics, structureDepth: depth };
				} catch (err) {
					errors.push(`Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`);
				}
				break;
			}

			case "CSV": {
				const lines = content.trim().split(/\r?\n/);
				if (lines.length === 0) {
					errors.push("CSV contains no rows");
				} else {
					const headerCols = lines[0]!.split(",").length;
					let inconsistentRows = 0;
					for (let i = 1; i < lines.length; i++) {
						const colCount = lines[i]!.split(",").length;
						if (colCount !== headerCols) inconsistentRows++;
					}
					if (inconsistentRows > 0) {
						warnings.push(`${inconsistentRows} rows have mismatched column counts`);
					}
					metrics = {
						...metrics,
						rowCount: lines.length,
						columnCount: headerCols,
					};
				}
				break;
			}

			case "MARKDOWN": {
				const words = content.split(/\s+/).filter(Boolean).length;
				metrics = { ...metrics, wordCount: words };
				if (!content.includes("#")) {
					warnings.push("Markdown document lacks heading hierarchy");
				}
				break;
			}

			case "HTML": {
				if (!content.includes("<") || !content.includes(">")) {
					errors.push("HTML document has no valid markup tags");
				}
				if (!content.toLowerCase().includes("<!doctype html>") && !content.toLowerCase().includes("<html")) {
					warnings.push("HTML is a fragment rather than a standalone document");
				}
				break;
			}

			case "PPTX_DECK": {
				try {
					const deck = JSON.parse(content);
					if (!Array.isArray(deck.slides)) {
						errors.push("PPTX_DECK must contain an array of slides");
					} else {
						metrics = { ...metrics, slideCount: deck.slides.length };
					}
				} catch {
					errors.push("PPTX_DECK must be valid JSON slide structure");
				}
				break;
			}

			case "DOCX_OUTLINE": {
				try {
					const doc = JSON.parse(content);
					if (!Array.isArray(doc.sections)) {
						errors.push("DOCX_OUTLINE must contain an array of sections");
					}
				} catch {
					errors.push("DOCX_OUTLINE must be valid JSON document structure");
				}
				break;
			}

			case "DESIGN_SVG": {
				if (!content.includes("<svg") || !content.includes("</svg>")) {
					errors.push("DESIGN_SVG must contain valid root <svg> tags");
				}
				break;
			}

			case "DESIGN_TOKENS": {
				try {
					const tokens = JSON.parse(content);
					if (typeof tokens !== "object" || tokens === null) {
						errors.push("DESIGN_TOKENS must be a valid JSON dictionary of design tokens");
					}
				} catch {
					errors.push("DESIGN_TOKENS must be valid JSON syntax");
				}
				break;
			}

			default:
				metrics = { ...metrics, wordCount: content.split(/\s+/).filter(Boolean).length };
		}

		const isValid = errors.length === 0;
		const score = isValid ? (warnings.length === 0 ? 100 : 85) : 0;

		return {
			isValid,
			format,
			score,
			errors,
			warnings,
			metrics,
		};
	}

	private calculateJsonDepth(val: unknown, current = 1): number {
		if (!val || typeof val !== "object") return current;
		const values = Object.values(val);
		if (values.length === 0) return current;
		return Math.max(...values.map((v) => this.calculateJsonDepth(v, current + 1)));
	}
}

export class ArtifactEngine {
	private artifacts = new Map<string, StoredArtifact>();
	private validator = new ArtifactValidator();

	createArtifact(params: {
		userId: string;
		projectId?: string;
		name: string;
		format: ArtifactFormat;
		content: string;
		provenance: Omit<ArtifactProvenance, "generatedAt">;
		tags?: string[];
	}): StoredArtifact {
		const id = `art_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		const validation = this.validator.validate(params.format, params.content);
		const checksum = createHash("sha256").update(params.content).digest("hex");

		const firstVersion: ArtifactVersion = {
			version: 1,
			content: params.content,
			checksum,
			sizeBytes: Buffer.byteLength(params.content, "utf8"),
			validation,
			provenance: {
				...params.provenance,
				generatedAt: now,
			},
			createdAt: now,
		};

		const artifact: StoredArtifact = {
			id,
			userId: params.userId,
			projectId: params.projectId,
			name: params.name,
			format: params.format,
			mimeType: this.resolveMimeType(params.format),
			currentVersion: 1,
			versions: [firstVersion],
			tags: params.tags ?? [],
			isPublic: false,
			createdAt: now,
			updatedAt: now,
		};

		this.artifacts.set(id, artifact);
		return artifact;
	}

	updateArtifactVersion(params: {
		userId: string;
		artifactId: string;
		content: string;
		provenance: Omit<ArtifactProvenance, "generatedAt">;
	}): StoredArtifact | null {
		const existing = this.artifacts.get(params.artifactId);
		if (!existing || existing.userId !== params.userId) return null;

		const nextVersionNumber = existing.currentVersion + 1;
		const now = new Date().toISOString();
		const validation = this.validator.validate(existing.format, params.content);
		const checksum = createHash("sha256").update(params.content).digest("hex");

		const newVersion: ArtifactVersion = {
			version: nextVersionNumber,
			content: params.content,
			checksum,
			sizeBytes: Buffer.byteLength(params.content, "utf8"),
			validation,
			provenance: {
				...params.provenance,
				generatedAt: now,
			},
			createdAt: now,
		};

		const updated: StoredArtifact = {
			...existing,
			currentVersion: nextVersionNumber,
			versions: [...existing.versions, newVersion],
			updatedAt: now,
		};

		this.artifacts.set(params.artifactId, updated);
		return updated;
	}

	getArtifact(userId: string, artifactId: string): StoredArtifact | null {
		const existing = this.artifacts.get(artifactId);
		if (!existing) return null;
		if (existing.userId !== userId && !existing.isPublic) return null;
		return existing;
	}

	listArtifacts(userId: string, projectId?: string): readonly StoredArtifact[] {
		return [...this.artifacts.values()].filter((a) => {
			if (a.userId !== userId && !a.isPublic) return false;
			if (projectId && a.projectId !== projectId) return false;
			return true;
		});
	}

	deleteArtifact(userId: string, artifactId: string): boolean {
		const existing = this.artifacts.get(artifactId);
		if (!existing || existing.userId !== userId) return false;
		return this.artifacts.delete(artifactId);
	}

	// Provenance Lineage Graph (Gate 123)
	getProvenanceLineage(userId: string, artifactId: string): Array<{
		artifactId: string;
		name: string;
		version: number;
		parentArtifactId?: string;
		generator: string;
		checksum: string;
		generatedAt: string;
	}> {
		const result: Array<{
			artifactId: string;
			name: string;
			version: number;
			parentArtifactId?: string;
			generator: string;
			checksum: string;
			generatedAt: string;
		}> = [];

		let currentId: string | undefined = artifactId;
		const visited = new Set<string>();

		while (currentId && !visited.has(currentId)) {
			visited.add(currentId);
			const current = this.getArtifact(userId, currentId);
			if (!current) break;

			const activeVer = current.versions.find((v) => v.version === current.currentVersion);
			if (!activeVer) break;

			result.push({
				artifactId: current.id,
				name: current.name,
				version: current.currentVersion,
				parentArtifactId: activeVer.provenance.parentArtifactId,
				generator: activeVer.provenance.generator,
				checksum: activeVer.checksum,
				generatedAt: activeVer.provenance.generatedAt,
			});

			currentId = activeVer.provenance.parentArtifactId;
		}

		return result;
	}

	// Tabular inspection & statistics (Gate 73 Spreadsheet Workspace)
	computeTableStats(csvOrJsonContent: string): {
		columns: string[];
		rowCount: number;
		stats: Record<string, { count: number; distinct: number; isNumeric: boolean; sum?: number; avg?: number }>;
	} {
		let rows: Array<Record<string, unknown>> = [];
		try {
			if (csvOrJsonContent.trim().startsWith("[") || csvOrJsonContent.trim().startsWith("{")) {
				const parsed = JSON.parse(csvOrJsonContent);
				rows = Array.isArray(parsed) ? parsed : [parsed];
			} else {
				// Parse CSV
				const lines = csvOrJsonContent.trim().split(/\r?\n/);
				if (lines.length > 0) {
					const headers = lines[0]!.split(",").map((h) => h.trim());
					for (let i = 1; i < lines.length; i++) {
						const cols = lines[i]!.split(",");
						const row: Record<string, unknown> = {};
						headers.forEach((h, idx) => {
							row[h] = cols[idx]?.trim() ?? "";
						});
						rows.push(row);
					}
				}
			}
		} catch {
			return { columns: [], rowCount: 0, stats: {} };
		}

		const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
		const stats: Record<string, { count: number; distinct: number; isNumeric: boolean; sum?: number; avg?: number }> = {};

		for (const col of columns) {
			const values = rows.map((r) => r[col]);
			const distinct = new Set(values).size;
			const numericValues = values
				.map((v) => Number(v))
				.filter((n) => !Number.isNaN(n) && Number.isFinite(n));

			const isNumeric = numericValues.length === values.length && values.length > 0;
			const count = values.length;

			if (isNumeric) {
				const sum = numericValues.reduce((acc, v) => acc + v, 0);
				const avg = sum / count;
				stats[col] = { count, distinct, isNumeric: true, sum, avg };
			} else {
				stats[col] = { count, distinct, isNumeric: false };
			}
		}

		return {
			columns,
			rowCount: rows.length,
			stats,
		};
	}

	private resolveMimeType(format: ArtifactFormat): string {
		switch (format) {
			case "MARKDOWN": return "text/markdown";
			case "JSON": return "application/json";
			case "CSV": return "text/csv";
			case "HTML": return "text/html";
			case "DOCX_OUTLINE": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document+outline";
			case "PPTX_DECK": return "application/vnd.openxmlformats-officedocument.presentationml.presentation+outline";
			case "ZIP_METADATA": return "application/zip";
			case "IMAGE_METADATA": return "image/png+meta";
			default: return "text/plain";
		}
	}
}

export const globalArtifactEngine = new ArtifactEngine();
