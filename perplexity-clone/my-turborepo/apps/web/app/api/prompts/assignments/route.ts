import { z } from "zod";

import { PromptAssignmentScope } from "@/generated/prisma/enums";
import {
	noStoreJson,
	promptErrorResponse,
	readJsonBody,
	requireUserId,
} from "@/lib/prompts/api-helpers";
import {
	clearPromptAssignment,
	listPromptAssignments,
	setPromptAssignment,
} from "@/lib/prompts/prompt-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ScopeSchema = z.enum(["WORKSPACE", "CONVERSATION", "AGENT"]);

const AssignSchema = z.object({
	scope: ScopeSchema,
	targetKey: z.string().trim().min(1).max(128),
	promptId: z.string().trim().min(3).max(128),
	promptVersionId: z.string().trim().min(3).max(128).optional(),
	pinnedVersion: z.boolean().optional(),
});

const ClearSchema = z.object({
	scope: ScopeSchema,
	targetKey: z.string().trim().min(1).max(128),
});

export async function GET(): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	try {
		const assignments = await listPromptAssignments(session.userId);
		return noStoreJson({
			assignments: assignments.map((assignment) => ({
				id: assignment.id,
				scope: assignment.scope,
				targetKey: assignment.targetKey,
				pinnedVersion: assignment.pinnedVersion,
				prompt: assignment.prompt,
				promptVersion: assignment.promptVersion,
				updatedAt: assignment.updatedAt,
			})),
		});
	} catch (error) {
		return promptErrorResponse(error, "assignments-list");
	}
}

/**
 * Binds a published prompt version to a runtime surface.
 *
 * Scope is always explicit — assigning to one conversation never changes the
 * workspace default, and assigning to an agent never changes chat.
 */
export async function PUT(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const body = await readJsonBody(req, AssignSchema);
	if (!body.ok) return body.response;

	try {
		const assignment = await setPromptAssignment({
			userId: session.userId,
			scope: body.data.scope as PromptAssignmentScope,
			targetKey: body.data.targetKey,
			promptId: body.data.promptId,
			promptVersionId: body.data.promptVersionId,
			pinnedVersion: body.data.pinnedVersion,
		});
		return noStoreJson({
			assignment: {
				id: assignment.id,
				scope: assignment.scope,
				targetKey: assignment.targetKey,
				promptId: assignment.promptId,
				promptVersionId: assignment.promptVersionId,
				pinnedVersion: assignment.pinnedVersion,
			},
		});
	} catch (error) {
		return promptErrorResponse(error, "assignments-set");
	}
}

export async function DELETE(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const body = await readJsonBody(req, ClearSchema);
	if (!body.ok) return body.response;

	try {
		const result = await clearPromptAssignment(
			session.userId,
			body.data.scope as PromptAssignmentScope,
			body.data.targetKey,
		);
		return noStoreJson(result);
	} catch (error) {
		return promptErrorResponse(error, "assignments-clear");
	}
}
