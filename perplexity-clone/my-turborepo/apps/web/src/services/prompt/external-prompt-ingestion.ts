/**
 * Controlled ingestion of external prompt corpora.
 *
 * The reference corpus AIRA reads from is `LouisShark/chatgpt_system_prompt`,
 * a public collection of system prompts and prompt-security material. It is
 * treated as *research material*, never as runtime instruction:
 *
 *   curated source -> controlled ingestion -> external reference catalog
 *   -> human review -> AIRA-native template -> publish -> Prompt Compiler
 *
 * Two rules this module exists to enforce:
 *
 *  - Ingested text is parsed for metadata only. Nothing in the body is ever
 *    executed, evaluated, or promoted into a system layer during ingestion.
 *  - Nothing is fetched during a chat request. Ingestion is an explicit,
 *    authenticated, per-item action from Prompt Studio.
 *
 * Provenance (repository, path, URL, commit SHA, content hash, retrieval time)
 * is recorded so a stored reference can always be traced back to what was read.
 */

import { createHash } from "node:crypto";

import { analyzePromptBody, type PromptSecurityReport } from "./prompt-security";

export const REFERENCE_REPOSITORY = "LouisShark/chatgpt_system_prompt";
export const REFERENCE_REPOSITORY_URL = `https://github.com/${REFERENCE_REPOSITORY}`;

/**
 * The corpus is MIT-licensed as a repository, but it aggregates prompt text
 * originating from many third-party products. Attribution is preserved for the
 * repository, and AIRA templates are authored originally rather than copied —
 * we extract structural technique, not third-party system prompts.
 */
export const REFERENCE_LICENSE_NOTICE =
	`Reference material from ${REFERENCE_REPOSITORY} (${REFERENCE_REPOSITORY_URL}), MIT-licensed as a repository. ` +
	"Individual prompt bodies in that corpus originate from multiple third-party products and their rights are held by their respective owners. " +
	"Stored here as untrusted reference data for analysis only. AIRA templates are authored originally; corpus text is not republished as an AIRA prompt.";

/** Directories in the corpus AIRA will read. Anything else is rejected. */
export const ALLOWED_SOURCE_PREFIXES = [
	"prompts/gpts/",
	"prompts/official-product/",
	"prompts/opensource-prj/",
] as const;

export const MAX_EXTERNAL_SOURCE_BYTES = 200_000;
export const MAX_EXTERNAL_TITLE_LENGTH = 200;

export type ExternalIngestionErrorCode =
	| "UNSUPPORTED_REPOSITORY"
	| "UNSUPPORTED_PATH"
	| "UNSUPPORTED_FORMAT"
	| "SOURCE_TOO_LARGE"
	| "EMPTY_SOURCE"
	| "INVALID_COMMIT_SHA";

export class ExternalIngestionError extends Error {
	readonly code: ExternalIngestionErrorCode;

	constructor(message: string, code: ExternalIngestionErrorCode) {
		super(message);
		this.name = "ExternalIngestionError";
		this.code = code;
	}
}

export interface ExternalPromptSourceInput {
	readonly repository: string;
	readonly path: string;
	readonly commitSha: string;
	readonly body: string;
}

export interface NormalizedExternalSource {
	readonly repository: string;
	readonly path: string;
	readonly url: string;
	readonly commitSha: string;
	readonly contentHash: string;
	readonly title: string;
	readonly category: string;
	readonly sourceLabel: string;
	readonly licenseNotice: string;
	readonly tags: readonly string[];
	readonly body: string;
	readonly analysis: PromptSecurityReport;
	readonly securityNotes: string;
	readonly retrievedAt: Date;
}

const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;
const SUPPORTED_EXTENSIONS = [".md", ".markdown", ".txt"];

function assertSupportedPath(path: string): void {
	const normalized = path.replace(/^\/+/, "");
	if (normalized.includes("..") || normalized.includes("\\")) {
		throw new ExternalIngestionError("Path traversal is not permitted.", "UNSUPPORTED_PATH");
	}
	if (!ALLOWED_SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
		throw new ExternalIngestionError(
			`Only these corpus directories may be ingested: ${ALLOWED_SOURCE_PREFIXES.join(", ")}.`,
			"UNSUPPORTED_PATH",
		);
	}
	if (!SUPPORTED_EXTENSIONS.some((extension) => normalized.toLowerCase().endsWith(extension))) {
		throw new ExternalIngestionError(
			`Only ${SUPPORTED_EXTENSIONS.join(", ")} files may be ingested.`,
			"UNSUPPORTED_FORMAT",
		);
	}
}

