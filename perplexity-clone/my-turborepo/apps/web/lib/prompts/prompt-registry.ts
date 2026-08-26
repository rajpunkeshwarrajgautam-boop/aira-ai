/**
 * Prompt registry.
 *
 * Every function here takes an explicit `userId` and scopes its queries by it.
 * That scoping is the enforcement point for ownership: a caller cannot read,
 * edit, publish or run another user's prompt even if it supplies a valid id.
 * `prompt-authorization.ts` states the same rules as pure policy for testing.
 *
 * Version history is append-only. Nothing in this module updates a
 * PromptVersion row after creation; "restore" writes a new version from an old
 * body, and "publish" only moves a pointer.
 */

import { createHash } from "node:crypto";

import {
	PromptAssignmentScope,
	PromptOrigin,
	PromptStatus,
	PromptVisibility,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
	analyzePromptBody,
	serializeSecurityReport,
	type PromptSecurityReport,
} from "@services/prompt/prompt-security";
import {
	assertValidVariableDefinitions,
	parseVariableDefinitions,
	type PromptVariableDefinition,
} from "@services/prompt/prompt-variables";
import { AIRA_STARTER_TEMPLATES } from "@services/prompt/prompt-starter-pack";

export type PromptRegistryErrorCode =
	| "NOT_FOUND"
	| "SLUG_TAKEN"
	| "INVALID_STATE"
	| "IMMUTABLE_VERSION"
	| "LIMIT_REACHED";

export class PromptRegistryError extends Error {
	readonly code: PromptRegistryErrorCode;
	readonly status: 400 | 404 | 409;

	constructor(message: string, code: PromptRegistryErrorCode, status: 400 | 404 | 409 = 400) {
		super(message);
		this.name = "PromptRegistryError";
		this.code = code;
		this.status = status;
	}
}

export const MAX_PROMPTS_PER_USER = 200;
export const MAX_VERSIONS_PER_PROMPT = 100;
export const MAX_PROMPT_BODY_LENGTH = 40_000;

function bodyHash(body: string): string {
	return createHash("sha256")
		.update(body.replace(/\r\n/g, "\n").trim(), "utf8")
		.digest("hex");
}

export function slugify(value: string): string {
	const base = value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return base.length > 0 ? base : "prompt";
}

