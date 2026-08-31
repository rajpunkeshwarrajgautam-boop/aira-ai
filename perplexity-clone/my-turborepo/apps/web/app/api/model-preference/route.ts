import { cookies } from "next/headers";
import { z } from "zod";

import { auth } from "@/auth";
import { getEffectiveEntitlements } from "@/lib/billing/plan-enforcement";
import { providerAccessTierForBillingPlan } from "@/lib/billing/provider-policy";
import {
  normalizePreferenceForTier,
  parseProviderPreference,
  PROVIDER_PREFERENCE_COOKIE,
  providerDescriptors,
} from "@services/providers/provider-preference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PreferenceSchema = z.object({
  preference: z.enum(["auto", "openai", "nvidia", "self-hosted"]),
});

async function accessTier() {
  const session = await auth();
  if (!session?.user?.id) return { tier: "free" as const, authenticated: false };
  const entitlements = await getEffectiveEntitlements(session.user.id);
  return {
    tier: providerAccessTierForBillingPlan(entitlements.billingPlan),
    authenticated: true,
  };
}

export async function GET(): Promise<Response> {
  const { tier, authenticated } = await accessTier();
  const cookieStore = await cookies();
  const requested = parseProviderPreference(cookieStore.get(PROVIDER_PREFERENCE_COOKIE)?.value);
  const selected = normalizePreferenceForTier(tier, requested);
  const providers = providerDescriptors(tier);

  return Response.json(
    {
      selected,
      tier,
      authenticated,
      manualSelectionEnabled: tier === "pro",
      providers,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } }, { status: 400 });
  }

  const parsed = PreferenceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Unsupported model preference." } }, { status: 400 });
  }

  const { tier, authenticated } = await accessTier();
  const selected = normalizePreferenceForTier(tier, parsed.data.preference);
  if (selected !== parsed.data.preference && parsed.data.preference !== "auto") {
    return Response.json(
      {
        error: {
          code: tier === "free" ? "PLAN_REQUIRED" : "PROVIDER_UNAVAILABLE",
          message: tier === "free"
            ? "Manual cloud or self-hosted provider selection requires Pro or Team."
            : "That provider is not currently configured or permitted by the active residency policy.",
        },
      },
      { status: tier === "free" ? 403 : 409 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(PROVIDER_PREFERENCE_COOKIE, selected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });

  return Response.json({ selected, tier, authenticated }, { headers: { "Cache-Control": "no-store" } });
}
