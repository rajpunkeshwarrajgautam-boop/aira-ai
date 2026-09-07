import { auth } from "@/auth";
import { globalAutomationEngine } from "@/lib/automation/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { idempotencyKey?: string; approvalId?: string; runId?: string };
  try {
    const run = await globalAutomationEngine.executeWorkflow(id, session.user.id, {
      idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
      ...(body.approvalId ? { approvalId: body.approvalId } : {}),
      ...(body.runId ? { runId: body.runId } : {}),
    });
    return json({ run });
  } catch (error) {
    return json({ error: { code: "WORKFLOW_EXECUTION_FAILED", message: error instanceof Error ? error.message : "Workflow execution failed." } }, { status: 400 });
  }
}
