import { auth } from "@/auth";
import { globalConnectorRegistry, PluginPackageSchema } from "@/lib/connectors/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	const connectors = globalConnectorRegistry.list();
	const plugins = globalConnectorRegistry.listPluginsForUser(session.user.id);

	return json({
		connectors,
		plugins,
		summary: {
			totalConnectors: connectors.length,
			configuredCount: connectors.filter((c) => c.isConfigured).length,
			enabledCount: connectors.filter((c) => c.isEnabled).length,
			totalPlugins: plugins.length,
		},
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	try {
		const body = await req.json();
		const plugin = PluginPackageSchema.parse(body);
		globalConnectorRegistry.installPluginForUser(session.user.id, plugin);
		return json({ success: true, plugin }, { status: 201 });
	} catch (error) {
		return json(
			{
				error: {
					code: "INVALID_PLUGIN_PACKAGE",
					message: error instanceof Error ? error.message : "Invalid plugin package format.",
				},
			},
			{ status: 400 },
		);
	}
}
