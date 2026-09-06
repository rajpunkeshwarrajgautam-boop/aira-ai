import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
	buildZip,
	generateNativeDocx,
	generateNativePdf,
	generateNativePptx,
	generateNativeXlsx,
	unpackZip,
} from "./native-formats";
import { prisma } from "@/lib/prisma";

export * from "./types";
import type {
	ArtifactFormat,
	ArtifactProvenance,
	ArtifactValidationResult,
	ArtifactVersion,
	StoredArtifact,
} from "./types";

export class ArtifactValidator {
	validate(format: ArtifactFormat, content: string | Buffer): ArtifactValidationResult {
		const rawBuffer = Buffer.isBuffer(content)
			? content
			: (this.isBase64Binary(content, format) ? Buffer.from(content, "base64") : Buffer.from(content, "utf8"));

		const textContent = typeof content === "string" ? content : content.toString("utf8");
		const sizeBytes = rawBuffer.length;
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
			case "PDF": {
				const header = rawBuffer.subarray(0, 8).toString("utf8");
				if (!header.startsWith("%PDF-")) {
					errors.push("Invalid PDF signature: header must start with %PDF-");
				} else {
					const body = rawBuffer.toString("utf8");
					if (!body.includes("%%EOF")) {
						errors.push("PDF is missing %%EOF marker");
					}
					const pageMatches = body.match(/\/Type\s*\/Page\b/g);
					const pages = pageMatches ? pageMatches.length : 1;
					metrics = { ...metrics, pageCount: pages };
				}
				break;
			}

			case "DOCX": {
				try {
					const files = unpackZip(rawBuffer);
					const docXml = files.find((f) => f.path === "word/document.xml");
					if (!docXml) {
						errors.push("Invalid DOCX Open XML package: missing word/document.xml");
					} else {
						const xmlStr = docXml.data.toString("utf8");
						const wordMatches = xmlStr.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
						const words = wordMatches ? wordMatches.length : 0;
						metrics = { ...metrics, wordCount: words };
					}
				} catch (err) {
					errors.push(`Failed to parse DOCX Open XML archive: ${err instanceof Error ? err.message : String(err)}`);
				}
				break;
			}

			case "XLSX": {
				try {
					const files = unpackZip(rawBuffer);
					const sheet1 = files.find((f) => f.path === "xl/worksheets/sheet1.xml");
					if (!sheet1) {
						errors.push("Invalid XLSX Open XML package: missing xl/worksheets/sheet1.xml");
					} else {
						const xmlStr = sheet1.data.toString("utf8");
						const rowMatches = xmlStr.match(/<row\b/g);
						const cellMatches = xmlStr.match(/<c\b/g);
						const rowCount = rowMatches ? rowMatches.length : 0;
						const colCount = rowCount > 0 && cellMatches ? Math.ceil(cellMatches.length / rowCount) : 0;
						metrics = { ...metrics, rowCount, columnCount: colCount };
					}
				} catch (err) {
					errors.push(`Failed to parse XLSX Open XML archive: ${err instanceof Error ? err.message : String(err)}`);
				}
				break;
			}

			case "PPTX": {
				try {
					const files = unpackZip(rawBuffer);
					const presXml = files.find((f) => f.path === "ppt/presentation.xml");
					if (!presXml) {
						errors.push("Invalid PPTX Open XML package: missing ppt/presentation.xml");
					} else {
						const slideFiles = files.filter((f) => f.path.startsWith("ppt/slides/slide") && f.path.endsWith(".xml"));
						metrics = { ...metrics, slideCount: slideFiles.length };
					}
				} catch (err) {
					errors.push(`Failed to parse PPTX Open XML archive: ${err instanceof Error ? err.message : String(err)}`);
				}
				break;
			}

			case "ZIP": {
				try {
					const files = unpackZip(rawBuffer);
					if (files.length === 0) {
						warnings.push("ZIP archive contains 0 files");
					}
					metrics = { ...metrics, archiveFilesCount: files.length };
				} catch (err) {
					errors.push(`Invalid ZIP archive: ${err instanceof Error ? err.message : String(err)}`);
				}
				break;
			}

			case "JSON": {
				try {
					const parsed = JSON.parse(textContent);
					const depth = this.calculateJsonDepth(parsed);
					metrics = { ...metrics, structureDepth: depth };
				} catch (err) {
					errors.push(`Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`);
				}
				break;
			}

			case "CSV": {
				const lines = textContent.trim().split(/\r?\n/);
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
				const words = textContent.split(/\s+/).filter(Boolean).length;
				metrics = { ...metrics, wordCount: words };
				if (!textContent.includes("#")) {
					warnings.push("Markdown document lacks heading hierarchy");
				}
				break;
			}

			case "HTML": {
				if (!textContent.includes("<") || !textContent.includes(">")) {
					errors.push("HTML document has no valid markup tags");
				}
				if (!textContent.toLowerCase().includes("<!doctype html>") && !textContent.toLowerCase().includes("<html")) {
					warnings.push("HTML is a fragment rather than a standalone document");
				}
				break;
			}

			case "PPTX_DECK": {
				try {
					const deck = JSON.parse(textContent);
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
					const doc = JSON.parse(textContent);
					if (!Array.isArray(doc.sections)) {
						errors.push("DOCX_OUTLINE must contain an array of sections");
					}
				} catch {
					errors.push("DOCX_OUTLINE must be valid JSON document structure");
				}
				break;
			}

			case "DESIGN_SVG": {
				if (!textContent.includes("<svg") || !textContent.includes("</svg>")) {
					errors.push("DESIGN_SVG must contain valid root <svg> tags");
				}
				break;
			}

			case "DESIGN_TOKENS": {
				try {
					const tokens = JSON.parse(textContent);
					if (typeof tokens !== "object" || tokens === null) {
						errors.push("DESIGN_TOKENS must be a valid JSON dictionary of design tokens");
					}
				} catch {
					errors.push("DESIGN_TOKENS must be valid JSON syntax");
				}
				break;
			}

			default:
				metrics = { ...metrics, wordCount: textContent.split(/\s+/).filter(Boolean).length };
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

	private isBase64Binary(content: string, format: ArtifactFormat): boolean {
		if (["PDF", "DOCX", "XLSX", "PPTX", "ZIP"].includes(format)) {
			// If it doesn't start with XML or plain text markers, check if it's base64
			if (!content.startsWith("<") && !content.startsWith("{") && !content.startsWith("%PDF-")) {
				return /^[A-Za-z0-9+/=\s]+$/.test(content.slice(0, 100));
			}
		}
		return false;
	}

	private calculateJsonDepth(val: unknown, current = 1): number {
		if (!val || typeof val !== "object") return current;
		const values = Object.values(val);
		if (values.length === 0) return current;
		return Math.max(...values.map((v) => this.calculateJsonDepth(v, current + 1)));
	}
}

export class ArtifactEngine {
	private readonly storeDir: string;
	private readonly dataFilePath: string;
	private readonly versionsFilePath: string;
	private artifacts = new Map<string, StoredArtifact>();
	private versions = new Map<string, ArtifactVersion[]>();
	private validator = new ArtifactValidator();

