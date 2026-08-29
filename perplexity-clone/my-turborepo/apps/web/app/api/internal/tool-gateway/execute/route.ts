import { z } from "zod";

import { executeTool } from "@/lib/tool-gateway/gateway";
import { ToolGatewayError } from "@/lib/tool-gateway/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
	userId: z.string().min(1).max(160),
	projectId: z.string().min(8).max(160),
	runId: z.string().min(8).max(160),
	taskId: z.string().min(8).max(160).optional(),
	agentId: z.string().min(8).max(160).optional(),
	clientRequestId: z.string().trim().min(8).max(160),
	tool: z.enum(["browser", "terminal", "git", "files", "memory", "web", "github", "vercel", "supabase", "mcp"]),
	action: z.string().trim().min(1).max(120),
	input: z.record(z.string(), z.unknown()).default({}),
	approvalId: z.string().min(8).max(160).optional(),
});

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

export async function POST(req: Request): Promise<Response> {
	if (!authorized(req)) return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized tool-gateway request." } }, { status: 401 });
	if (!["1", "true", "yes", "on"].includes((process.env.AIRA_TOOL_GATEWAY_ENABLED ?? "").trim().toLowerCase())) {
		return json({ error: { code: "TOOL_GATEWAY_DISABLED", message: "AIRA Tool Gateway is disabled." } }, { status: 503 });
	}
	const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) return json({ error: { code: "VALIDATION_ERROR", message: "Tool request is invalid.", details: z.treeifyError(parsed.error) } }, { status: 400 });
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
