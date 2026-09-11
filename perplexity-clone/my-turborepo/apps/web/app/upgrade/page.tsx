import { ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { Button } from "@/components/ui/button";

export default function UpgradePage() {
	return (
		<main className="aira-shell min-h-dvh text-content-primary">
			<WorkspaceHeader />
			<div className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-4xl items-center px-4 py-10 sm:px-6 md:py-14">
				<div className="aira-gradient-frame mx-auto w-full max-w-2xl rounded-[28px]">
					<section className="aira-glass rounded-[27px] p-6 text-center sm:p-8" aria-labelledby="upgrade-unavailable-title">
						<span className="mx-auto inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/[0.08] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-100">
							<ShieldCheck className="size-3.5" aria-hidden /> Commercial activation gated
						</span>
						<span className="mx-auto mt-6 flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
							<Sparkles className="size-5" aria-hidden />
						</span>
						<h1 id="upgrade-unavailable-title" className="aira-display mt-5 text-4xl sm:text-5xl">Paid upgrades are not available yet.</h1>
						<p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-content-tertiary sm:text-base">
							AIRA&apos;s paid checkout is deliberately disabled while commercial activation, payment callbacks, and webhook handling complete live certification. This release candidate will not start a payment or create a subscription.
						</p>
						<div className="mt-7 flex flex-wrap justify-center gap-3">
							<Button variant="outline" asChild className="h-11 rounded-xl"><Link href="/pricing">Compare plans</Link></Button>
							<Button asChild className="h-11 rounded-xl"><Link href="/">Back to research</Link></Button>
						</div>
					</section>
				</div>
			</div>
		</main>
	);
}
