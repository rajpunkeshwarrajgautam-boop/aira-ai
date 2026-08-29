import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { executeTool } from "@/lib/tool-gateway/gateway";
import { ToolGatewayError } from "@/lib/tool-gateway/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
	userId: z.string().min(1).max(160),
	projectId: z.string().min(8).max(160),
	runId: z.string().min(8).max(160),
	taskId: z.string().min(8).max(160),
	agentId: z.string().min(8).max(160),
	clientRequestId: z.string().trim().min(8).max(160),
	tool: z.enum(["browser", "terminal", "git", "files", "memory", "web", "github", "vercel", "supabase", "mcp"]),
	action: z.string().trim().min(1).max(120),
	input: z.record(z.string(), z.unknown()).default({}),
	approvalId: z.string().min(8).max(160).optional(),
}).strict();

function authorized(req: Request): boolean {
	const expected = process.env.AIRA_TOOL_GATEWAY_TOKEN?.trim();
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

async function agentContextAuthorized(input: {
	readonly userId: string;
	readonly projectId: string;
	readonly runId: string;
	readonly taskId: string;
	readonly agentId: string;
	readonly tool: string;
}): Promise<boolean> {
	const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
		select exists(
			select 1
			from "AgentPlatformRun" r
			join "AgentProject" p on p."id"=r."projectId"
			join "AgentTask" t on t."id"=${input.taskId} and t."runId"=r."id" and t."projectId"=p."id"
			join "AgentInstance" a on a."id"=${input.agentId}
				and a."runId"=r."id" and a."projectId"=p."id" and a."currentTaskId"=t."id"
			where r."id"=${input.runId}
			  and r."projectId"=${input.projectId}
			  and r."userId"=${input.userId}
			  and p."userId"=${input.userId}
			  and r."status" in ('RUNNING','WAITING','APPROVAL_REQUIRED')
			  and t."status" in ('CLAIMED','RUNNING','WAITING','APPROVAL_REQUIRED')
			  and a."status" in ('WORKING','WAITING','PAUSED')
			  and a."allowedTools" @> ${JSON.stringify([input.tool])}::jsonb
		) as ok
	`;
	return Boolean(rows[0]?.ok);
}

export async function POST(req: Request): Promise<Response> {
	if (!authorized(req)) return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized tool-gateway request." } }, { status: 401 });
	if (!["1", "true", "yes", "on"].includes((process.env.AIRA_TOOL_GATEWAY_ENABLED ?? "").trim().toLowerCase())) {
		return json({ error: { code: "TOOL_GATEWAY_DISABLED", message: "AIRA Tool Gateway is disabled." } }, { status: 503 });
	}
	const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) return json({ error: { code: "VALIDATION_ERROR", message: "Tool request is invalid.", details: z.treeifyError(parsed.error) } }, { status: 400 });
	if (!(await agentContextAuthorized(parsed.data))) {
		return json({ error: { code: "AGENT_TOOL_CONTEXT_FORBIDDEN", message: "The active agent/task does not own this tool request or the tool is outside its allowed scope." } }, { status: 403 });
	}
	try {
		const result = await executeTool(
			{
				userId: parsed.data.userId,
				projectId: parsed.data.projectId,
				runId: parsed.data.runId,
				taskId: parsed.data.taskId,
				agentId: parsed.data.agentId,
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
		console.error("[tool-gateway:agent]", error instanceof Error ? error.name : "unknown_error");
		return json({ error: { code: "TOOL_GATEWAY_FAILED", message: "AIRA could not execute this tool request." } }, { status: 500 });
	}
}
