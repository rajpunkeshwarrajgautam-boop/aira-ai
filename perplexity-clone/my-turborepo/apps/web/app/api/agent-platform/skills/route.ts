import { z } from "zod";
import { auth } from "@/auth";
import { globalSkillsStore } from "@/lib/agents/installable-skills-store";
import { registeredToolIds } from "@/lib/tool-gateway/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

const InstallSkillInputSchema = z.object({
	name: z.string().trim().min(2).max(80),
	description: z.string().trim().max(300),
	instructions: z.string().trim().min(5).max(5_000),
	requiredTools: z.array(z.string()).default([]),
	preferredRoles: z.array(z.string()).default([]),
	keywords: z.array(z.string()).default([]),
	permissions: z.array(z.string()).default([]),
	version: z.string().default("1.0.0"),
	author: z.string().default("custom"),
});

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const skills = await globalSkillsStore.listSkillsAsync(session.user.id);
	return json({ skills });
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const body = await req.json().catch(() => null);
	const parsed = InstallSkillInputSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Invalid skill parameters.", details: parsed.error.format() } }, { status: 400 });
	}

	const registeredTools = new Set<string>(registeredToolIds());
	const unknownTools = parsed.data.requiredTools.filter((tool) => !registeredTools.has(tool));
	if (unknownTools.length > 0) {
		return json(
			{ error: { code: "UNKNOWN_TOOL", message: `Unknown AIRA tool id(s): ${unknownTools.join(", ")}` } },
			{ status: 400 },
		);
	}

	const skill = await globalSkillsStore.installSkillAsync(session.user.id, {
		...parsed.data,
		enabled: true,
	});
	return json({ skill }, { status: 201 });
}
