export interface PublicationMessageLike {
	readonly role?: string;
	readonly content?: unknown;
}

export interface PublicationViolation {
	readonly code:
		| "invalid-citation"
		| "unsupported-cited-number"
		| "state-contradiction"
		| "state-omission"
		| "malformed-citation";
	readonly detail: string;
	readonly line?: string;
}

const STANDARD_CITATION = /\[(\d{1,4})\]/g;
const NUMBER_UNIT = "%|crores?|lakhs?|million|billion|months?|weeks?|days?|years?|contacts?|customers?|users?|smes?|interviews?|trials?|k|m|bn|l";

/**
 * Models occasionally return citation glyphs such as 【1】 or annotations such as
 * [2, est.]. Normalize those into the single syntax understood by the UI and source
 * parser. Estimate labels remain visible, but never live inside the citation marker.
 */
export function normalizeModelCitations(input: string): string {
	return input
		.replace(/[【[]\s*(\d{1,4})\s*,\s*(?:est\.?|estimate)\s*[】\]]/gi, "[$1] (estimate)")
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
	const rangeRe = new RegExp(
		`(₹\\s*)?(\\d+(?:\\.\\d+)?)\\s*[-–—]\\s*(\\d+(?:\\.\\d+)?)\\s*(${NUMBER_UNIT})?`,
		"gi",
	);
	const withoutRanges = withoutCitations.replace(
		rangeRe,
		(raw, currency: string | undefined, first: string, second: string, unit: string | undefined) => {
			for (const value of [first, second]) {
				const numeric = Number.parseFloat(value);
				const meaningful = Boolean(currency) || Boolean(unit) || value.includes(".") || numeric >= 10;
				if (meaningful) tokens.push({ value, raw, meaningful });
			}
			return " ";
		},
	);

	const re = new RegExp(`(₹\\s*)?(\\d+(?:\\.\\d+)?)(?:\\s*(${NUMBER_UNIT}))?`, "gi");
	let match: RegExpExecArray | null;
	while ((match = re.exec(withoutRanges)) !== null) {
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
		// The trailing quantifier must be lazy. A greedy one lets the `[.\n]`
		// lookahead alternative win at the end of the sentence, swallowing the
		// `and <verb>` clause boundary that separates two distinct assets. That
		// produced entities such as "logistics company and builds an invoicing
		// product", which never match real prose and therefore silently disabled
		// the state-contradiction check.
		/\bUser\s+(?:runs|owns|operates|has|uses)\s+([^ .\n]+(?:\s+[^.\n]+?)*?)(?=\s+and\s+(?:builds|built|runs|owns|operates|uses|has)\b|[.\n]|$)/gi,
		/\bUser\s+(?:builds|built|created)\s+([^.\n]+?)(?=[.\n]|$)/gi,
		/\band\s+(?:builds|built|created)\s+([^.\n]+?)(?=[.\n]|$)/gi,
		/\band\s+(?:runs|owns|operates|uses|has)\s+([^.\n]+?)(?=[.\n]|$)/gi,
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

function isBusinessDecisionContext(context: string): boolean {
	const query = extractSection(context, "User question", "Durable user state");
	return /\b(business|startup|company|venture|saas|product|market|revenue|go-to-market|gtm|launch|build|strategy|execution plan)\b/i.test(
		query,
	);
}

function candidateMentionsAnyEntity(candidate: string, entities: readonly string[]): boolean {
	const normalized = candidate.toLowerCase();
	return entities.some((entity) => normalized.includes(entity.toLowerCase()));
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
 * precise cited numbers absent from their cited evidence, duplicate setup work, and
 * silently ignoring recalled user assets in directly relevant business decisions.
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

	const existingEntities = extractExistingEntities(context);
	const setupVerbs = "register|incorporate|form|create|set up|establish|rebuild|re-create|buy|purchase|install";
	for (const entity of existingEntities) {
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

	if (
		existingEntities.length > 0 &&
		isBusinessDecisionContext(context) &&
		!candidateMentionsAnyEntity(candidate, existingEntities)
	) {
		violations.push({
			code: "state-omission",
			detail:
				`This is a business/build decision and durable state contains existing asset(s): ${existingEntities.slice(0, 3).join(", ")}. ` +
				"The answer must explicitly build on at least one relevant existing asset or explain why it should not be used.",
		});
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

/**
 * Last-resort deterministic fail-closed sanitizer. It removes lines that still contain
 * machine-detected unsupported cited numbers or duplicate setup instructions, removes
 * invalid citation markers, and injects a minimal recalled-state bridge when a directly
 * relevant business answer still ignores all existing user assets.
 */
export function sanitizeRemainingPublicationViolations(
	candidateInput: string,
	violations: readonly PublicationViolation[],
	messages: readonly PublicationMessageLike[],
): string {
	const context = combinedVerifierContext(messages);
	const evidence = parseEvidenceBlocks(context);
	let candidate = normalizeModelCitations(candidateInput);

	candidate = candidate.replace(/\[(\d{1,4})\]/g, (marker, rawIndex: string) => {
		const index = Number.parseInt(rawIndex, 10);
		return evidence.has(index) ? marker : "";
	});

	const blockedLines = new Set(
		violations
			.filter(
				(violation) =>
					(violation.code === "state-contradiction" || violation.code === "unsupported-cited-number") &&
					violation.line,
			)
			.map((violation) => violation.line!.trim()),
	);
	if (blockedLines.size > 0) {
		candidate = candidate
			.split(/\r?\n/)
			.filter((line) => !blockedLines.has(line.trim()))
			.join("\n");
	}

	// Line removal above can delete the only sentence that referenced an existing
	// asset, which introduces a fresh state-omission that was absent from the
	// incoming violation list. Re-evaluate the omission condition against the
	// sanitized text using the same predicate `validatePublicationCandidate` applies,
	// so this fail-closed path cannot hand back output that still fails validation.
	const entities = extractExistingEntities(context);
	if (
		entities.length > 0 &&
		isBusinessDecisionContext(context) &&
		!candidateMentionsAnyEntity(candidate, entities)
	) {
		candidate =
			`**Existing assets to build on:** ${entities.slice(0, 2).join(" and ")}. Use these as the operating/product base for this plan rather than starting from zero.\n\n` +
			candidate;
	}

	return candidate.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Compatibility wrapper used by the current ProviderRouter fallback path. Historically it
 * removed only duplicate-state lines; V8 deliberately fails closed for every deterministic
 * violation that can be safely handled without another model call.
 */
export function stripStateContradictionLines(
	candidateInput: string,
	violations: readonly PublicationViolation[],
	messages: readonly PublicationMessageLike[] = [],
): string {
	let candidate = normalizeModelCitations(candidateInput);

	const invalidIndices = new Set<number>();
	for (const violation of violations) {
		if (violation.code !== "invalid-citation") continue;
		const match = violation.detail.match(/Citation \[(\d{1,4})\]/);
		if (match) invalidIndices.add(Number.parseInt(match[1]!, 10));
	}
	if (invalidIndices.size > 0) {
		candidate = candidate.replace(/\[(\d{1,4})\]/g, (marker, rawIndex: string) =>
			invalidIndices.has(Number.parseInt(rawIndex, 10)) ? "" : marker,
		);
	}

	const blockedLines = new Set(
		violations
			.filter(
				(violation) =>
					(violation.code === "state-contradiction" || violation.code === "unsupported-cited-number") &&
					violation.line,
			)
			.map((violation) => violation.line!.trim()),
	);
	if (blockedLines.size > 0) {
		candidate = candidate
			.split(/\r?\n/)
			.filter((line) => !blockedLines.has(line.trim()))
			.join("\n");
	}

	// Prefer the verifier context when the caller supplies it: like the sanitizer
	// above, removing blocked lines can strip the only mention of an existing asset
	// and create an omission that is not in the incoming violation list.
	const context = combinedVerifierContext(messages);
	const contextEntities = context ? extractExistingEntities(context) : [];
	if (contextEntities.length > 0) {
		if (isBusinessDecisionContext(context) && !candidateMentionsAnyEntity(candidate, contextEntities)) {
			candidate =
				`**Existing assets to build on:** ${contextEntities.slice(0, 2).join(" and ")}. Use these as the operating/product base for this plan rather than starting from zero.\n\n` +
				candidate;
		}
		return candidate.replace(/\n{3,}/g, "\n\n").trim();
	}

	const omission = violations.find((violation) => violation.code === "state-omission");
	if (omission) {
		const match = omission.detail.match(/existing asset\(s\): (.+?)\. The answer/i);
		const assets = match?.[1]?.trim();
		if (assets) {
			const namedAssets = assets.split(/,\s*/).map((asset) => asset.trim()).filter(Boolean);
			const mentionsExisting = namedAssets.some((asset) => candidate.toLowerCase().includes(asset.toLowerCase()));
			if (!mentionsExisting) {
				candidate =
					`**Existing assets to build on:** ${namedAssets.slice(0, 2).join(" and ")}. Use these as the operating/product base for this plan rather than starting from zero.\n\n` +
					candidate;
			}
		}
	}

	return candidate.replace(/\n{3,}/g, "\n\n").trim();
}
