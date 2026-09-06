import { z } from "zod";
import { auth } from "@/auth";
import { globalUserProfileStore } from "@/lib/user/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

const UpdateProfileSchema = z.object({
	displayName: z.string().max(80).optional(),
	customInstructions: z.string().max(4000).optional(),
	responseStyle: z.enum(["CONCISE", "BALANCED", "DETAILED", "ACADEMIC"]).optional(),
	defaultEffort: z.enum(["LOW", "MEDIUM", "HIGH", "MAXIMUM"]).optional(),
	autoApproveSafeTools: z.boolean().optional(),
	privacyMode: z.enum(["STANDARD", "STRICT", "EPHEMERAL"]).optional(),
});

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const profile = globalUserProfileStore.getProfile(session.user.id);
	return json({ profile });
}

export async function PUT(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const body = await req.json().catch(() => null);
	const parsed = UpdateProfileSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Invalid profile update payload.", details: parsed.error.format() } }, { status: 400 });
	}

	const updated = globalUserProfileStore.updateProfile(session.user.id, parsed.data);
	return json({ profile: updated });
}
