import { Check, Crown, Shield, Sparkles, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface PricingPlan {
	readonly name: "Free" | "Pro" | "Team";
	readonly price: string;
	readonly priceNote?: string;
	readonly description: string;
	readonly features: readonly string[];
	readonly buttonText: string;
	readonly icon: LucideIcon;
	readonly highlight?: boolean;
	readonly eyebrow: string;
}

const PLANS: readonly PricingPlan[] = [
	{
		name: "Free",
		price: "$0",
		eyebrow: "Explore",
		description: "A generous place to think, ask, and research with Aira.",
		features: ["250 searches per month", "Standard search", "Grounded citations", "Persistent conversation history", "Memory controls"],
		buttonText: "Current plan",
		icon: Zap,
	},
	{
		name: "Pro",
		price: "$20",
		eyebrow: "Go deeper",
		description: "For people who use Aira as a serious research and execution partner.",
		features: ["2,000 searches per month", "Deep Research", "50 autonomous agent tasks", "Advanced citation ranking", "Priority support"],
		buttonText: "Upgrade to Pro",
		icon: Crown,
		highlight: true,
	},
	{
		name: "Team",
		price: "$15",
		priceNote: "per user / month",
		eyebrow: "Build together",
		description: "Shared intelligence, higher limits, and cleaner operations for teams.",
		features: ["10,000 searches per seat", "250 agent tasks per seat", "Centralized billing", "Team-wide research history", "Admin controls"],
		buttonText: "Choose Team",
		icon: Shield,
	},
];

export default function PricingPage() {
	return (
		<main className="aira-shell min-h-dvh overflow-hidden text-content-primary">
			<WorkspaceHeader />
			<div className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-16">
				<div className="aira-orb aira-orb-blue -left-12 top-20 size-24 opacity-45" aria-hidden />
				<div className="aira-orb aira-orb-violet -right-10 top-8 size-28 opacity-50" aria-hidden />

				<div className="aira-enter relative mx-auto max-w-3xl text-center">
					<div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border-subtle bg-white/75 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-content-secondary shadow-sm backdrop-blur"><Sparkles className="size-3.5 text-accent" aria-hidden /> Simple pricing</div>
					<h1 className="aira-display mt-5 text-4xl sm:text-5xl md:text-6xl">Choose how far <span className="aira-gradient-text">Aira can go.</span></h1>
					<p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-content-tertiary sm:text-base">Start free. Move up when deeper research, more usage, or autonomous work starts saving you real time.</p>
				</div>

				<div className="relative mt-11 grid gap-4 md:grid-cols-3 md:items-stretch">
					{PLANS.map((plan) => {
						const Icon = plan.icon;
						return (
							<section key={plan.name} className={cn("aira-premium-card aira-card-hover relative flex flex-col overflow-hidden rounded-[28px] p-6", plan.highlight && "aira-pro-glow border-accent/25 md:-translate-y-2")}>
								{plan.highlight ? <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(ellipse_at_top,hsl(var(--accent)/0.15),transparent_72%)]" aria-hidden /> : null}
								<div className="relative flex items-start justify-between gap-3">
									<span className={cn("flex size-11 items-center justify-center rounded-2xl", plan.highlight ? "bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))] text-white shadow-[0_10px_28px_hsl(var(--accent)/0.22)]" : "aira-icon-pop")}><Icon className="size-4.5" aria-hidden /></span>
									{plan.highlight ? <span className="rounded-full bg-content-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">Most popular</span> : null}
								</div>
								<p className="relative mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-content-tertiary">{plan.eyebrow}</p>
								<h2 className="relative mt-1 text-xl font-semibold">{plan.name}</h2>
								<p className="relative mt-2 min-h-[48px] text-sm leading-6 text-content-tertiary">{plan.description}</p>
								<div className="relative mt-6 flex items-end gap-2"><span className="text-4xl font-semibold tracking-tight">{plan.price}</span>{plan.name !== "Free" ? <span className="pb-1 text-xs text-content-tertiary">/ month</span> : null}</div>
								{plan.priceNote ? <p className="relative mt-1 text-[11px] text-content-tertiary">{plan.priceNote}</p> : null}
								<ul className="relative my-6 flex-1 space-y-3">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-2.5 text-sm leading-5 text-content-secondary"><span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", plan.highlight ? "bg-accent/10 text-accent" : "bg-surface-inset text-content-secondary")}><Check className="size-3" aria-hidden /></span>{feature}</li>)}</ul>
								{plan.name === "Free" ? <Button variant="outline" disabled className="relative h-11 w-full rounded-xl bg-surface-inset/60">{plan.buttonText}</Button> : <Button asChild className={cn("aira-shine-button relative h-11 w-full rounded-xl shadow-sm", plan.highlight ? "bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))] hover:opacity-95" : "bg-content-primary hover:bg-content-primary/90")}><Link href="/upgrade">{plan.buttonText}</Link></Button>}
							</section>
						);
					})}
				</div>
				<div className="mt-10 flex items-center justify-center gap-2 text-center text-xs text-content-tertiary"><Zap className="size-3.5 text-accent" aria-hidden /> Stay on Free as long as you like. No card required to start.</div>
			</div>
		</main>
	);
}
