"use client";

import { Check, Crown, Shield, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { cn } from "@/lib/cn";
import styles from "../commerce.module.css";

interface PricingPlan {
  readonly name: "Free" | "Pro" | "Team";
  readonly price: string;
  readonly priceNote?: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly icon: LucideIcon;
  readonly highlight?: boolean;
  readonly eyebrow: string;
}

type BillingPlan = "FREE" | "PRO" | "TEAM";

const PLANS: readonly PricingPlan[] = [
  {
    name: "Free",
    price: "$0",
    eyebrow: "Explore",
    description: "For everyday questions, grounded research, persistent conversations and user-controlled memory.",
    features: ["250 searches per month", "Standard search", "Grounded citations", "Persistent conversation history", "Memory controls"],
    icon: Zap,
  },
  {
    name: "Pro",
    price: "$20",
    eyebrow: "Go deeper",
    description: "For individual power users who rely on AIRA for deeper research and autonomous work.",
    features: ["2,000 searches per month", "Deep Research", "50 autonomous agent tasks", "Advanced citation ranking", "Priority support"],
    icon: Crown,
    highlight: true,
  },
  {
    name: "Team",
    price: "$15",
    priceNote: "per user / month",
    eyebrow: "Operate together",
    description: "For teams that need shared capacity, centralized billing and higher operational limits.",
    features: ["10,000 searches per seat", "250 agent tasks per seat", "Centralized billing", "Team-wide research history", "Admin controls"],
    icon: Shield,
  },
];

function planKey(name: PricingPlan["name"]): BillingPlan {
  return name.toUpperCase() as BillingPlan;
}

export default function PricingPage() {
  const { status: sessionStatus } = useSession();
  const [activePlan, setActivePlan] = useState<BillingPlan | null>(null);
  const [checkingPlan, setCheckingPlan] = useState(false);

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      setActivePlan(null);
      setCheckingPlan(false);
      return;
    }
    let cancelled = false;
    setCheckingPlan(true);
    void fetch("/api/billing/status", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load billing status.");
        const body = (await response.json()) as { billingPlan?: string };
        if (!cancelled && ["FREE", "PRO", "TEAM"].includes(body.billingPlan ?? "")) {
          setActivePlan(body.billingPlan as BillingPlan);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCheckingPlan(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionStatus]);

  return (
    <main className={styles.page}>
      <WorkspaceHeader />
      <div className={styles.container}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}><Shield className="size-3.5" aria-hidden /> Plans</p>
          <h1 className={styles.title}>Choose the AIRA capacity you actually need.</h1>
          <p className={styles.description}>
            Start free, then upgrade when deeper research, higher usage or autonomous execution is saving enough time to justify it.
          </p>
        </header>

        <div className={styles.planGrid}>
          {PLANS.map((plan) => {
            const Icon = plan.icon;
            const key = planKey(plan.name);
            const isCurrent = activePlan === key;
            const checkoutHref = plan.name === "Team" ? "/upgrade?plan=team" : "/upgrade?plan=pro";
            const checking = sessionStatus === "loading" || (sessionStatus === "authenticated" && checkingPlan);

            return (
              <section key={plan.name} className={cn(styles.plan, plan.highlight && styles.featured)} aria-label={`${plan.name} plan`}>
                <div className={styles.planTop}>
                  <span className={styles.planIcon}><Icon className="size-4" aria-hidden /></span>
                  {plan.highlight ? <span className={styles.badge}>Recommended</span> : null}
                </div>
                <p className={styles.planEyebrow}>{plan.eyebrow}</p>
                <h2 className={styles.planName}>{plan.name}</h2>
                <p className={styles.planDescription}>{plan.description}</p>
                <div className={styles.priceRow}>
                  <span className={styles.price}>{plan.price}</span>
                  {plan.name !== "Free" ? <span className={styles.pricePeriod}>/ month</span> : null}
                </div>
                {plan.priceNote ? <p className={styles.priceNote}>{plan.priceNote}</p> : null}

                <ul className={styles.featureList}>
                  {plan.features.map((feature) => (
                    <li key={feature} className={styles.featureItem}>
                      <Check className={styles.check} strokeWidth={2} aria-hidden />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {checking ? (
                  <span className={styles.disabledCta} aria-live="polite">Checking plan…</span>
                ) : isCurrent ? (
                  <span className={styles.disabledCta}>Current plan</span>
                ) : plan.name === "Free" ? (
                  <Link href="/" className={styles.secondaryCta}>{sessionStatus === "authenticated" ? "Open AIRA" : "Start free"}</Link>
                ) : (
                  <Link href={checkoutHref} className={styles.cta}>{plan.name === "Pro" ? "Upgrade to Pro" : "Choose Team"}</Link>
                )}
              </section>
            );
          })}
        </div>

        <p className={styles.note}><Zap className="size-3.5" aria-hidden /> Free remains available without a card.</p>
      </div>
    </main>
  );
}