	constructor(storagePath?: string) {
		this.storeDir = storagePath ?? process.env.AIRA_DATA_DIR ?? join(process.cwd(), ".aira-store");
		this.dataFilePath = join(this.storeDir, "artifacts.json");
		this.versionsFilePath = join(this.storeDir, "artifact-versions.json");
		this.ensureStorageDir();
		this.loadFromDisk();
	}

	private ensureStorageDir(): void {
		try {
			if (!existsSync(this.storeDir)) {
				mkdirSync(this.storeDir, { recursive: true });
			}
		} catch {
			// fallback
		}
	}

	private loadFromDisk(): void {
		try {
			if (existsSync(this.dataFilePath)) {
				const raw = readFileSync(this.dataFilePath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const item of parsed) {
						this.artifacts.set(item.id, item);
					}
				}
			}
			if (existsSync(this.versionsFilePath)) {
				const raw = readFileSync(this.versionsFilePath, "utf8");
				const parsed = JSON.parse(raw);
				if (typeof parsed === "object" && parsed !== null) {
					for (const [k, v] of Object.entries(parsed)) {
						if (Array.isArray(v)) {
							this.versions.set(k, v as ArtifactVersion[]);
						}
					}
				}
			}
		} catch {
			// fail-safe read
		}
	}

	private persistToDisk(): void {
		try {
			this.ensureStorageDir();
			const artifactsArr = [...this.artifacts.values()];
			const tempFile = `${this.dataFilePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempFile, JSON.stringify(artifactsArr, null, 2), "utf8");
			renameSync(tempFile, this.dataFilePath);

			const versionsObj = Object.fromEntries(this.versions.entries());
			const tempVFile = `${this.versionsFilePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempVFile, JSON.stringify(versionsObj, null, 2), "utf8");
			renameSync(tempVFile, this.versionsFilePath);
		} catch {
			// fail-safe write
		}
	}

