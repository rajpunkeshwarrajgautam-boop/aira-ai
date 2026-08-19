export interface PublicationMessageLike {
	readonly role?: string;
	readonly content?: unknown;
}

export interface PublicationViolation {
	readonly code:
		| "invalid-citation"
		| "unsupported-cited-number"
		| "state-contradiction"
		| "malformed-citation";
	readonly detail: string;
	readonly line?: string;
}

const STANDARD_CITATION = /\[(\d{1,4})\]/g;

/**
 * Models occasionally return citation glyphs such as 【1】 or annotations such as
 * [2, est.]. Normalize those into the single syntax understood by the UI and source
 * parser. Estimate labels remain visible, but never live inside the citation marker.
 */
export function normalizeModelCitations(input: string): string {
	return input
		.replace(/[【\[]\s*(\d{1,4})\s*,\s*(?:est\.?|estimate)\s*[】\]]/gi, "[$1] (estimate)")
		.replace(/【\s*(\d{1,4})\s*】/g, "[$1]")
		.replace(/【\s*(\d{1,4})\s*\]/g, "[$1]")
		.replace(/\[\s*(\d{1,4})\s*】/g, "[$1]")
		.replace(/\[\s*(\d{1,4})\s*\]/g, "[$1]");
}

function textContent(message: PublicationMessageLike): string {
	return typeof message.content === "string" ? message.content : "";
}

function combinedVerifierContext(messages: readonly PublicationMessageLike[]): string {
	return messages.map(textContent).filter(Boolean).join("\n\n");
}

function extractSection(text: string, heading: string, nextHeading?: string): string {
	const startMarker = `## ${heading}`;
	const start = text.indexOf(startMarker);
	if (start < 0) return "";
	const bodyStart = start + startMarker.length;
	if (!nextHeading) return text.slice(bodyStart).trim();
	const next = text.indexOf(`## ${nextHeading}`, bodyStart);
	return text.slice(bodyStart, next < 0 ? undefined : next).trim();
}

function parseEvidenceBlocks(context: string): Map<number, string> {
	const supplied = extractSection(context, "Supplied evidence", "Draft to verify and repair");
	const blocks = new Map<number, string>();
	if (!supplied) return blocks;

	const matches = [...supplied.matchAll(/^### \[(\d{1,4})\][^\n]*$/gm)];
	for (let i = 0; i < matches.length; i += 1) {
		const match = matches[i]!;
		const index = Number.parseInt(match[1]!, 10);
		const start = match.index ?? 0;
		const end = i + 1 < matches.length ? matches[i + 1]!.index ?? supplied.length : supplied.length;
		blocks.set(index, supplied.slice(start, end).toLowerCase().replace(/,/g, ""));
	}
	return blocks;
}

function citationIndices(line: string): number[] {
	const out = new Set<number>();
	const re = new RegExp(STANDARD_CITATION.source, "g");
	let match: RegExpExecArray | null;
	while ((match = re.exec(line)) !== null) out.add(Number.parseInt(match[1]!, 10));
	return [...out];
}

interface NumberToken {
	readonly value: string;
	readonly raw: string;
	readonly meaningful: boolean;
}

function numberTokens(line: string): NumberToken[] {
	const withoutCitations = line.replace(STANDARD_CITATION, "");
	const tokens: NumberToken[] = [];
	const re = /(₹\s*)?(\d+(?:\.\d+)?)(?:\s*(%|crores?|lakhs?|million|billion|months?|days?|years?|contacts?|customers?|users?|smes?|k|m|bn|l))?/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(withoutCitations)) !== null) {
		const value = match[2]!;
		const numeric = Number.parseFloat(value);
		const hasCurrency = Boolean(match[1]);
		const hasUnit = Boolean(match[3]);
		const meaningful = hasCurrency || hasUnit || value.includes(".") || numeric >= 10;
		if (meaningful) tokens.push({ value, raw: match[0]!, meaningful });
	}
	return tokens;
}

