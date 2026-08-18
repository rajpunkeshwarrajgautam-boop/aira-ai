"use client";

import { ShieldCheck, Sparkles, Users } from "lucide-react";
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
		return <div className="aira-shell flex min-h-dvh items-center justify-center text-content-secondary">Loading…</div>;
	}

	return (
		<main className="aira-shell min-h-dvh overflow-hidden text-content-primary">
			<WorkspaceHeader />
			<div className="relative mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 md:py-14">
				<div className="aira-orb aira-orb-blue -left-10 top-20 size-24 opacity-45" aria-hidden />
				<div className="aira-orb aira-orb-violet -right-8 top-14 size-28 opacity-45" aria-hidden />
				<div className="aira-enter relative mx-auto max-w-2xl text-center">
					<div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border-subtle bg-white/75 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-content-secondary shadow-sm backdrop-blur"><ShieldCheck className="size-3.5 text-emerald-600" aria-hidden /> Secure checkout</div>
					<h1 className="aira-display mt-5 text-4xl sm:text-5xl">Give Aira <span className="aira-gradient-text">more room to work.</span></h1>
					<p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-content-tertiary">Choose Pro for individual power use or Team for shared capacity. The underlying subscription flow stays exactly the same.</p>
				</div>

				<div className="aira-premium-card relative mx-auto mt-9 max-w-xl overflow-hidden rounded-[30px] p-5 sm:p-6">
					<span className="pointer-events-none absolute -right-16 -top-20 size-52 rounded-full bg-[radial-gradient(circle,hsl(var(--accent-violet)/0.12),transparent_68%)]" aria-hidden />
					<div className="relative grid grid-cols-2 gap-2 rounded-2xl bg-surface-inset p-1.5">
						{(["pro", "team"] as const).map((option) => (
							<button key={option} type="button" onClick={() => setPlan(option)} className={cn("flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold capitalize transition", plan === option ? "bg-white text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-primary")}>
								{option === "pro" ? <Sparkles className="size-4 text-accent" aria-hidden /> : <Users className="size-4 text-accent" aria-hidden />}{option}
							</button>
						))}
					</div>

					<div className="relative mt-6 rounded-2xl border border-border-subtle bg-white/80 p-4 shadow-sm">
						<div className="flex items-center gap-3"><span className="aira-icon-pop flex size-10 items-center justify-center rounded-xl">{plan === "pro" ? <Sparkles className="size-4.5" aria-hidden /> : <Users className="size-4.5" aria-hidden />}</span><div><p className="text-sm font-semibold">{plan === "pro" ? "AiraAI Pro" : "AiraAI Team"}</p><p className="mt-1 text-xs leading-5 text-content-tertiary">{plan === "pro" ? "Deep Research, higher search limits, and 50 agent runs per month." : "Shared billing, higher limits, and 250 agent runs per seat."}</p></div></div>
					</div>

					{plan === "team" ? (
						<label className="relative mt-5 block text-sm"><span className="mb-1.5 block font-medium">Seats</span><input type="number" min={2} max={100} value={teamSeats} onChange={(event) => setTeamSeats(Number(event.target.value))} className="h-11 w-full rounded-xl border border-border-subtle bg-white/75 px-3 outline-none transition focus:border-accent/30 focus:ring-4 focus:ring-accent/8" /></label>
					) : null}

					<label className="relative mt-5 block text-sm"><span className="mb-1.5 block font-medium">Phone number</span><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="e.g. 9876543210" className="h-11 w-full rounded-xl border border-border-subtle bg-white/75 px-3 outline-none transition placeholder:text-content-tertiary focus:border-accent/30 focus:ring-4 focus:ring-accent/8" /><span className="mt-1.5 block text-xs text-content-tertiary">Required by the subscription checkout flow.</span></label>

					{error ? <p className="relative mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
					<Button type="button" className="relative mt-5 h-11 w-full rounded-xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))] shadow-[0_10px_26px_hsl(var(--accent)/0.18)] hover:opacity-95" disabled={busy || phone.trim().length < 8} onClick={() => void startCheckout()}>{busy ? "Starting…" : "Continue to secure checkout"}</Button>
					<p className="relative mt-4 text-center text-xs text-content-tertiary"><Link href="/pricing" className="font-medium text-accent">Compare plans</Link><span className="mx-2">·</span><Link href="/" className="font-medium text-accent">Back to research</Link></p>
				</div>
			</div>
		</main>
	);
}
