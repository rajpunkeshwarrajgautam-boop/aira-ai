"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type CheckoutPlan = "pro" | "team";

function loadCashfreeScript(): Promise<void> {
	if (typeof window === "undefined") return Promise.resolve();
	if (window.Cashfree) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
		s.async = true;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error("Could not load payment SDK."));
		document.body.appendChild(s);
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
		if (status === "unauthenticated") {
			router.replace(`/signin?callbackUrl=${encodeURIComponent("/upgrade")}`);
		}
	}, [status, router]);

	const startCheckout = useCallback(async () => {
		if (!session?.user?.email || busy) return;
		setError(null);
		setBusy(true);
		try {
			const res = await fetch("/api/billing/checkout", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					plan,
					teamSeats: plan === "team" ? teamSeats : undefined,
					customerPhone: phone.trim(),
				}),
			});
			const body = (await res.json().catch(() => null)) as
				| {
						subscriptionSessionId?: string;
						cashfreeJsEnv?: string;
						error?: { message?: string };
				  }
				| null;
			if (!res.ok) {
				throw new Error(body?.error?.message ?? `Checkout failed (${res.status}).`);
			}
			const subsSessionId = body?.subscriptionSessionId;
			const mode = body?.cashfreeJsEnv === "production" ? "production" : "sandbox";
			if (!subsSessionId) {
				throw new Error("Checkout did not return a session.");
			}
			await loadCashfreeScript();
			const cf = window.Cashfree?.({ mode });
			if (!cf) {
				throw new Error("Payment SDK not available.");
			}
			const result = await cf.subscriptionsCheckout({
				subsSessionId,
				redirectTarget: "_self",
			});
			if (result.error) {
				throw new Error(result.error.message);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "Checkout failed.");
		} finally {
			setBusy(false);
		}
	}, [session?.user?.email, busy, plan, teamSeats, phone]);

	if (status === "loading" || status === "unauthenticated") {
		return (
			<div className="flex min-h-dvh items-center justify-center bg-surface text-content-secondary">
				Loading…
			</div>
		);
	}

	return (
		<div className="relative min-h-dvh bg-surface px-4 py-16">
			<div
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--accent)/0.18),transparent)]"
				aria-hidden
			/>
			<div className="relative z-10 mx-auto w-full max-w-lg">
				<p className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-content-tertiary">
					Billing
				</p>
				<h1 className="mb-2 text-center text-2xl font-semibold tracking-tight text-content-primary">
					Upgrade your plan
				</h1>
				<p className="mb-8 text-center text-sm leading-relaxed text-content-secondary">
					Pro and Team include higher monthly search limits, Deep Research, and autonomous agent tasks. Complete checkout securely with
					Cashfree.
				</p>

				<div className="rounded-2xl border border-border-subtle bg-surface-elevated/80 p-6 shadow-panel backdrop-blur-md">
					<div className="mb-4 flex gap-2 rounded-xl border border-border-subtle p-1">
						<button
							type="button"
							onClick={() => setPlan("pro")}
							className={cn(
								"flex-1 rounded-lg px-3 py-2 text-sm font-medium transition",
								plan === "pro" ? "bg-accent/20 text-accent" : "text-content-secondary hover:text-content-primary",
							)}
						>
							Pro
						</button>
						<button
							type="button"
							onClick={() => setPlan("team")}
							className={cn(
								"flex-1 rounded-lg px-3 py-2 text-sm font-medium transition",
								plan === "team" ? "bg-accent/20 text-accent" : "text-content-secondary hover:text-content-primary",
							)}
						>
							Team
						</button>
					</div>

					{plan === "team" ? (
						<label className="mb-4 block text-sm text-content-secondary">
							<span className="mb-1 block font-medium text-content-primary">Seats (min 2)</span>
							<input
								type="number"
								min={2}
								max={100}
								value={teamSeats}
								onChange={(e) => setTeamSeats(Number(e.target.value))}
								className="mt-1 w-full rounded-xl border border-border-subtle bg-surface-inset px-3 py-2 text-content-primary"
							/>
						</label>
					) : null}

					<label className="mb-4 block text-sm text-content-secondary">
						<span className="mb-1 block font-medium text-content-primary">Phone (required for subscription)</span>
						<input
							type="tel"
							autoComplete="tel"
							value={phone}
							onChange={(e) => setPhone(e.target.value)}
							placeholder="e.g. 9876543210"
							className="mt-1 w-full rounded-xl border border-border-subtle bg-surface-inset px-3 py-2 text-content-primary"
						/>
					</label>

					{error ? (
						<p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
							{error}
						</p>
					) : null}

					<Button
						type="button"
						className="w-full"
						disabled={busy || phone.trim().length < 8}
						onClick={() => void startCheckout()}
					>
						{busy ? "Starting…" : "Continue to secure checkout"}
					</Button>

					<p className="mt-4 text-center text-xs text-content-tertiary">
						<Link href="/" className="text-accent hover:underline">
							Back to research
						</Link>
					</p>
				</div>
			</div>
		</div>
	);
}
