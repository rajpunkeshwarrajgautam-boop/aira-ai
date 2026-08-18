"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type CheckoutPlan = "pro" | "team";

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
		if (status === "unauthenticated") router.replace(`/signin?callbackUrl=${encodeURIComponent("/upgrade")}`);
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
				body: JSON.stringify({ plan, teamSeats: plan === "team" ? teamSeats : undefined, customerPhone: phone.trim() }),
			});
			const body = (await response.json().catch(() => null)) as { subscriptionSessionId?: string; cashfreeJsEnv?: string; error?: { message?: string } } | null;
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
		} finally { setBusy(false); }
	}, [session?.user?.email, busy, plan, teamSeats, phone]);

	if (status === "loading" || status === "unauthenticated") {
		return <div className="aira-shell flex min-h-dvh flex-col items-center justify-center gap-3 text-content-secondary"><span className="aira-orbit-loader" aria-hidden /><span>Preparing checkout…</span></div>;
	}

	return (
		<main className="aira-shell min-h-dvh text-content-primary">
			<WorkspaceHeader />
			<div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 md:py-14">
				<div className="aira-enter mx-auto max-w-2xl text-center">
					<span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-accent ring-1 ring-accent/10 backdrop-blur"><ShieldCheck className="size-3.5" aria-hidden />Secure checkout</span>
					<h1 className="aira-display mt-4 text-4xl sm:text-5xl">Upgrade when you need more.</h1>
					<p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-content-tertiary">Choose Pro for individual power use or Team for shared capacity. Checkout is handled securely by Cashfree.</p>
				</div>

				<div className="aira-gradient-frame mx-auto mt-9 max-w-xl rounded-[26px]">
					<div className="aira-glass rounded-[25px] p-5 sm:p-6">
						<div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-inset/75 p-1.5 ring-1 ring-border-subtle/70">
							{(["pro", "team"] as const).map((option) => (
								<button key={option} type="button" onClick={() => setPlan(option)} className={cn("rounded-xl px-3 py-2.5 text-sm font-semibold capitalize transition-all duration-200", plan === option ? "bg-white text-content-primary shadow-[0_8px_20px_rgba(15,23,42,0.08)] ring-1 ring-white" : "text-content-tertiary hover:bg-white/50 hover:text-content-primary")}>{option}</button>
							))}
						</div>

						<div className="aira-fun-card mt-6 rounded-2xl border border-border-subtle bg-white/85 p-4">
							<div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-xl bg-accent/10 text-accent"><Sparkles className="size-4" aria-hidden /></span><p className="text-sm font-semibold">{plan === "pro" ? "AiraAI Pro" : "AiraAI Team"}</p></div>
							<p className="mt-2 text-xs leading-5 text-content-tertiary">{plan === "pro" ? "Deep Research, higher search limits, and 50 agent runs per month." : "Shared billing, higher limits, and 250 agent runs per seat."}</p>
						</div>

						{plan === "team" ? (
							<label className="mt-5 block text-sm"><span className="mb-1.5 block font-medium">Seats</span><input type="number" min={2} max={100} value={teamSeats} onChange={(event) => setTeamSeats(Number(event.target.value))} className="h-11 w-full rounded-xl border border-border-subtle bg-surface-inset/60 px-3 outline-none transition focus:border-accent/30 focus:bg-white focus:ring-4 focus:ring-accent/[0.06]" /></label>
						) : null}

						<label className="mt-5 block text-sm"><span className="mb-1.5 block font-medium">Phone number</span><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="e.g. 9876543210" className="h-11 w-full rounded-xl border border-border-subtle bg-surface-inset/60 px-3 outline-none transition placeholder:text-content-tertiary focus:border-accent/30 focus:bg-white focus:ring-4 focus:ring-accent/[0.06]" /><span className="mt-1.5 block text-xs text-content-tertiary">Required by the subscription checkout flow.</span></label>

						{error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
						<Button type="button" className="aira-shine-button mt-5 h-11 w-full rounded-xl" disabled={busy || phone.trim().length < 8} onClick={() => void startCheckout()}>{busy ? "Starting…" : "Continue to secure checkout"}</Button>
						<p className="mt-4 text-center text-xs text-content-tertiary"><Link href="/pricing" className="font-medium text-accent">Compare plans</Link><span className="mx-2">·</span><Link href="/" className="font-medium text-accent">Back to research</Link></p>
					</div>
				</div>
			</div>
		</main>
	);
}