	private async syncToDatabase(artifact: StoredArtifact, versionRecord: ArtifactVersion): Promise<void> {
		if (!process.env.DATABASE_URL) return;
		try {
			await prisma.durableArtifact.upsert({
				where: { id: artifact.id },
				create: {
					id: artifact.id,
					userId: artifact.userId,
					projectId: artifact.projectId ?? null,
					name: artifact.name,
					format: artifact.format,
					mimeType: artifact.mimeType,
					currentVersion: artifact.currentVersion,
					tags: [...artifact.tags],
					isPublic: artifact.isPublic,
				},
				update: {
					currentVersion: artifact.currentVersion,
					tags: [...artifact.tags],
					isPublic: artifact.isPublic,
				},
			});

			await prisma.durableArtifactVersion.upsert({
				where: {
					artifactId_version: {
						artifactId: artifact.id,
						version: versionRecord.version,
					},
				},
				create: {
					artifactId: artifact.id,
					version: versionRecord.version,
					content: versionRecord.content,
					storageUri: versionRecord.storageUri ?? null,
					checksum: versionRecord.checksum,
					sizeBytes: versionRecord.sizeBytes,
					validation: versionRecord.validation as never,
					provenance: versionRecord.provenance as never,
				},
				update: {},
			});
		} catch {
			// Non-blocking
		}
	}