async function uniqueSlug(userId: string, desired: string): Promise<string> {
	const base = slugify(desired);
	const existing = await prisma.prompt.findMany({
		where: { userId, slug: { startsWith: base } },
		select: { slug: true },
	});
	const taken = new Set(existing.map((row) => row.slug));
	if (!taken.has(base)) return base;
	for (let suffix = 2; suffix < 500; suffix += 1) {
		const candidate = `${base}-${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}
	throw new PromptRegistryError("Could not allocate a unique slug.", "SLUG_TAKEN", 409);
}

export interface PromptVersionPayload {
	readonly body: string;
	readonly variables?: readonly PromptVariableDefinition[];
	readonly providerCompatibility?: readonly string[];
	readonly modelCompatibility?: readonly string[];
	readonly toolRequirements?: readonly string[];
	readonly notes?: string;
}

export interface CreatePromptInput extends PromptVersionPayload {
	readonly name: string;
	readonly description?: string;
	readonly category?: string;
	readonly tags?: readonly string[];
	readonly visibility?: PromptVisibility;
	readonly origin?: PromptOrigin;
	readonly externalSourceId?: string;
}

function analyzeForStorage(payload: PromptVersionPayload): {
	readonly report: PromptSecurityReport;
	readonly variables: readonly PromptVariableDefinition[];
} {
	const variables = payload.variables ?? [];
	assertValidVariableDefinitions(variables);
	const report = analyzePromptBody(payload.body, { variables });
	return { report, variables };
}

function assertBodyLength(body: string): void {
	if (body.trim().length === 0) {
		throw new PromptRegistryError("A prompt body is required.", "INVALID_STATE");
	}
	if (body.length > MAX_PROMPT_BODY_LENGTH) {
		throw new PromptRegistryError(
			`Prompt body exceeds ${MAX_PROMPT_BODY_LENGTH.toLocaleString("en-US")} characters.`,
			"INVALID_STATE",
		);
	}
}

export async function createPrompt(userId: string, input: CreatePromptInput) {
	assertBodyLength(input.body);
	const total = await prisma.prompt.count({ where: { userId } });
	if (total >= MAX_PROMPTS_PER_USER) {
		throw new PromptRegistryError(
			`You have reached the limit of ${MAX_PROMPTS_PER_USER} prompts.`,
			"LIMIT_REACHED",
			409,
		);
	}

	const { report, variables } = analyzeForStorage(input);
	const slug = await uniqueSlug(userId, input.name);

	return prisma.prompt.create({
		data: {
			userId,
			name: input.name.trim(),
			slug,
			description: input.description?.trim() || null,
			category: (input.category ?? "general").trim() || "general",
			tags: [...(input.tags ?? [])],
			status: PromptStatus.DRAFT,
			visibility: input.visibility ?? PromptVisibility.PRIVATE,
			origin: input.origin ?? PromptOrigin.USER,
			externalSourceId: input.externalSourceId ?? null,
			versions: {
				create: {
					userId,
					version: 1,
					body: input.body,
					variables: variables as unknown as object,
					providerCompatibility: [...(input.providerCompatibility ?? [])],
					modelCompatibility: [...(input.modelCompatibility ?? [])],
					toolRequirements: [...(input.toolRequirements ?? [])],
					securityFindings: serializeSecurityReport(report) as unknown as object,
					securityMaxSeverity: report.maxSeverity,
					notes: input.notes?.trim() || null,
					contentHash: bodyHash(input.body),
				},
			},
		},
		include: { versions: { orderBy: { version: "desc" } } },
	});
}

export interface UpdatePromptMetadataInput {
	readonly name?: string;
	readonly description?: string | null;
	readonly category?: string;
	readonly tags?: readonly string[];
	readonly visibility?: PromptVisibility;
}

export async function updatePromptMetadata(
	userId: string,
	promptId: string,
	input: UpdatePromptMetadataInput,
) {
	const existing = await prisma.prompt.findFirst({ where: { id: promptId, userId } });
	if (!existing) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);

	return prisma.prompt.update({
		where: { id: existing.id },
		data: {
			...(input.name !== undefined ? { name: input.name.trim() } : {}),
			...(input.description !== undefined
				? { description: input.description?.trim() || null }
				: {}),
			...(input.category !== undefined ? { category: input.category.trim() || "general" } : {}),
			...(input.tags !== undefined ? { tags: [...input.tags] } : {}),
			...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
		},
	});
}

/**
 * Creates the next immutable version. Editing a published prompt always lands
 * here: the published pointer stays where it is until an explicit publish.
 */
export async function createPromptVersion(
	userId: string,
	promptId: string,
	payload: PromptVersionPayload,
) {
	assertBodyLength(payload.body);
	const prompt = await prisma.prompt.findFirst({
		where: { id: promptId, userId },
		include: { versions: { orderBy: { version: "desc" }, take: 1 } },
	});
	if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);

	const latest = prompt.versions[0];
	const nextVersion = (latest?.version ?? 0) + 1;
	if (nextVersion > MAX_VERSIONS_PER_PROMPT) {
		throw new PromptRegistryError(
			`This prompt has reached ${MAX_VERSIONS_PER_PROMPT} versions.`,
			"LIMIT_REACHED",
			409,
		);
	}

	const { report, variables } = analyzeForStorage(payload);

	const version = await prisma.promptVersion.create({
		data: {
			promptId: prompt.id,
			userId,
			version: nextVersion,
			body: payload.body,
			variables: variables as unknown as object,
			providerCompatibility: [...(payload.providerCompatibility ?? [])],
			modelCompatibility: [...(payload.modelCompatibility ?? [])],
			toolRequirements: [...(payload.toolRequirements ?? [])],
			securityFindings: serializeSecurityReport(report) as unknown as object,
			securityMaxSeverity: report.maxSeverity,
			notes: payload.notes?.trim() || null,
			contentHash: bodyHash(payload.body),
		},
	});

	await prisma.prompt.update({ where: { id: prompt.id }, data: { updatedAt: new Date() } });
	return version;
}

/** Restoring an old version writes a NEW version from its body. */
export async function restorePromptVersion(
	userId: string,
	promptId: string,
	sourceVersionId: string,
) {
	const source = await prisma.promptVersion.findFirst({
		where: { id: sourceVersionId, promptId, userId },
	});
	if (!source) throw new PromptRegistryError("Version not found.", "NOT_FOUND", 404);

	return createPromptVersion(userId, promptId, {
		body: source.body,
		variables: parseVariableDefinitions(source.variables),
		providerCompatibility: source.providerCompatibility,
		modelCompatibility: source.modelCompatibility,
		toolRequirements: source.toolRequirements,
		notes: `Restored from v${source.version}`,
	});
}

export async function publishPromptVersion(userId: string, promptId: string, versionId: string) {
	const prompt = await prisma.prompt.findFirst({ where: { id: promptId, userId } });
	if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	if (prompt.status === PromptStatus.ARCHIVED) {
		throw new PromptRegistryError(
			"Restore this prompt from the archive before publishing.",
			"INVALID_STATE",
			409,
		);
	}
	const version = await prisma.promptVersion.findFirst({
		where: { id: versionId, promptId: prompt.id, userId },
	});
	if (!version) throw new PromptRegistryError("Version not found.", "NOT_FOUND", 404);

	const published = await prisma.prompt.update({
		where: { id: prompt.id },
		data: { status: PromptStatus.PUBLISHED, publishedVersionId: version.id, archivedAt: null },
	});

	// Assignments that are not pinned follow the published pointer.
	await prisma.promptAssignment.updateMany({
		where: { userId, promptId: prompt.id, pinnedVersion: false },
		data: { promptVersionId: version.id },
	});

	return published;
}

export async function unpublishPrompt(userId: string, promptId: string) {
	const prompt = await prisma.prompt.findFirst({ where: { id: promptId, userId } });
	if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	// Assignments reference a version row directly and stay valid; the prompt
	// simply stops being selectable for new runtime surfaces.
	return prisma.prompt.update({
		where: { id: prompt.id },
		data: { status: PromptStatus.DRAFT, publishedVersionId: null },
	});
}

export async function archivePrompt(userId: string, promptId: string) {
	const prompt = await prisma.prompt.findFirst({ where: { id: promptId, userId } });
	if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	await prisma.promptAssignment.deleteMany({ where: { userId, promptId: prompt.id } });
	return prisma.prompt.update({
		where: { id: prompt.id },
		data: { status: PromptStatus.ARCHIVED, publishedVersionId: null, archivedAt: new Date() },
	});
}

export async function restorePrompt(userId: string, promptId: string) {
	const prompt = await prisma.prompt.findFirst({ where: { id: promptId, userId } });
	if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	return prisma.prompt.update({
		where: { id: prompt.id },
		data: { status: PromptStatus.DRAFT, archivedAt: null },
	});
}

export async function duplicatePrompt(userId: string, promptId: string) {
	const prompt = await prisma.prompt.findFirst({
		where: { id: promptId, userId },
		include: { versions: { orderBy: { version: "desc" }, take: 1 } },
	});
	if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	const source = prompt.publishedVersionId
		? await prisma.promptVersion.findFirst({ where: { id: prompt.publishedVersionId, userId } })
		: prompt.versions[0];
	if (!source) throw new PromptRegistryError("Prompt has no version to copy.", "INVALID_STATE", 409);

	return createPrompt(userId, {
		name: `${prompt.name} copy`,
		description: prompt.description ?? undefined,
		category: prompt.category,
		tags: prompt.tags,
		visibility: prompt.visibility,
		origin: prompt.origin,
		externalSourceId: prompt.externalSourceId ?? undefined,
		body: source.body,
		variables: parseVariableDefinitions(source.variables),
		providerCompatibility: source.providerCompatibility,
		modelCompatibility: source.modelCompatibility,
		toolRequirements: source.toolRequirements,
		notes: `Duplicated from ${prompt.slug} v${source.version}`,
	});
}

export async function deletePrompt(userId: string, promptId: string) {
	const deleted = await prisma.prompt.deleteMany({ where: { id: promptId, userId } });
	if (deleted.count === 0) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	return { deleted: true };
}

export interface ListPromptsFilters {
	readonly status?: PromptStatus;
	readonly category?: string;
	readonly search?: string;
	readonly limit?: number;
}

export async function listPrompts(userId: string, filters: ListPromptsFilters = {}) {
	const search = filters.search?.trim();
	return prisma.prompt.findMany({
		where: {
			userId,
			...(filters.status ? { status: filters.status } : {}),
			...(filters.category ? { category: filters.category } : {}),
			...(search
				? {
						OR: [
							{ name: { contains: search, mode: "insensitive" as const } },
							{ description: { contains: search, mode: "insensitive" as const } },
							{ tags: { has: search.toLowerCase() } },
						],
					}
				: {}),
		},
		orderBy: { updatedAt: "desc" },
		take: Math.min(Math.max(filters.limit ?? 100, 1), 200),
		include: {
			publishedVersion: { select: { id: true, version: true } },
			_count: { select: { versions: true } },
		},
	});
}

export async function getPromptDetail(userId: string, promptId: string) {
	const prompt = await prisma.prompt.findFirst({
		where: { id: promptId, userId },
		include: {
			versions: { orderBy: { version: "desc" } },
			publishedVersion: { select: { id: true, version: true } },
			externalSource: {
				select: { id: true, repository: true, path: true, url: true, commitSha: true, title: true },
			},
		},
	});
	if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	return prompt;
}

export async function getPromptVersion(userId: string, promptId: string, versionId: string) {
	const version = await prisma.promptVersion.findFirst({
		where: { id: versionId, promptId, userId },
	});
	if (!version) throw new PromptRegistryError("Version not found.", "NOT_FOUND", 404);
	return version;
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export const WORKSPACE_ASSIGNMENT_KEY = "workspace";

export async function setPromptAssignment(input: {
	readonly userId: string;
	readonly scope: PromptAssignmentScope;
	readonly targetKey: string;
	readonly promptId: string;
	readonly promptVersionId?: string;
	readonly pinnedVersion?: boolean;
}) {
	const prompt = await prisma.prompt.findFirst({
		where: { id: input.promptId, userId: input.userId },
	});
	if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	if (prompt.status !== PromptStatus.PUBLISHED || !prompt.publishedVersionId) {
		throw new PromptRegistryError(
			"Publish a version before assigning this prompt to a runtime surface.",
			"INVALID_STATE",
			409,
		);
	}

	const versionId = input.promptVersionId ?? prompt.publishedVersionId;
	const version = await prisma.promptVersion.findFirst({
		where: { id: versionId, promptId: prompt.id, userId: input.userId },
	});
	if (!version) throw new PromptRegistryError("Version not found.", "NOT_FOUND", 404);

	// Pinning a non-published version is a deliberate, explicit act. Assigning
	// without pinning always tracks the published pointer.
	const pinned = input.pinnedVersion === true || versionId !== prompt.publishedVersionId;

	return prisma.promptAssignment.upsert({
		where: {
			userId_scope_targetKey: {
				userId: input.userId,
				scope: input.scope,
				targetKey: input.targetKey,
			},
		},
		create: {
			userId: input.userId,
			scope: input.scope,
			targetKey: input.targetKey,
			promptId: prompt.id,
			promptVersionId: version.id,
			pinnedVersion: pinned,
		},
		update: { promptId: prompt.id, promptVersionId: version.id, pinnedVersion: pinned },
	});
}

export async function clearPromptAssignment(
	userId: string,
	scope: PromptAssignmentScope,
	targetKey: string,
) {
	const removed = await prisma.promptAssignment.deleteMany({ where: { userId, scope, targetKey } });
	return { cleared: removed.count > 0 };
}

export async function listPromptAssignments(userId: string) {
	return prisma.promptAssignment.findMany({
		where: { userId },
		orderBy: { updatedAt: "desc" },
		include: {
			prompt: { select: { id: true, name: true, slug: true, status: true } },
			promptVersion: { select: { id: true, version: true } },
		},
	});
}

/**
 * Resolves the template that applies to a runtime request.
 *
 * Precedence: an explicit conversation assignment, then the agent assignment,
 * then the workspace default. Only PUBLISHED prompts resolve, so a draft can
 * never reach chat, agents or evaluations.
 */
export async function resolveAssignedTemplate(input: {
	readonly userId: string;
	readonly conversationId?: string | null;
	readonly agentKey?: string | null;
}): Promise<{
	readonly promptId: string;
	readonly versionId: string;
	readonly version: number;
	readonly name: string;
	readonly body: string;
	readonly variables: readonly PromptVariableDefinition[];
	readonly scope: PromptAssignmentScope;
} | null> {
	const candidates: { scope: PromptAssignmentScope; targetKey: string }[] = [];
	if (input.conversationId) {
		candidates.push({ scope: PromptAssignmentScope.CONVERSATION, targetKey: input.conversationId });
	}
	if (input.agentKey) {
		candidates.push({ scope: PromptAssignmentScope.AGENT, targetKey: input.agentKey });
	}
	candidates.push({ scope: PromptAssignmentScope.WORKSPACE, targetKey: WORKSPACE_ASSIGNMENT_KEY });

	for (const candidate of candidates) {
		const assignment = await prisma.promptAssignment.findFirst({
			where: { userId: input.userId, scope: candidate.scope, targetKey: candidate.targetKey },
			include: {
				prompt: { select: { id: true, name: true, status: true } },
				promptVersion: true,
			},
		});
		if (!assignment) continue;
		if (assignment.prompt.status !== PromptStatus.PUBLISHED) continue;
		return {
			promptId: assignment.prompt.id,
			versionId: assignment.promptVersion.id,
			version: assignment.promptVersion.version,
			name: assignment.prompt.name,
			body: assignment.promptVersion.body,
			variables: parseVariableDefinitions(assignment.promptVersion.variables),
			scope: assignment.scope,
		};
	}
	return null;
}

// ---------------------------------------------------------------------------
// Starter pack
// ---------------------------------------------------------------------------

/**
 * Installs the AIRA-native starter templates for a user, skipping any slug they
 * already have. Idempotent, and explicitly invoked — nothing is seeded behind
 * the user's back.
 */
export async function installStarterPack(userId: string): Promise<{
	readonly installed: number;
	readonly skipped: number;
}> {
	const existing = await prisma.prompt.findMany({
		where: { userId, slug: { in: AIRA_STARTER_TEMPLATES.map((template) => template.slug) } },
		select: { slug: true },
	});
	const taken = new Set(existing.map((row) => row.slug));

	let installed = 0;
	for (const template of AIRA_STARTER_TEMPLATES) {
		if (taken.has(template.slug)) continue;
		const report = analyzePromptBody(template.body, { variables: template.variables });
		const created = await prisma.prompt.create({
			data: {
				userId,
				name: template.name,
				slug: template.slug,
				description: template.description,
				category: template.category,
				tags: [...template.tags],
				status: PromptStatus.DRAFT,
				visibility: PromptVisibility.PRIVATE,
				origin: PromptOrigin.AIRA_NATIVE,
				versions: {
					create: {
						userId,
						version: 1,
						body: template.body,
						variables: template.variables as unknown as object,
						providerCompatibility: [],
						modelCompatibility: [],
						toolRequirements: [],
						securityFindings: serializeSecurityReport(report) as unknown as object,
						securityMaxSeverity: report.maxSeverity,
						notes: "AIRA starter template",
						contentHash: bodyHash(template.body),
					},
				},
			},
			include: { versions: true },
		});
		const version = created.versions[0];
		if (version) {
			await prisma.prompt.update({
				where: { id: created.id },
				data: { status: PromptStatus.PUBLISHED, publishedVersionId: version.id },
			});
		}
		installed += 1;
	}

	return { installed, skipped: AIRA_STARTER_TEMPLATES.length - installed };
}
