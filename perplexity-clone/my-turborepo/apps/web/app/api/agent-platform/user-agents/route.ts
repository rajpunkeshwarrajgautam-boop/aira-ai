import { z } from "zod";
import { auth } from "@/auth";
import { globalUserAgentStore } from "@/lib/agents/user-agents-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

const CreateAgentInputSchema = z.object({
	name: z.string().trim().min(2).max(80),
	description: z.string().trim().max(300).default(""),
	instructions: z.string().trim().min(5).max(10_000),
	modelPolicy: z.object({
		provider: z.enum(["AUTO", "OMNIROUTE", "NVIDIA", "OPENAI", "DEERFLOW", "AUTOGPT"]).default("AUTO"),
		modelId: z.string().optional(),
		temperature: z.number().min(0).max(2).default(0.7),
		maxTokens: z.number().positive().default(4096),
	}).default({ provider: "AUTO", temperature: 0.7, maxTokens: 4096 }),
	tools: z.array(z.string()).default([]),
	skills: z.array(z.string()).default([]),
	memoryPolicy: z.object({
		enabled: z.boolean().default(true),
		scope: z.enum(["GLOBAL", "PROJECT", "SESSION"]).default("PROJECT"),
	}).default({ enabled: true, scope: "PROJECT" }),
	budget: z.object({
		maxCostUsd: z.number().min(0).default(10),
		maxDurationMinutes: z.number().positive().default(30),
	}).default({ maxCostUsd: 10, maxDurationMinutes: 30 }),
	riskPolicy: z.object({
		requireApprovalAbove: z.enum(["LOW", "MEDIUM", "HIGH", "PROTECTED"]).default("MEDIUM"),
	}).default({ requireApprovalAbove: "MEDIUM" }),
	avatar: z.string().optional(),
	isPublic: z.boolean().default(false),
});

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const agents = await globalUserAgentStore.listAgentsAsync(session.user.id);
	return json({ agents });
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const body = await req.json().catch(() => null);
	const parsed = CreateAgentInputSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Invalid agent creation parameters.", details: parsed.error.format() } }, { status: 400 });
	}

	const agent = await globalUserAgentStore.createAgentAsync(session.user.id, parsed.data);
	return json({ agent }, { status: 201 });
}
