"use client";

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
		<main className="aira-shell min-h-dvh text-content-primary">
			<WorkspaceHeader />
			<div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 md:py-14">
				<div className="aira-enter mx-auto max-w-2xl text-center">
					<span className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">Secure checkout</span>
					<h1 className="aira-display mt-4 text-4xl sm:text-5xl">Upgrade when you need more.</h1>
					<p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-content-tertiary">Choose Pro for individual power use or Team for shared capacity. Checkout is handled securely by Cashfree.</p>
				</div>

				<div className="aira-card mx-auto mt-9 max-w-xl rounded-3xl p-5 sm:p-6">
					<div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-inset p-1.5">
						{(["pro", "team"] as const).map((option) => (
							<button key={option} type="button" onClick={() => setPlan(option)} className={cn("rounded-xl px-3 py-2.5 text-sm font-semibold capitalize transition", plan === option ? "bg-white text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-primary")}>{option}</button>
						))}
					</div>

					<div className="mt-6 rounded-2xl border border-border-subtle bg-white p-4">
						<p className="text-sm font-semibold">{plan === "pro" ? "AiraAI Pro" : "AiraAI Team"}</p>
						<p className="mt-1 text-xs leading-5 text-content-tertiary">{plan === "pro" ? "Deep Research, higher search limits, and 50 agent runs per month." : "Shared billing, higher limits, and 250 agent runs per seat."}</p>
					</div>

					{plan === "team" ? (
						<label className="mt-5 block text-sm"><span className="mb-1.5 block font-medium">Seats</span><input type="number" min={2} max={100} value={teamSeats} onChange={(event) => setTeamSeats(Number(event.target.value))} className="h-11 w-full rounded-xl border border-border-subtle bg-surface-inset/60 px-3 outline-none focus:ring-2 focus:ring-accent/15" /></label>
					) : null}

					<label className="mt-5 block text-sm"><span className="mb-1.5 block font-medium">Phone number</span><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="e.g. 9876543210" className="h-11 w-full rounded-xl border border-border-subtle bg-surface-inset/60 px-3 outline-none placeholder:text-content-tertiary focus:ring-2 focus:ring-accent/15" /><span className="mt-1.5 block text-xs text-content-tertiary">Required by the subscription checkout flow.</span></label>

					{error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
					<Button type="button" className="mt-5 h-11 w-full rounded-xl" disabled={busy || phone.trim().length < 8} onClick={() => void startCheckout()}>{busy ? "Starting…" : "Continue to secure checkout"}</Button>
					<p className="mt-4 text-center text-xs text-content-tertiary"><Link href="/pricing" className="font-medium text-accent">Compare plans</Link><span className="mx-2">·</span><Link href="/" className="font-medium text-accent">Back to research</Link></p>
				</div>
			</div>
		</main>
	);
}