	createArtifact(params: {
		userId: string;
		projectId?: string;
		name: string;
		format: ArtifactFormat;
		content: string | Buffer;
		provenance: Omit<ArtifactProvenance, "generatedAt">;
		tags?: string[];
	}): StoredArtifact {
		const id = `art_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();

		const contentStr = Buffer.isBuffer(params.content)
			? params.content.toString("base64")
			: params.content;

		const validation = this.validator.validate(params.format, params.content);
		const checksum = createHash("sha256")
			.update(Buffer.isBuffer(params.content) ? params.content : Buffer.from(params.content, "utf8"))
			.digest("hex");

		const sizeBytes = Buffer.isBuffer(params.content)
			? params.content.length
			: Buffer.byteLength(params.content, "utf8");

		const firstVersion: ArtifactVersion = {
			version: 1,
			content: contentStr,
			checksum,
			sizeBytes,
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
		this.versions.set(id, [firstVersion]);
		this.persistToDisk();
		void this.syncToDatabase(artifact, firstVersion);

		return artifact;
	}

	updateArtifactVersion(params: {
		userId: string;
		artifactId: string;
		content: string | Buffer;
		provenance: Omit<ArtifactProvenance, "generatedAt">;
	}): StoredArtifact | null {
		const existing = this.artifacts.get(params.artifactId);
		if (!existing || existing.userId !== params.userId) return null;

		const nextVersionNumber = existing.currentVersion + 1;
		const now = new Date().toISOString();

		const contentStr = Buffer.isBuffer(params.content)
			? params.content.toString("base64")
			: params.content;

		const validation = this.validator.validate(existing.format, params.content);
		const checksum = createHash("sha256")
			.update(Buffer.isBuffer(params.content) ? params.content : Buffer.from(params.content, "utf8"))
			.digest("hex");

		const sizeBytes = Buffer.isBuffer(params.content)
			? params.content.length
			: Buffer.byteLength(params.content, "utf8");

		const newVersion: ArtifactVersion = {
			version: nextVersionNumber,
			content: contentStr,
			checksum,
			sizeBytes,
			validation,
			provenance: {
				...params.provenance,
				generatedAt: now,
			},
			createdAt: now,
		};

		const updatedVersions = [...(this.versions.get(params.artifactId) ?? existing.versions), newVersion];
		const updated: StoredArtifact = {
			...existing,
			currentVersion: nextVersionNumber,
			versions: updatedVersions,
			updatedAt: now,
		};

		this.artifacts.set(params.artifactId, updated);
		this.versions.set(params.artifactId, updatedVersions);
		this.persistToDisk();
		void this.syncToDatabase(updated, newVersion);

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
		this.versions.delete(artifactId);
		const deleted = this.artifacts.delete(artifactId);
		this.persistToDisk();
		return deleted;
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

	// Spreadsheet formula evaluator (Gate 73)
	evaluateSpreadsheetFormulas(sheet: {
		headers: readonly string[];
		rows: (string | number)[][];
		formulas?: Record<string, string>;
	}): {
		evaluatedRows: (string | number)[][];
		cellValues: Record<string, number | string>;
	} {
		const cellValues: Record<string, number | string> = {};

		sheet.rows.forEach((row, rIdx) => {
			row.forEach((val, cIdx) => {
				const colLetter = String.fromCharCode(65 + cIdx);
				const ref = `${colLetter}${rIdx + 1}`;
				cellValues[ref] = val;
			});
		});

		// Evaluate formulas (e.g. =SUM(A1:A5))
		if (sheet.formulas) {
			for (const [cellRef, formula] of Object.entries(sheet.formulas)) {
				const sumMatch = formula.match(/SUM\(([A-Z])(\d+):([A-Z])(\d+)\)/i);
				if (sumMatch) {
					const col = sumMatch[1]!;
					const start = Number(sumMatch[2]);
					const end = Number(sumMatch[4]);
					let sum = 0;
					for (let r = start; r <= end; r++) {
						const v = Number(cellValues[`${col}${r}`] ?? 0);
						if (!Number.isNaN(v)) sum += v;
					}
					cellValues[cellRef] = sum;
				}
			}
		}

		return { evaluatedRows: sheet.rows, cellValues };
	}

	// Native binary deliverable generators (Gates 65, 66, 73, 74)
	generateDocx(params: {
		title: string;
		headings: string[];
		paragraphs: string[];
		tables?: { headers: string[]; rows: string[][] }[];
	}): Buffer {
		return generateNativeDocx(params);
	}

	generateXlsx(sheets: {
		name: string;
		headers: string[];
		rows: (string | number)[][];
		formulas?: Record<string, string>;
	}[]): Buffer {
		return generateNativeXlsx(sheets);
	}

	generatePptx(params: {
		title: string;
		slides: { title: string; bullets: string[] }[];
	}): Buffer {
		return generateNativePptx(params);
	}

	generatePdf(params: {
		title: string;
		bodyLines: string[];
	}): Buffer {
		return generateNativePdf(params);
	}

	generateZip(files: { path: string; data: Buffer | string }[]): Buffer {
		return buildZip(files);
	}

	private resolveMimeType(format: ArtifactFormat): string {
		switch (format) {
			case "PDF": return "application/pdf";
			case "DOCX": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
			case "XLSX": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
			case "PPTX": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
			case "ZIP": return "application/zip";
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

	// Durability reload for restart tests
	reloadFromDisk(): void {
		this.artifacts.clear();
		this.versions.clear();
		this.loadFromDisk();
	}
}

export const globalArtifactEngine = new ArtifactEngine();
