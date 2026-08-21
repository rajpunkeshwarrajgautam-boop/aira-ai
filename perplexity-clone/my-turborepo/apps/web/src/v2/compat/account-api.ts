export interface BillingStatus {
  readonly billingPlan: string;
  readonly teamSeats: number;
  readonly monthlySearchLimit: number;
  readonly searchesUsed: number;
  readonly searchesRemaining: number;
  readonly monthlyAgentRunLimit: number;
  readonly agentRunsUsed: number;
  readonly agentRunsRemaining: number;
}

interface ApiErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return body?.error?.message ?? fallback;
}

export async function getBillingStatus(): Promise<BillingStatus> {
  const response = await fetch("/api/billing/status", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Billing status failed (${response.status}).`));
  }
  return (await response.json()) as BillingStatus;
}

export async function createShareLink(input: {
  readonly conversationId: string;
  readonly messageId: string;
}): Promise<string> {
  const response = await fetch("/api/share", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => null)) as
    | { readonly url?: string; readonly error?: { readonly message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Share failed (${response.status}).`);
  }
  if (!payload?.url || typeof payload.url !== "string") {
    throw new Error("AIRA returned an invalid share link.");
  }
  return payload.url;
}
