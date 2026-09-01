import { auth } from "@/auth";
import { listKnowledgeAssets } from "@/lib/knowledge-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
      { status: 401 },
    );
  }
  if (process.env.MULTIMODAL_INGESTION_ENABLED !== "true") {
    return Response.json(
      {
        error: {
          code: "MULTIMODAL_INGESTION_DISABLED",
          message: "Uploaded knowledge ingestion is not enabled on this deployment.",
        },
      },
      { status: 503 },
    );
  }

  const rows = await listKnowledgeAssets(session.user.id, 100);
  const assets = rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return Response.json(
    { assets },
    { headers: { "Cache-Control": "no-store" } },
  );
}