function numberAppears(text: string, value: string): boolean {
	const normalized = text.toLowerCase().replace(/,/g, "");
	const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^0-9.])${escaped}([^0-9.]|$)`).test(normalized);
}

function userSuppliedNumericContext(context: string): string {
	return [
		extractSection(context, "User question", "Durable user state"),
		extractSection(context, "Durable user state", "Pre-retrieval decision brief"),
	].join("\n").toLowerCase();
}

function extractExistingEntities(context: string): string[] {
	const durable = extractSection(context, "Durable user state", "Pre-retrieval decision brief");
	if (!durable) return [];
	const entities = new Set<string>();
	const patterns = [
		/\bUser\s+(?:runs|owns|operates|has|uses)\s+([^\.\n]+?)(?=\s+and\s+(?:builds|built|runs|owns|operates|uses|has)\b|[\.\n]|$)/gi,
		/\bUser\s+(?:builds|built|created)\s+([^\.\n]+?)(?=[\.\n]|$)/gi,
		/\band\s+(?:builds|built|created)\s+([^\.\n]+?)(?=[\.\n]|$)/gi,
	];
	for (const pattern of patterns) {
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(durable)) !== null) {
			const entity = match[1]!.trim().replace(/^an?\s+/i, "").replace(/\s+/g, " ");
			if (entity.length >= 4 && entity.length <= 100) entities.add(entity);
		}
	}
	return [...entities];
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLineContaining(text: string, pattern: RegExp): string | undefined {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => pattern.test(line));
}

function dedupeViolations(violations: readonly PublicationViolation[]): PublicationViolation[] {
	const seen = new Set<string>();
	const out: PublicationViolation[] = [];
	for (const violation of violations) {
		const key = `${violation.code}|${violation.detail}|${violation.line ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(violation);
	}
	return out;
}

/**
 * Deterministic checks applied after the private LLM verifier. These do not attempt to
 * judge the whole answer semantically; they block a narrow class of publication errors
 * that are machine-checkable and repeatedly harmful: invalid citation syntax/numbers,
 * precise cited numbers absent from their cited evidence, and instructions that recreate
 * assets durable memory says already exist.
 */
export function validatePublicationCandidate(
	candidateInput: string,
	messages: readonly PublicationMessageLike[],
): PublicationViolation[] {
	const candidate = normalizeModelCitations(candidateInput);
	const context = combinedVerifierContext(messages);
	const evidence = parseEvidenceBlocks(context);
	const maxCitation = evidence.size > 0 ? Math.max(...evidence.keys()) : 0;
	const violations: PublicationViolation[] = [];

	if (/[【】]/.test(candidate)) {
		violations.push({
			code: "malformed-citation",
			detail: "Citation glyphs must use [n] syntax only.",
		});
	}

	const allCitationIndices = citationIndices(candidate);
	for (const index of allCitationIndices) {
		if (index < 1 || index > maxCitation || !evidence.has(index)) {
			violations.push({
				code: "invalid-citation",
				detail: `Citation [${index}] does not exist in the supplied evidence set.`,
			});
		}
	}

	const userNumericContext = userSuppliedNumericContext(context);
	for (const rawLine of candidate.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		const cited = citationIndices(line).filter((index) => evidence.has(index));
		if (cited.length === 0) continue;
		const citedEvidence = cited.map((index) => evidence.get(index) ?? "").join("\n");
		for (const token of numberTokens(line)) {
			if (!token.meaningful) continue;
			if (numberAppears(userNumericContext, token.value)) continue;
			if (numberAppears(citedEvidence, token.value)) continue;
			violations.push({
				code: "unsupported-cited-number",
				detail: `The precise number ${token.raw.trim()} is not present in any cited source on that line. Remove/soften it or cite supplied evidence that actually contains it.`,
				line,
			});
		}
	}

	const setupVerbs = "register|incorporate|form|create|set up|establish|rebuild|re-create|buy|purchase|install";
	for (const entity of extractExistingEntities(context)) {
		const pattern = new RegExp(`\\b(?:${setupVerbs})\\b[^\\n.]{0,80}\\b${escapeRegex(entity)}\\b`, "i");
		const line = findLineContaining(candidate, pattern);
		if (line) {
			violations.push({
				code: "state-contradiction",
				detail: `Durable user state says ${entity} already exists, but the answer instructs the user to create/register/buy/install it again.`,
				line,
			});
		}
	}

	return dedupeViolations(violations);
}

export function formatPublicationViolations(violations: readonly PublicationViolation[]): string {
	return violations
		.map((violation, index) => {
			const line = violation.line ? `\n   Offending line: ${violation.line.slice(0, 500)}` : "";
			return `${index + 1}. ${violation.code}: ${violation.detail}${line}`;
		})
		.join("\n");
}

/** Last-resort deterministic safety: duplicate-setup instructions are always removable. */
export function stripStateContradictionLines(
	candidate: string,
	violations: readonly PublicationViolation[],
): string {
	const blocked = new Set(
		violations
			.filter((violation) => violation.code === "state-contradiction" && violation.line)
			.map((violation) => violation.line!.trim()),
	);
	if (blocked.size === 0) return candidate;
	return candidate
		.split(/\r?\n/)
		.filter((line) => !blocked.has(line.trim()))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