/** Stable across whitespace and line-ending noise so re-ingestion deduplicates. */
export function contentHash(body: string): string {
	const normalized = body.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
	return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function categoryForPath(path: string): string {
	if (path.startsWith("prompts/gpts/")) return "gpts";
	if (path.startsWith("prompts/official-product/")) return "official-product";
	if (path.startsWith("prompts/opensource-prj/")) return "opensource-project";
	return "uncategorized";
}

/**
 * Title extraction reads structure only — a leading Markdown heading, else the
 * filename. The body is never interpreted beyond this.
 */
function titleForSource(path: string, body: string): string {
	const heading = body.split("\n").find((line) => /^#{1,3}\s+\S/.test(line));
	const fromHeading = heading?.replace(/^#{1,3}\s+/, "").trim();
	const fromPath = path
		.split("/")
		.pop()
		?.replace(/\.(md|markdown|txt)$/i, "")
		.replace(/[-_]+/g, " ")
		.trim();
	const chosen = fromHeading && fromHeading.length > 0 ? fromHeading : (fromPath ?? path);
	return chosen.slice(0, MAX_EXTERNAL_TITLE_LENGTH);
}

function tagsForSource(path: string, category: string): readonly string[] {
	const segments = path.split("/").filter(Boolean);
	const leaf = segments[segments.length - 2];
	const tags = new Set<string>(["external-reference", category]);
	if (leaf && leaf !== "prompts") tags.add(leaf.toLowerCase());
	return [...tags];
}

function securityNotesFor(report: PromptSecurityReport): string {
	if (report.findings.length === 0) {
		return "Static analysis produced no findings. Stored as untrusted reference data regardless: corpus text is never compiled into a protected layer.";
	}
	const bySeverity = `${report.counts.high} high, ${report.counts.warning} warning, ${report.counts.info} info`;
	return (
		`Static analysis produced ${report.findings.length} finding(s) (${bySeverity}). ` +
		"Findings describe the corpus text, not AIRA behavior — this body is stored as untrusted reference data and is never compiled into a protected prompt layer."
	);
}

/**
 * Normalizes one corpus file into a catalog row. Pure and synchronous: it
 * performs no network access, so it can be unit tested and can never trigger a
 * fetch from a request path.
 */
export function normalizeExternalPromptSource(
	input: ExternalPromptSourceInput,
	now: Date = new Date(),
): NormalizedExternalSource {
	if (input.repository !== REFERENCE_REPOSITORY) {
		throw new ExternalIngestionError(
			`Only ${REFERENCE_REPOSITORY} is an approved reference corpus.`,
			"UNSUPPORTED_REPOSITORY",
		);
	}
	if (!COMMIT_SHA.test(input.commitSha)) {
		throw new ExternalIngestionError(
			"A commit SHA is required so the reference can be traced to an exact revision.",
			"INVALID_COMMIT_SHA",
		);
	}

	const path = input.path.replace(/^\/+/, "");
	assertSupportedPath(path);

	const body = input.body.replace(/\r\n/g, "\n");
	if (body.trim().length === 0) {
		throw new ExternalIngestionError("Source file is empty.", "EMPTY_SOURCE");
	}
	if (Buffer.byteLength(body, "utf8") > MAX_EXTERNAL_SOURCE_BYTES) {
		throw new ExternalIngestionError(
			`Source exceeds ${MAX_EXTERNAL_SOURCE_BYTES.toLocaleString("en-US")} bytes.`,
			"SOURCE_TOO_LARGE",
		);
	}

	const category = categoryForPath(path);
	// isExternalReference: size and output-constraint rules are advisory here —
	// we are describing someone else's prompt, not authoring one.
	const analysis = analyzePromptBody(body, { isExternalReference: true });

	return {
		repository: input.repository,
		path,
		url: `${REFERENCE_REPOSITORY_URL}/blob/${input.commitSha}/${path}`,
		commitSha: input.commitSha.toLowerCase(),
		contentHash: contentHash(body),
		title: titleForSource(path, body),
		category,
		sourceLabel: "louisshark-corpus",
		licenseNotice: REFERENCE_LICENSE_NOTICE,
		tags: tagsForSource(path, category),
		body,
		analysis,
		securityNotes: securityNotesFor(analysis),
		retrievedAt: now,
	};
}

/**
 * Starting point for turning a reviewed reference into an AIRA-native template.
 *
 * It deliberately does NOT copy the corpus body. It emits an empty authoring
 * scaffold plus the structural observations from the reference, so the author
 * writes AIRA's own instructions rather than republishing third-party text.
 */
export interface TransformationBrief {
	readonly suggestedName: string;
	readonly provenanceNote: string;
	readonly structuralObservations: readonly string[];
	readonly authoringScaffold: string;
	readonly copiedBody: false;
}

export function buildTransformationBrief(source: NormalizedExternalSource): TransformationBrief {
	const observations: string[] = [];
	const body = source.body;

	if (/^#{1,6}\s/m.test(body)) observations.push("Uses explicit section headings to separate concerns.");
	if (/^\s*(\d+\.|[-*])\s/m.test(body)) observations.push("Uses enumerated or bulleted rules rather than prose paragraphs.");
	if (/\byou\s+are\b/i.test(body)) observations.push("Opens with a role assignment before any task detail.");
	if (/\b(never|do not|don't|must not)\b/i.test(body)) observations.push("States prohibitions explicitly alongside instructions.");
	if (/\b(format|output|respond with|return)\b/i.test(body)) observations.push("Declares an output contract.");
	if (/\b(step[- ]by[- ]step|first|then|finally)\b/i.test(body)) observations.push("Prescribes an ordered procedure.");
	if (observations.length === 0) {
		observations.push("No reusable structural pattern was detected; treat as background reading only.");
	}

	return {
		suggestedName: source.title.slice(0, 80),
		provenanceNote: `Technique reference: ${source.repository}/${source.path} @ ${source.commitSha.slice(0, 12)}`,
		structuralObservations: observations,
		authoringScaffold: [
			"# Role",
			"",
			"# Task",
			"",
			"# Output contract",
			"",
			"# What to refuse or flag",
			"",
		].join("\n"),
		copiedBody: false,
	};
}
