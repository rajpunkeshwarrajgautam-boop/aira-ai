import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePreferenceForTier,
  parseProviderPreference,
  preferredProviderId,
  providerDescriptors,
} from "../src/services/providers/provider-preference";
import {
  currentProviderPreference,
  runWithProviderPreference,
} from "../src/services/providers/provider-request-context";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "NVIDIA_API_KEY",
  "OPENAI_CHAT_MODEL",
  "NVIDIA_CHAT_MODEL",
  "VIREXA_LOCAL_AI_ENABLED",
  "SELF_HOSTED_LLM_BASE_URL",
  "SELF_HOSTED_LLM_API_KEY",
  "SELF_HOSTED_LLM_MODEL",
  "AIRA_DATA_RESIDENCY_ENFORCED",
] as const;

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("provider preference parser fails closed to auto", () => {
  assert.equal(parseProviderPreference(undefined), "auto");
  assert.equal(parseProviderPreference("unknown"), "auto");
  assert.equal(parseProviderPreference("openai"), "openai");
});

test("free tier cannot select paid providers", () => {
  withEnv({ OPENAI_API_KEY: "test", NVIDIA_API_KEY: "test", AIRA_DATA_RESIDENCY_ENFORCED: "false" }, () => {
    assert.equal(normalizePreferenceForTier("free", "openai"), "auto");
    assert.equal(preferredProviderId("free", "openai"), undefined);
    assert.equal(normalizePreferenceForTier("free", "nvidia"), "nvidia");
    assert.equal(preferredProviderId("free", "nvidia"), "nvidia");
  });
});

test("pro tier only exposes configured residency-allowed providers", () => {
  withEnv({
    OPENAI_API_KEY: "test-openai",
    NVIDIA_API_KEY: "test-nvidia",
    OPENAI_CHAT_MODEL: "gpt-test",
    NVIDIA_CHAT_MODEL: "nvidia-test",
    AIRA_DATA_RESIDENCY_ENFORCED: "false",
  }, () => {
    const rows = providerDescriptors("pro");
    const openai = rows.find((row) => row.id === "openai");
    const nvidia = rows.find((row) => row.id === "nvidia");
    const local = rows.find((row) => row.id === "self-hosted");
    assert.equal(openai?.selectable, true);
    assert.equal(openai?.model, "gpt-test");
    assert.equal(nvidia?.selectable, true);
    assert.equal(local?.selectable, false);
  });
});

test("request-scoped preference does not leak between async contexts", async () => {
  assert.equal(currentProviderPreference(), "auto");
  const selected = await runWithProviderPreference("openai", async () => {
    await Promise.resolve();
    return currentProviderPreference();
  });
  assert.equal(selected, "openai");
  assert.equal(currentProviderPreference(), "auto");
});
