import { z } from "zod";

import { runtimeHasControlledTools } from "@/lib/agent-runtime/tool-bridge";
import type { AgentRuntimeId } from "@/lib/agent-runtime/types";
import { prisma } from "@/lib/prisma";
import { executeTool } from "@/lib/tool-gateway/gateway";
import { ToolGatewayError } from "@/lib/tool-gateway/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
	taskId: z.string().min(8).max(160),
	clientRequestId: z.string().trim().min(8).max(160),
	tool: z.enum(["browser", "terminal", "git", "files", "memory", "web", "github", "vercel", "supabase", "mcp"]),
	action: z.string().trim().min(1).max(120),
	input: z.record(z.string(), z.unknown()).default({}),
	approvalId: z.string().min(8).max(160).optional(),
});

type RuntimeTaskContext = {
	readonly userId: string;
	readonly projectId: string;
	readonly runId: string;
	readonly taskId: string;
	readonly agentId: string | null;
	readonly runtime: string | null;
	readonly toolAllowed: boolean;
};

function authorized(req: Request): boolean {
	// Runtime workers receive a dedicated restricted credential. They never share
	// the broader internal Tool Gateway token used by other trusted AIRA services.
	const expected = process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN?.trim();
	if (!expected || expected.length < 24) return false;
	const authorization = req.headers.get("authorization") ?? "";
	if (!authorization.toLowerCase().startsWith("bearer ")) return false;
	const supplied = authorization.slice(7).trim();
	if (supplied.length !== expected.length) return false;
	let mismatch = 0;
	for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
	return mismatch === 0;
}

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

async function resolveTaskContext(taskId: string, tool: string): Promise<RuntimeTaskContext | null> {
	const rows = await prisma.$queryRaw<RuntimeTaskContext[]>`
		select
			r."userId" as "userId",
			t."projectId" as "projectId",
			t."runId" as "runId",
			t."id" as "taskId",
			a."id" as "agentId",
			r."runtime" as "runtime",
			coalesce(a."allowedTools" @> ${JSON.stringify([tool])}::jsonb, false) as "toolAllowed"
		from "AgentTask" t
		join "AgentPlatformRun" r on r."id"=t."runId" and r."projectId"=t."projectId"
		left join lateral (
			select i."id", i."allowedTools"
			from "AgentInstance" i
			where i."currentTaskId"=t."id"
			  and i."runId"=t."runId"
			  and i."projectId"=t."projectId"
			  and i."status" in ('WORKING','WAITING','PAUSED')
			order by i."createdAt" desc
			limit 1
		) a on true
		where t."id"=${taskId}
		  and t."status" in ('CLAIMED','RUNNING','WAITING','APPROVAL_REQUIRED')
		  and r."status" in ('RUNNING','WAITING','APPROVAL_REQUIRED')
		limit 1
	`;
	return rows[0] ?? null;
}

/**
 * Trusted runtime bridge endpoint.
 *
 * Remote runtime workers keep AIRA_RUNTIME_TOOL_GATEWAY_TOKEN in their server
 * process; the model sees only taskId/workspace identifiers. AIRA resolves
 * ownership and the active agent server-side and enforces that agent's
 * allowedTools before the regular Tool Gateway performs risk, approval,
 * idempotency and budget checks.
 */
export async function POST(req: Request): Promise<Response> {
	if (!authorized(req)) return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized runtime tool request." } }, { status: 401 });
	if (!["1", "true", "yes", "on"].includes((process.env.AIRA_TOOL_GATEWAY_ENABLED ?? "").trim().toLowerCase())) {
		return json({ error: { code: "TOOL_GATEWAY_DISABLED", message: "AIRA Tool Gateway is disabled." } }, { status: 503 });
	}
	const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) return json({ error: { code: "VALIDATION_ERROR", message: "Runtime tool request is invalid.", details: z.treeifyError(parsed.error) } }, { status: 400 });
	const context = await resolveTaskContext(parsed.data.taskId, parsed.data.tool);
	if (!context || !context.agentId) return json({ error: { code: "RUNTIME_TASK_NOT_ACTIVE", message: "No active AIRA agent owns this task." } }, { status: 409 });
	if (!context.runtime || !runtimeHasControlledTools(context.runtime as AgentRuntimeId)) {
		return json({ error: { code: "RUNTIME_TOOL_BRIDGE_NOT_TRUSTED", message: "This runtime is not configured for AIRA-controlled tools." } }, { status: 403 });
	}
	if (!context.toolAllowed) return json({ error: { code: "AGENT_TOOL_NOT_ALLOWED", message: "This specialist is not authorized to use the requested tool." } }, { status: 403 });
	try {
		const result = await executeTool(
			{
				userId: context.userId,
				projectId: context.projectId,
				runId: context.runId,
				taskId: context.taskId,
				agentId: context.agentId,
				source: "AGENT",
			},
			{
				clientRequestId: parsed.data.clientRequestId,
				tool: parsed.data.tool,
				action: parsed.data.action,
				input: parsed.data.input,
				approvalId: parsed.data.approvalId,
			},
		);
		return json(result, { status: result.status === "APPROVAL_REQUIRED" ? 202 : result.status === "DENIED" ? 403 : 200 });
	} catch (error) {
		if (error instanceof ToolGatewayError) return json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, { status: error.status });
		console.error("[tool-gateway:runtime]", error instanceof Error ? error.name : "unknown_error");
		return json({ error: { code: "TOOL_GATEWAY_FAILED", message: "AIRA could not execute this runtime tool request." } }, { status: 500 });
	}
}
