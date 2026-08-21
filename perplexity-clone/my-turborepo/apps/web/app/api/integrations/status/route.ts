import { auth } from "@/auth";
import { isAutoGptConfigured, isAutoGptEnabled } from "@/lib/autogpt/config";
import { isDeerFlowConfigured, isDeerFlowEnabled } from "@/lib/deerflow/config";
import { knowledgeStorageConfigured } from "@/lib/foundation-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function item(id: string, label: string, configured: boolean, detail: string, model?: string) {
  return { id, label, configured, detail, ...(model ? { model } : {}) };
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  }

  const integrations = [
    item("openai", "OpenAI", Boolean(process.env.OPENAI_API_KEY), "Cloud model provider", process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini"),
    item("nvidia", "NVIDIA", Boolean(process.env.NVIDIA_API_KEY), "Cloud fallback/provider", process.env.NVIDIA_CHAT_MODEL ?? "meta/llama-3.1-70b-instruct"),
    item(
      "self-hosted",
      "Self-hosted LLM",
      Boolean(process.env.SELF_HOSTED_LLM_BASE_URL?.trim() && process.env.SELF_HOSTED_LLM_API_KEY?.trim() && process.env.SELF_HOSTED_LLM_MODEL?.trim()),
      "OpenAI-compatible local or private endpoint",
      process.env.SELF_HOSTED_LLM_MODEL ?? undefined,
    ),
    item("exa", "Exa Search", Boolean(process.env.EXA_API_KEY), "Live web retrieval and citations"),
    item(
      "knowledge",
      "Knowledge ingestion",
      process.env.MULTIMODAL_INGESTION_ENABLED === "true" && knowledgeStorageConfigured() && Boolean(process.env.AIRA_KNOWLEDGE_WORKER_TOKEN?.trim()),
      "Files, PDFs and multimodal ingestion",
    ),
    item("deerflow", "DeerFlow", isDeerFlowEnabled() && isDeerFlowConfigured(), "Long-horizon autonomous agent runtime"),
    item("autogpt", "AutoGPT", isAutoGptEnabled() && isAutoGptConfigured(), "Autonomous agent fallback/runtime"),
    item("google-oauth", "Google OAuth", Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET), "Google sign-in"),
  ];

  return Response.json(
    {
      integrations,
      defaults: {
        primaryProvider: process.env.DEFAULT_PRO_PROVIDER ?? "openai",
        fallbackProvider: process.env.DEFAULT_FREE_PROVIDER ?? "nvidia",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
