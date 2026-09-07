import { auth } from "@/auth";
import { globalArtifactEngine } from "@/lib/artifacts/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}

	const { id } = await context.params;
	const url = new URL(req.url);
	const versionParam = url.searchParams.get("version");
	const version = versionParam ? Number.parseInt(versionParam, 10) : undefined;

	try {
		const { buffer, mimeType, checksum, name } = await globalArtifactEngine.getArtifactBufferAsync(
			session.user.id,
			id,
			version,
		);

		return new Response(new Uint8Array(buffer), {
			status: 200,
			headers: {
				"Content-Type": mimeType,
				"Content-Length": String(buffer.length),
				"Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
				"ETag": `"${checksum}"`,
				"Cache-Control": "private, no-cache",
			},
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return Response.json(
			{ error: { code: "NOT_FOUND", message } },
			{ status: 404 },
		);
	}
}
