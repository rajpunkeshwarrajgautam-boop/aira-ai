import { getLocalAiConfigOrDisabled } from "@services/local-ai/config";
import { providerAllowedByResidency } from "./residency-policy";
import type { ProviderAccessTier } from "./provider-selection";

export const PROVIDER_PREFERENCE_COOKIE = "aira-provider-preference";

export type ProviderPreference = "auto" | "openai" | "nvidia" | "self-hosted";
export type SelectableProviderId = Exclude<ProviderPreference, "auto">;

export interface ProviderDescriptor {
  readonly id: SelectableProviderId;
  readonly label: string;
  readonly model: string;
  readonly configured: boolean;
  readonly residencyAllowed: boolean;
  readonly selectable: boolean;
}

const PREFERENCES = new Set<ProviderPreference>(["auto", "openai", "nvidia", "self-hosted"]);

export function parseProviderPreference(value: string | null | undefined): ProviderPreference {
  return value && PREFERENCES.has(value as ProviderPreference) ? (value as ProviderPreference) : "auto";
}

export function providerDescriptors(tier: ProviderAccessTier): readonly ProviderDescriptor[] {
  const local = getLocalAiConfigOrDisabled();
  const rows: readonly Omit<ProviderDescriptor, "residencyAllowed" | "selectable">[] = [
    {
      id: "openai",
      label: "OpenAI",
      model: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
      configured: Boolean(process.env.OPENAI_API_KEY),
    },
    {
      id: "nvidia",
      label: "NVIDIA",
      model: process.env.NVIDIA_CHAT_MODEL ?? "meta/llama-3.1-70b-instruct",
      configured: Boolean(process.env.NVIDIA_API_KEY),
    },
    {
      id: "self-hosted",
      label: "Local / self-hosted",
      model: local.model || "Local model",
      configured: local.configured,
    },
  ];

  return rows.map((row) => {
    const residencyAllowed = providerAllowedByResidency(row.id);
    const planAllowed = tier === "pro" || row.id === "nvidia";
    return {
      ...row,
      residencyAllowed,
      selectable: row.configured && residencyAllowed && planAllowed,
    };
  });
}

export function normalizePreferenceForTier(
  tier: ProviderAccessTier,
  requested: ProviderPreference,
): ProviderPreference {
  if (requested === "auto") return "auto";
  if (tier === "free" && requested !== "nvidia") return "auto";
  const descriptor = providerDescriptors(tier).find((row) => row.id === requested);
  return descriptor?.selectable ? requested : "auto";
}

export function preferredProviderId(
  tier: ProviderAccessTier,
  requested: ProviderPreference,
): SelectableProviderId | undefined {
  const normalized = normalizePreferenceForTier(tier, requested);
  return normalized === "auto" ? undefined : normalized;
}
