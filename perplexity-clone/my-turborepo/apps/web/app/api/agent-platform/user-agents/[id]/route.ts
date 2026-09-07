import { z } from "zod";
import { auth } from "@/auth";
import { globalUserAgentStore } from "@/lib/agents/user-agents-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

const ModelPolicySchema = z.object({
	provider: z.enum(["AUTO", "OMNIROUTE", "NVIDIA", "OPENAI", "DEERFLOW", "AUTOGPT"]),
	modelId: z.string().optional(),
	temperature: z.number().min(0).max(2),
	maxTokens: z.number().positive(),
}).strict();
const MemoryPolicySchema = z.object({
	enabled: z.boolean(),
	scope: z.enum(["GLOBAL", "PROJECT", "SESSION"]),
}).strict();
const BudgetSchema = z.object({
	maxCostUsd: z.number().min(0),
	maxDurationMinutes: z.number().positive(),
}).strict();
const RiskPolicySchema = z.object({
	requireApprovalAbove: z.enum(["LOW", "MEDIUM", "HIGH", "PROTECTED"]),
}).strict();

// Agent sharing is deliberately excluded here. Shares are authorization-sensitive
// and may only be changed through the enterprise governance endpoint, which verifies
// both agent ownership and ADMIN membership in the target workspace organization.
const UpdateAgentInputSchema = z.object({
	name: z.string().trim().min(2).max(80).optional(),
	description: z.string().trim().max(300).optional(),
	instructions: z.string().trim().min(5).max(10_000).optional(),
	modelPolicy: ModelPolicySchema.optional(),
	tools: z.array(z.string()).optional(),
	skills: z.array(z.string()).optional(),
	connectors: z.array(z.string()).optional(),
	memoryPolicy: MemoryPolicySchema.optional(),
	budget: BudgetSchema.optional(),
	riskPolicy: RiskPolicySchema.optional(),
	avatar: z.string().optional(),
	isPublic: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "Provide at least one editable agent field." });

export async function GET(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { id } = await context.params;
	const agent = await globalUserAgentStore.getAgentAsync(session.user.id, id);
	if (!agent) return json({ error: { code: "NOT_FOUND", message: "Agent not found." } }, { status: 404 });
	return json({ agent });
}

export async function PUT(
	req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { id } = await context.params;
	const parsed = UpdateAgentInputSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Invalid or authorization-sensitive agent update.", details: z.treeifyError(parsed.error) } }, { status: 400 });
	}

	const updated = await globalUserAgentStore.updateAgentAsync(session.user.id, id, parsed.data);
	if (!updated) return json({ error: { code: "NOT_FOUND", message: "Agent not found or unauthorized." } }, { status: 404 });
	return json({ agent: updated });
}

export async function DELETE(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { id } = await context.params;
	const deleted = await globalUserAgentStore.deleteAgentAsync(session.user.id, id);
	if (!deleted) return json({ error: { code: "NOT_FOUND", message: "Agent not found or unauthorized." } }, { status: 404 });
	return json({ deleted: true });
}