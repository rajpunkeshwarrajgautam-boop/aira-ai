/**
 * External reference catalog persistence.
 *
 * Ingestion is an explicit, authenticated action. Nothing here runs from a chat
 * request path, and the stored body is never compiled into a prompt layer — it
 * exists so an author can read, analyze and then write an AIRA-native template
 * of their own.
 */

import { PromptExternalTransformStatus, PromptOrigin } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
	buildTransformationBrief,
	normalizeExternalPromptSource,
	type ExternalPromptSourceInput,
} from "@services/prompt/external-prompt-ingestion";

import { createPrompt, PromptRegistryError } from "./prompt-registry";

export const MAX_EXTERNAL_SOURCES_PER_USER = 300;

export async function ingestExternalSource(userId: string, input: ExternalPromptSourceInput) {
	const total = await prisma.promptExternalSource.count({ where: { userId } });
	if (total >= MAX_EXTERNAL_SOURCES_PER_USER) {
		throw new PromptRegistryError(
			`You have reached the limit of ${MAX_EXTERNAL_SOURCES_PER_USER} external references.`,
			"LIMIT_REACHED",
			409,
		);
	}

	const normalized = normalizeExternalPromptSource(input);

	// Re-ingesting the same content refreshes provenance rather than duplicating.
	return prisma.promptExternalSource.upsert({
		where: { userId_contentHash: { userId, contentHash: normalized.contentHash } },
		create: {
			userId,
			repository: normalized.repository,
			path: normalized.path,
			url: normalized.url,
			commitSha: normalized.commitSha,
			contentHash: normalized.contentHash,
			title: normalized.title,
			category: normalized.category,
			sourceLabel: normalized.sourceLabel,
			licenseNotice: normalized.licenseNotice,
			tags: [...normalized.tags],
			body: normalized.body,
			analysis: {
				findings: normalized.analysis.findings,
				counts: normalized.analysis.counts,
				analyzedCharacters: normalized.analysis.analyzedCharacters,
			} as unknown as object,
			securityNotes: normalized.securityNotes,
			transformationStatus: PromptExternalTransformStatus.UNREVIEWED,
			retrievedAt: normalized.retrievedAt,
		},
		update: {
			path: normalized.path,
			url: normalized.url,
			commitSha: normalized.commitSha,
			title: normalized.title,
			retrievedAt: normalized.retrievedAt,
		},
	});
}

export async function listExternalSources(userId: string, limit = 100) {
	return prisma.promptExternalSource.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
		take: Math.min(Math.max(limit, 1), 200),
		select: {
			id: true,
			repository: true,
			path: true,
			url: true,
			commitSha: true,
			contentHash: true,
			title: true,
			category: true,
			sourceLabel: true,
			licenseNotice: true,
			tags: true,
			analysis: true,
			securityNotes: true,
			transformationStatus: true,
			retrievedAt: true,
			createdAt: true,
		},
	});
}

export async function getExternalSource(userId: string, sourceId: string) {
	const source = await prisma.promptExternalSource.findFirst({ where: { id: sourceId, userId } });
	if (!source) throw new PromptRegistryError("External reference not found.", "NOT_FOUND", 404);
	return source;
}

export async function setExternalSourceStatus(
	userId: string,
	sourceId: string,
	status: PromptExternalTransformStatus,
) {
	const updated = await prisma.promptExternalSource.updateMany({
		where: { id: sourceId, userId },
		data: { transformationStatus: status },
	});
	if (updated.count === 0) {
		throw new PromptRegistryError("External reference not found.", "NOT_FOUND", 404);
	}
	return { status };
}

export async function deleteExternalSource(userId: string, sourceId: string) {
	const removed = await prisma.promptExternalSource.deleteMany({ where: { id: sourceId, userId } });
	if (removed.count === 0) {
		throw new PromptRegistryError("External reference not found.", "NOT_FOUND", 404);
	}
	return { deleted: true };
}

/**
 * Creates an AIRA-native draft *from* a reference without copying its body.
 *
 * The new draft starts from an authoring scaffold plus the structural
 * observations extracted from the reference, and records the provenance link.
 * This is the only supported path from external material to an AIRA template.
 */
export async function createTemplateFromReference(userId: string, sourceId: string) {
	const source = await getExternalSource(userId, sourceId);
	const brief = buildTransformationBrief({
		repository: source.repository,
		path: source.path,
		url: source.url,
		commitSha: source.commitSha,
		contentHash: source.contentHash,
		title: source.title,
		category: source.category,
		sourceLabel: source.sourceLabel,
		licenseNotice: source.licenseNotice ?? "",
		tags: source.tags,
		body: source.body,
		analysis: { findings: [], maxSeverity: null, counts: { info: 0, warning: 0, high: 0 }, analyzedCharacters: source.body.length, protectedLayersEnforced: true },
		securityNotes: source.securityNotes ?? "",
		retrievedAt: source.retrievedAt,
	});

	const body = [
		brief.authoringScaffold.trim(),
		"",
		"<!--",
		`${brief.provenanceNote}`,
		"Structural techniques observed in the reference (write AIRA's own instructions below, do not copy the reference text):",
		...brief.structuralObservations.map((observation) => `- ${observation}`),
		"-->",
		"",
	].join("\n");

	const prompt = await createPrompt(userId, {
		name: `${brief.suggestedName} (AIRA draft)`.slice(0, 120),
		description: `AIRA-native draft informed by ${source.repository}/${source.path}. Reference text was not copied.`,
		category: "derived",
		tags: ["derived", source.category],
		origin: PromptOrigin.EXTERNAL_DERIVED,
		externalSourceId: source.id,
		body,
		variables: [],
		notes: brief.provenanceNote,
	});

	await prisma.promptExternalSource.update({
		where: { id: source.id },
		data: { transformationStatus: PromptExternalTransformStatus.TRANSFORMED },
	});

	return prompt;
}
