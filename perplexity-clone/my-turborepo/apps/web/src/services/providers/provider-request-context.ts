import { AsyncLocalStorage } from "node:async_hooks";

import type { ProviderPreference } from "./provider-preference";

const preferenceContext = new AsyncLocalStorage<ProviderPreference>();

export function runWithProviderPreference<T>(
  preference: ProviderPreference,
  task: () => T,
): T {
  return preferenceContext.run(preference, task);
}

export function currentProviderPreference(): ProviderPreference {
  return preferenceContext.getStore() ?? "auto";
}
