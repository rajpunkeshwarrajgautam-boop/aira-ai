import { noStoreJson, promptErrorResponse, requireUserId } from "@/lib/prompts/api-helpers";
import { installStarterPack } from "@/lib/prompts/prompt-registry";
import { AIRA_STARTER_TEMPLATES } from "@services/prompt/prompt-starter-pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	return noStoreJson({
		templates: AIRA_STARTER_TEMPLATES.map((template) => ({
			slug: template.slug,
			name: template.name,
			description: template.description,
			category: template.category,
			tags: template.tags,
		})),
	});
}

/** Explicit, idempotent install. Nothing is seeded without this call. */
export async function POST(): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	try {
		return noStoreJson(await installStarterPack(session.userId));
	} catch (error) {
		return promptErrorResponse(error, "starter-pack");
	}
}
