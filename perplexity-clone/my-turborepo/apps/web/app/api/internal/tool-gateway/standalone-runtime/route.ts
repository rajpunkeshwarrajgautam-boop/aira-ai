import { z } from "zod";

import { globalUserAgentStore } from "@/lib/agents/user-agents-store";
import { prisma } from "@/lib/prisma";
import { executeTool } from "@/lib/tool-gateway/gateway";
import { ToolGatewayError } from "@/lib/tool-gateway/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
	runId: z.string().min(8).max(160),
	clientRequestId: z.string().trim().min(8).max(160),
	tool: z.enum(["browser", "terminal", "git", "files", "memory", "web", "github", "vercel", "supabase", "mcp"]),
	action: z.string().trim().min(1).max(120),
	input: z.record(z.string(), z.unknown()).default({}),
	approvalId: z.string().min(8).max(160).optional(),
});

function authorized(req: Request): boolean {
	const expected = process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN?.trim();
	if (!expected || expected.length < 24) return false;
	const authorization = req.headers.get("authorization") ?? "";
	if (!authorization.toLowerCase().startsWith("bearer ")) return false;
	const supplied = authorization.slice(7).trim();
	if (supplied.length !== expected.length) return false;
	let mismatch = 0;
	for (let index = 0; index < expected.length; index += 1) {
		mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
	}
	return mismatch === 0;
}

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

/**
 * Standalone Runtime Tool Gateway Bridge Endpoint
 *
 * Receives tool execution requests from standalone agent execution runtimes (e.g. DeerFlow)
 * authenticated via AIRA_RUNTIME_TOOL_GATEWAY_TOKEN.
 *
 * Resolves AgentRun -> userId -> graphId -> AgentDefinition -> AgentDefinition.tools server-side.
 * Does NOT trust client-supplied userId, agentDefinitionId, or allowedTools.
 */
export async function POST(req: Request): Promise<Response> {
	if (!authorized(req)) {
		return json(
			{ error: { code: "UNAUTHORIZED", message: "Unauthorized runtime tool request." } },
			{ status: 401 },
		);
	}

	if (
		!["1", "true", "yes", "on"].includes(
			(process.env.AIRA_TOOL_GATEWAY_ENABLED ?? "").trim().toLowerCase(),
		)
	) {
		return json(
			{ error: { code: "TOOL_GATEWAY_DISABLED", message: "AIRA Tool Gateway is disabled." } },
			{ status: 503 },
		);
	}

	const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) {
		return json(
			{
				error: {
					code: "VALIDATION_ERROR",
					message: "Standalone runtime tool request is invalid.",
					details: z.treeifyError(parsed.error),
				},
			},
			{ status: 400 },
		);
	}

	const { runId, clientRequestId, tool, action, input, approvalId } = parsed.data;

	// Server-side resolution of AgentRun
	let runRow: { id: string; userId: string; graphId: string; status: string } | null = null;
	try {
		runRow = await prisma.agentRun.findUnique({
			where: { id: runId },
			select: { id: true, userId: true, graphId: true, status: true },
		});
	} catch (err) {
		console.error("[standalone-runtime] AgentRun DB lookup failed:", err);
		return json(
			{
				error: {
					code: "AGENT_TOOL_AUTHORIZATION_UNAVAILABLE",
					message: "Database error resolving AgentRun authorization.",
				},
			},
			{ status: 500 },
		);
	}

	if (!runRow) {
		return json(
			{ error: { code: "AGENT_RUN_NOT_FOUND", message: "AgentRun not found." } },
			{ status: 404 },
		);
	}

	if (!["RUNNING", "WAITING", "APPROVAL_REQUIRED"].includes(runRow.status)) {
		return json(
			{ error: { code: "AGENT_RUN_NOT_ACTIVE", message: "AgentRun is not in an active state." } },
			{ status: 409 },
		);
	}

	let agentDefId = "";
	if (runRow.graphId.startsWith("agent-def:")) {
		agentDefId = runRow.graphId.slice("agent-def:".length);
	} else {
		return json(
			{
				error: {
					code: "INVALID_AGENT_RUN_BINDING",
					message: "AgentRun is not bound to a valid AgentDefinition.",
				},
			},
			{ status: 400 },
		);
	}

	// Server-side resolution of AgentDefinition & allowlist
	let agentDef = null;
	try {
		agentDef = await globalUserAgentStore.getAgentAsync(runRow.userId, agentDefId);
	} catch (err) {
		console.error("[standalone-runtime] AgentDefinition store lookup failed:", err);
		return json(
			{
				error: {
					code: "AGENT_TOOL_AUTHORIZATION_UNAVAILABLE",
					message: "Store error resolving AgentDefinition.",
				},
			},
			{ status: 500 },
		);
	}

	if (!agentDef || agentDef.userId !== runRow.userId) {
		return json(
			{
				error: {
					code: "AGENT_DEFINITION_DENIED",
					message: "AgentDefinition ownership check failed.",
				},
			},
			{ status: 403 },
		);
	}

	const allowedTools = agentDef.tools ?? [];
	if (!allowedTools.includes(tool)) {
		return json(
			{
				error: {
					code: "AGENT_TOOL_NOT_ALLOWED",
					message: `Tool "${tool}" is not allowed by AgentDefinition policy allowlist [${allowedTools.join(", ")}].`,
				},
			},
			{ status: 403 },
		);
	}

	// Execute tool via authoritative Tool Gateway
	try {
		const result = await executeTool(
			{
				userId: runRow.userId,
				projectId: "standalone",
				runId: runRow.id,
				taskId: `standalone-${runRow.id}`,
				agentId: agentDefId,
				source: "AGENT",
			},
			{
				clientRequestId,
				tool,
				action: action as Parameters<typeof executeTool>[1]["action"],
				input,
				approvalId,
			},
		);

		return json({ result });
	} catch (err) {
		console.error("[standalone-runtime execution error]:", err);
		if (err instanceof ToolGatewayError) {
			return json(
				{ error: { code: err.code, message: err.message, retryable: err.retryable } },
				{ status: err.status },
			);
		}
		return json(
			{
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: err instanceof Error ? err.message : String(err),
				},
			},
			{ status: 500 },
		);
	}
}
