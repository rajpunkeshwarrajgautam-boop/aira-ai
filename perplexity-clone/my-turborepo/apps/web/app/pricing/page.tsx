import { Check, Shield, Sparkles, Zap } from "lucide-react";
import Link from "next/link";

import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const PLANS = [
	{
		name: "Free",
		price: "$0",
		description: "For everyday questions and light research.",
		features: ["250 searches per month", "Standard search", "Grounded citations", "Persistent conversation history", "Memory controls"],
		buttonText: "Current plan",
		icon: Zap,
	},
	{
		name: "Pro",
		price: "$20",
		description: "For professionals who research and build with AiraAI regularly.",
		features: ["2,000 searches per month", "Deep Research", "50 autonomous agent tasks", "Advanced citation ranking", "Priority support"],
		buttonText: "Upgrade to Pro",
		icon: Sparkles,
		highlight: true,
	},
	{
		name: "Team",
		price: "$15",
		priceNote: "per user / month",
		description: "For teams that need higher limits and shared operations.",
		features: ["10,000 searches per seat", "250 agent tasks per seat", "Centralized billing", "Team-wide research history", "Admin controls"],
		buttonText: "Choose Team",
		icon: Shield,
	},
] as const;

export default function PricingPage() {
	return (
		<main className="aira-shell min-h-dvh text-content-primary">
			<WorkspaceHeader />
			<div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
				<div className="aira-enter mx-auto max-w-3xl text-center">
					<span className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">Plans</span>
					<h1 className="aira-display mt-4 text-4xl sm:text-5xl md:text-6xl">Choose how far Aira can go.</h1>
					<p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-content-tertiary sm:text-base">Start free. Upgrade when you need deeper research, more monthly usage, or autonomous agent runs.</p>
				</div>

				<div className="mt-10 grid gap-4 md:grid-cols-3">
					{PLANS.map((plan) => {
						const Icon = plan.icon;
						return (
							<section key={plan.name} className={cn("aira-card aira-card-hover relative flex flex-col rounded-3xl p-6", plan.highlight && "border-accent/30 ring-1 ring-accent/10")}> 
								{plan.highlight ? <span className="absolute right-5 top-5 rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">Best for power users</span> : null}
								<span className={cn("flex size-10 items-center justify-center rounded-2xl", plan.highlight ? "bg-accent text-white" : "bg-surface-inset text-content-secondary")}><Icon className="size-4.5" aria-hidden /></span>
								<h2 className="mt-5 text-lg font-semibold">{plan.name}</h2>
								<p className="mt-1 min-h-[44px] text-sm leading-6 text-content-tertiary">{plan.description}</p>
								<div className="mt-6 flex items-end gap-2"><span className="text-4xl font-semibold tracking-tight">{plan.price}</span>{plan.name !== "Free" ? <span className="pb-1 text-xs text-content-tertiary">/ month</span> : null}</div>
								{"priceNote" in plan && plan.priceNote ? <p className="mt-1 text-[11px] text-content-tertiary">{plan.priceNote}</p> : null}
								<ul className="my-6 flex-1 space-y-3">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-2.5 text-sm leading-5 text-content-secondary"><Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />{feature}</li>)}</ul>
								{plan.name === "Free" ? <Button variant="outline" disabled className="h-11 w-full rounded-xl">{plan.buttonText}</Button> : <Button asChild className={cn("h-11 w-full rounded-xl", !plan.highlight && "bg-content-primary hover:bg-content-primary/90")}><Link href="/upgrade">{plan.buttonText}</Link></Button>}
							</section>
						);
					})}
				</div>
				<p className="mt-10 text-center text-xs text-content-tertiary">You can continue using AiraAI on Free without entering payment details.</p>
			</div>
		</main>
	);
}
