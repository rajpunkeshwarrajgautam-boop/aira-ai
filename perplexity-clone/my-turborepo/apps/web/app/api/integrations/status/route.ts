import { auth } from "@/auth";
import { isAutoGptConfigured, isAutoGptEnabled } from "@/lib/autogpt/config";
import { isDeerFlowConfigured, isDeerFlowEnabled } from "@/lib/deerflow/config";
import { knowledgeStorageConfigured } from "@/lib/foundation-storage";
import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import { DEFAULT_NVIDIA_MODEL } from "@services/providers/nvidia-provider";

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

  const omniRoute = getOmniRouteConfigOrDisabled();
  const integrations = [
    item(
      "omniroute",
      "OmniRoute",
      omniRoute.configured,
      "OpenAI-compatible smart routing gateway with automatic provider selection and fallback",
      omniRoute.model,
    ),
    item("openai", "OpenAI", Boolean(process.env.OPENAI_API_KEY), "Direct cloud model provider", process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini"),
    item("nvidia", "NVIDIA", Boolean(process.env.NVIDIA_API_KEY), "Direct cloud fallback/provider", process.env.NVIDIA_CHAT_MODEL ?? DEFAULT_NVIDIA_MODEL),
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
        primaryProvider: process.env.DEFAULT_PRO_PROVIDER ?? "omniroute",
        fallbackProvider: process.env.DEFAULT_FREE_PROVIDER ?? "nvidia",
        omniRouteModel: omniRoute.model,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
