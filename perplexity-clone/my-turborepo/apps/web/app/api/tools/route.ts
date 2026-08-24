import { auth } from "@/auth";
import { getPublicToolDescriptors } from "@/lib/agents/tools/tool-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401, headers: { "Cache-Control": "no-store" } },
		);
	}

	return Response.json(
		{
			tools: await getPublicToolDescriptors(),
			permissionPolicy: {
				modes: ["auto", "ask", "plan_only"],
				auto: "Read-only tools may run automatically; side-effecting and privileged tools still require approval.",
				ask: "Every tool invocation requires explicit approval.",
				plan_only: "No tool executes directly; AIRA stops at a plan/approval boundary.",
			},
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}
