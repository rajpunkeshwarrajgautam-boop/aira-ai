"use client";

import { Check, Crown, Shield, Sparkles, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { logProductEvent } from "@/lib/log-product-event";

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
		description: "A generous place to think, ask, and research with Aira.",
		features: ["250 searches per month", "Standard search", "Grounded citations", "Persistent conversation history", "Memory controls"],
		icon: Zap,
	},
	{
		name: "Pro",
		price: "$20",
		eyebrow: "Go deeper",
		description: "For people who use Aira as a serious research and execution partner.",
		features: ["2,000 searches per month", "Deep Research", "Priority AI provider routing", "Advanced citation ranking", "Priority support"],
		icon: Crown,
		highlight: true,
	},
	{
		name: "Team",
		price: "$15",
		priceNote: "per user / month",
		eyebrow: "Build together",
		description: "Shared intelligence, higher limits, and cleaner operations for teams.",
		features: ["10,000 searches per seat", "Team-wide research history", "Centralized admin controls", "Custom provider routing", "Priority support"],
		icon: Shield,
	},
];

function planKey(name: PricingPlan["name"]): BillingPlan {
	return name.toUpperCase() as BillingPlan;
}

export default function PricingPage() {
	const { status: sessionStatus } = useSession();
	const [activePlan, setActivePlan] = useState<BillingPlan | null>(null);
	const [checkingPlan, setCheckingPlan] = useState(true);

	useEffect(() => {
		let cancelled = false;
		if (sessionStatus !== "authenticated") {
			setCheckingPlan(false);
			return;
		}
		fetch("/api/billing/status", { cache: "no-store" })
			.then(async (res) => (res.ok ? ((await res.json()) as { billingPlan?: string }) : {}))
			.then((body) => {
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
		<main className="aira-shell aira-cyber-teal-stage min-h-dvh overflow-hidden text-content-primary">
			<WorkspaceHeader />
			<div className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-16">
				<div className="aira-orb aira-orb-blue -left-12 top-20 size-24 opacity-45" aria-hidden />
				<div className="aira-orb aira-orb-violet -right-10 top-8 size-28 opacity-50" aria-hidden />

				<div className="aira-enter relative mx-auto max-w-3xl text-center">
					<div className="mx-auto inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-950/40 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300 shadow-sm backdrop-blur"><Sparkles className="size-3.5 text-cyan-400" aria-hidden /> Simple pricing</div>
					<h1 className="aira-display mt-5 text-4xl sm:text-5xl md:text-6xl text-white font-extrabold tracking-tight">Choose how far <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-indigo-400 bg-clip-text text-transparent">Aira can go.</span></h1>
					<p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">Start free. Move up when deeper research, more usage, or higher limits start saving you real time.</p>
					<div className="mx-auto mt-5 max-w-2xl rounded-2xl border border-amber-400/25 bg-amber-400/[0.08] px-4 py-3 text-sm leading-6 text-amber-200" role="status">
						Paid checkout is currently disabled while AIRA completes commercial activation. No payment can be started from this release candidate. Explore Free tier capabilities or configure workspace access.
					</div>
				</div>

				<div className="relative mt-11 grid gap-4 md:grid-cols-3 md:items-stretch">
					{PLANS.map((plan) => {
						const Icon = plan.icon;
						const key = planKey(plan.name);
						const isCurrent = activePlan === key;
						const tierClass = plan.name === "Free" ? "aira-card-amber" : plan.highlight ? "aira-card-cyan aira-pro-glow md:-translate-y-3" : "aira-card-fuchsia";
						return (
							<section key={plan.name} className={cn("aira-premium-card aira-card-hover relative flex flex-col overflow-hidden p-6 transition-all duration-300", tierClass)}>
								<div className="card-arch-glow pointer-events-none absolute inset-x-0 top-0 h-32" aria-hidden />
								<div className="relative flex items-start justify-between gap-3">
									<span className="tier-icon flex size-11 items-center justify-center rounded-2xl shadow-md"><Icon className="size-4.5" aria-hidden /></span>
									{plan.highlight ? (
										<span className="cyan-pill-badge inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] shadow-sm backdrop-blur-md">
											<Sparkles className="size-3 text-cyan-300" aria-hidden /> Most popular
										</span>
									) : null}
								</div>
								<p className={cn("relative mt-5 text-[10px] font-semibold uppercase tracking-[0.14em]", plan.highlight ? "text-cyan-400" : plan.name === "Free" ? "text-amber-400" : "text-fuchsia-400")}>{plan.eyebrow}</p>
								<h2 className="relative mt-1 text-2xl font-bold tracking-tight text-white">{plan.name}</h2>
								<p className="relative mt-2 min-h-[48px] text-sm leading-6 text-zinc-300">{plan.description}</p>
								<div className="relative mt-6 flex items-end gap-2">
									<span className="tier-price-val text-4xl font-extrabold tracking-tight text-white">{plan.price}</span>
									{plan.name !== "Free" ? <span className="pb-1 text-xs text-zinc-400">/ month</span> : null}
								</div>
								{plan.priceNote ? <p className="relative mt-1 text-[11px] text-zinc-400">{plan.priceNote}</p> : null}
								<ul className="relative my-6 flex-1 space-y-3">
									{plan.features.map((feature) => (
										<li key={feature} className="flex items-start gap-2.5 text-sm leading-5 text-zinc-200">
											<span className="check-icon mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
												<Check className="size-3" aria-hidden />
											</span>
											{feature}
										</li>
									))}
								</ul>

								{(sessionStatus === "loading" || (sessionStatus === "authenticated" && checkingPlan)) ? (
									<Button variant="outline" disabled className="relative h-11 w-full rounded-xl bg-white/5 border border-white/10 text-zinc-400">Checking plan…</Button>
								) : isCurrent ? (
									<Button variant="outline" disabled className="relative h-11 w-full rounded-xl bg-white/5 border border-white/10 text-zinc-400">Current plan</Button>
								) : plan.name === "Free" ? (
									<Button variant="outline" asChild className="relative h-11 w-full rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 font-medium"><Link href="/">{sessionStatus === "authenticated" ? "Open AIRA" : "Start free"}</Link></Button>
								) : (
									<Button
										type="button"
										onClick={() => {
											try {
												logProductEvent({
													event: "upgrade_clicked",
													surface: "pricing",
													userType: sessionStatus === "authenticated" ? "signed_in" : "guest",
													errorCode: key,
												});
											} catch {
												// ignore
											}
										}}
										className={cn("relative h-11 w-full rounded-xl transition", plan.highlight ? "pro-cta-btn bg-white text-[#0B2533] hover:bg-zinc-100 font-bold shadow-md" : "bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/20 font-medium")}
									>
										Paid upgrades unavailable
									</Button>
								)}
							</section>
						);
					})}
				</div>
				<div className="mt-10 flex items-center justify-center gap-2 text-center text-xs text-content-tertiary"><Zap className="size-3.5 text-accent" aria-hidden /> Stay on Free as long as you like. No card required to start.</div>
			</div>
		</main>
	);
}
