"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { cn } from "@/lib/cn";
import styles from "../commerce.module.css";

type CheckoutPlan = "pro" | "team";

function requestedPlanFromLocation(): CheckoutPlan | null {
  if (typeof window === "undefined") return null;
  const requested = new URLSearchParams(window.location.search).get("plan")?.toLowerCase();
  return requested === "pro" || requested === "team" ? requested : null;
}

function loadCashfreeScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Cashfree) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load payment SDK."));
    document.body.appendChild(script);
  });
}

export default function UpgradePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [plan, setPlan] = useState<CheckoutPlan>("pro");
  const [teamSeats, setTeamSeats] = useState(2);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const requested = requestedPlanFromLocation();
    if (requested) setPlan(requested);
  }, []);

  useEffect(() => {
    if (status !== "unauthenticated") return;
    const requested = requestedPlanFromLocation();
    const callbackUrl = requested ? `/upgrade?plan=${requested}` : "/upgrade";
    router.replace(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }, [status, router]);

  const startCheckout = useCallback(async () => {
    if (!session?.user?.email || busy) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          teamSeats: plan === "team" ? teamSeats : undefined,
          customerPhone: phone.trim(),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        subscriptionSessionId?: string;
        cashfreeJsEnv?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? `Checkout failed (${response.status}).`);
      const subsSessionId = body?.subscriptionSessionId;
      const mode = body?.cashfreeJsEnv === "production" ? "production" : "sandbox";
      if (!subsSessionId) throw new Error("Checkout did not return a session.");
      await loadCashfreeScript();
      const cashfree = window.Cashfree?.({ mode });
      if (!cashfree) throw new Error("Payment SDK not available.");
      const result = await cashfree.subscriptionsCheckout({ subsSessionId, redirectTarget: "_self" });
      if (result.error) throw new Error(result.error.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout failed.");
    } finally {
      setBusy(false);
    }
  }, [session?.user?.email, busy, plan, teamSeats, phone]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className={styles.loadingPage}>
        <div className={styles.loadingInner}><span className={styles.spinner} aria-hidden /> Preparing secure checkout…</div>
      </div>
    );
  }

  return (
    <main className={styles.page}>
      <WorkspaceHeader />
      <div className={styles.checkoutContainer}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}><ShieldCheck className="size-3.5" aria-hidden /> Secure checkout</p>
          <h1 className={styles.title}>Upgrade when AIRA is doing more of the work.</h1>
          <p className={styles.description}>
            Choose Pro for individual power use or Team for shared capacity. Subscription checkout is handled by Cashfree through the existing authenticated billing flow.
          </p>
        </header>

        <section className={styles.checkoutCard} aria-label="Choose plan and checkout">
          <div className={styles.segmented} role="group" aria-label="Choose billing plan">
            {(["pro", "team"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPlan(option)}
                aria-pressed={plan === option}
                className={cn(styles.segment, plan === option && styles.segmentSelected)}
              >
                {option === "pro" ? "Pro" : "Team"}
              </button>
            ))}
          </div>

          <div className={styles.summary}>
            <span className={styles.summaryIcon}><Sparkles className="size-4" aria-hidden /></span>
            <div>
              <strong>{plan === "pro" ? "AIRA Pro" : "AIRA Team"}</strong>
              <p>
                {plan === "pro"
                  ? "2,000 searches, Deep Research, and 50 autonomous agent runs per month."
                  : "10,000 searches and 250 agent runs per seat, with centralized team billing."}
              </p>
            </div>
          </div>

          {plan === "team" ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Seats</span>
              <input
                name="teamSeats"
                type="number"
                min={2}
                max={100}
                value={teamSeats}
                onChange={(event) => setTeamSeats(Math.min(100, Math.max(2, Number(event.target.value) || 2)))}
                className={styles.input}
              />
              <span className={styles.help}>Team subscriptions require 2–100 seats.</span>
            </label>
          ) : null}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Phone number</span>
            <input
              name="customerPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="e.g. 9876543210"
              className={styles.input}
            />
            <span className={styles.help}>Required by the subscription checkout provider.</span>
          </label>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          <button
            type="button"
            className={styles.checkoutAction}
            disabled={busy || phone.trim().length < 8}
            onClick={() => void startCheckout()}
          >
            {busy ? "Starting secure checkout…" : `Continue with ${plan === "pro" ? "Pro" : "Team"}`}
          </button>

          <p className={styles.checkoutLinks}>
            <Link href="/pricing">Compare plans</Link>
            <Link href="/">Back to AIRA</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
