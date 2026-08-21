import { z } from "zod";

import { auth } from "@/auth";
import { assertSafetyAllowed } from "@services/safety/safety-gateway";
import { ProviderRouter } from "@services/providers/provider-router";
import { OpenAIProvider } from "@services/providers/openai-provider";
import { NVIDIAProvider } from "@services/providers/nvidia-provider";
import { SelfHostedProvider } from "@services/providers/self-hosted-provider";
import { getLocalAiConfigOrDisabled } from "@services/local-ai/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ProviderId = "openai" | "nvidia" | "self-hosted";

const CompareSchema = z.object({
  prompt: z.string().trim().min(2).max(12000),
  providers: z.array(z.enum(["openai", "nvidia", "self-hosted"])).min(2).max(3),
});

function descriptors() {
  const local = getLocalAiConfigOrDisabled();
  return [
    {
      id: "openai" as const,
      label: "OpenAI",
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
    },
    {
      id: "nvidia" as const,
      label: "NVIDIA",
      configured: Boolean(process.env.NVIDIA_API_KEY),
      model: process.env.NVIDIA_CHAT_MODEL ?? "meta/llama-3.1-70b-instruct",
    },
    {
      id: "self-hosted" as const,
      label: "Virexa Local",
      configured: local.configured,
      model: local.model || "Local model",
    },
  ];
}

function createRouter(id: ProviderId): ProviderRouter | null {
  const router = new ProviderRouter(id, id);
  if (id === "openai" && process.env.OPENAI_API_KEY) {
    router.registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY));
    return router;
  }
  if (id === "nvidia" && process.env.NVIDIA_API_KEY) {
    router.registerProvider(new NVIDIAProvider(process.env.NVIDIA_API_KEY));
    return router;
  }
  if (id === "self-hosted") {
    const local = getLocalAiConfigOrDisabled();
    if (!local.configured) return null;
    router.registerProvider(
      new SelfHostedProvider({
        baseURL: local.baseURL,
        apiKey: local.apiKey,
        model: local.model,
      }),
    );
    return router;
  }
  return null;
}

async function runProvider(providerId: ProviderId, prompt: string) {
  const router = createRouter(providerId);
  if (!router) return { providerId, ok: false as const, error: "Provider is not configured." };
  try {
    let text = "";
    const startedAt = Date.now();
    for await (const delta of router.streamChat(
      [
        {
          role: "system",
          content:
            "You are participating in AIRA's model comparison workspace. Answer the user's prompt directly and independently. Do not claim web access unless the prompt itself provides sources. Prefer accuracy, explicit uncertainty, and useful structure.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.2, maxCompletionTokens: 1600 },
    )) {
      text += delta;
    }
    return { providerId, ok: true as const, text, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      providerId,
      ok: false as const,
      error: error instanceof Error ? error.message.slice(0, 320) : "Provider request failed.",
    };
  }
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  }
  return Response.json({ providers: descriptors() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } }, { status: 400 });
  }
  const parsed = CompareSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Choose at least two configured providers and enter a prompt." } }, { status: 400 });
  }
  await assertSafetyAllowed("input", parsed.data.prompt);
  const unique = [...new Set(parsed.data.providers)] as ProviderId[];
  const results = await Promise.all(unique.map((providerId) => runProvider(providerId, parsed.data.prompt)));
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
