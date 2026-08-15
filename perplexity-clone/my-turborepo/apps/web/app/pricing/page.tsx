import { Check, Sparkles, Zap, Shield } from "lucide-react";
import Link from "next/link";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/button";

const PLANS = [
	{
		name: "Free",
		price: "0",
		description: "Great for occasional research",
		features: [
			"250 searches per month",
			"Standard search modes",
			"Basic citations",
			"Agent workspace preview",
			"Community support",
		],
		buttonText: "Current Plan",
		buttonVariant: "outline" as const,
		icon: Zap,
	},
	{
		name: "Pro",
		price: "20",
		description: "For professionals and power users",
		features: [
			"2,000 searches per month",
			"50 autonomous agent tasks per month",
			"Deep Research access",
			"Advanced citations & ranking",
			"Priority support",
		],
		buttonText: "Upgrade to Pro",
		buttonVariant: "default" as const,
		highlight: true,
		icon: Sparkles,
	},
	{
		name: "Team",
		price: "15",
		priceNote: "per user / month",
		description: "For organizations and groups",
		features: [
			"10,000 searches per seat / month",
			"250 autonomous agent tasks per seat",
			"Centralized billing",
			"Team-wide research history",
			"Admin dashboard",
		],
		buttonText: "Choose Team",
		buttonVariant: "outline" as const,
		icon: Shield,
	},
];

export default function PricingPage() {
	return (
		<div className="min-h-screen bg-surface py-20 px-4 md:px-8">
			<div className="max-w-6xl mx-auto">
				<div className="text-center mb-16">
					<h1 className="text-4xl md:text-5xl font-bold tracking-tight text-content-primary mb-4">
						Choose your research power
					</h1>
					<p className="text-lg text-content-secondary max-w-2xl mx-auto">
						Unlock deeper insights, more searches, and advanced tools tailored to your needs.
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-8">
					{PLANS.map((plan) => (
						<div
							key={plan.name}
							className={cn(
								"relative flex flex-col p-8 rounded-3xl border transition-all duration-300",
								plan.highlight
									? "bg-accent/5 border-accent shadow-[0_0_40px_-15px_rgba(var(--accent-rgb),0.3)] scale-105 z-10"
									: "bg-surface-elevated/40 border-border-subtle hover:border-border"
							)}
						>
							{plan.highlight && (
								<div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-accent text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
									Most Popular
								</div>
							)}

							<div className="mb-8">
								<div className={cn(
									"size-12 rounded-xl flex items-center justify-center mb-6",
									plan.highlight ? "bg-accent text-white" : "bg-surface text-content-secondary"
								)}>
									<plan.icon className="size-6" />
								</div>
								<h3 className="text-xl font-bold text-content-primary mb-2">{plan.name}</h3>
								<p className="text-sm text-content-tertiary">{plan.description}</p>
							</div>

							<div className="mb-8 flex items-baseline gap-1">
								<span className="text-4xl font-bold text-content-primary">${plan.price}</span>
								{plan.name !== "Free" && (
									<span className="text-content-tertiary text-sm">/month</span>
								)}
								{plan.priceNote && (
									<p className="text-[10px] text-content-tertiary block mt-1">{plan.priceNote}</p>
								)}
							</div>

							<ul className="space-y-4 mb-10 flex-1">
								{plan.features.map((feature) => (
									<li key={feature} className="flex items-start gap-3 text-sm text-content-secondary">
										<Check className={cn("size-4 shrink-0 mt-0.5", plan.highlight ? "text-accent" : "text-content-tertiary")} />
										<span>{feature}</span>
									</li>
								))}
							</ul>

							{plan.name === "Free" ? (
								<Button variant={plan.buttonVariant} className="h-12 w-full rounded-xl font-semibold" disabled>
									{plan.buttonText}
								</Button>
							) : (
								<Button
									asChild
									variant={plan.buttonVariant}
									className={cn(
										"h-12 w-full rounded-xl font-semibold",
										plan.highlight ? "bg-accent text-white hover:bg-accent/90" : "",
									)}
								>
									<Link href="/upgrade">{plan.buttonText}</Link>
								</Button>
							)}
						</div>
					))}
				</div>

				<div className="mt-20 text-center">
					<p className="text-content-tertiary text-sm">
						Need a custom plan? <Link href="/upgrade" className="text-accent font-semibold hover:underline">Start with Team</Link>
					</p>
				</div>
			</div>
		</div>
	);
}
