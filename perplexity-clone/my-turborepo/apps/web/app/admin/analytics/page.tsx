import { notFound } from "next/navigation";

import { requireAnalyticsAdmin } from "@/lib/analytics/admin";
import {
	getConversionFunnel,
	getDailyAnalyticsPoints,
	getProductEventCounts,
} from "@/lib/analytics/analytics-metrics";
import { prisma } from "@/lib/prisma";
import type { AnalyticsEventType } from "@/lib/analytics/analytics-types";

export const runtime = "nodejs";

export default async function OwnerAnalyticsDashboardPage() {
	let admin: { readonly userId: string } | null = null;
	try {
		admin = await requireAnalyticsAdmin();
	} catch {
		admin = null;
	}

	if (!admin) notFound();

	const days = 14;
	const now = new Date();
	const from = new Date(now.getTime() - (days - 1) * 86_400_000);

	const [points, funnel, latestErrors, productEvents] = await Promise.all([
		getDailyAnalyticsPoints({ days }),
		getConversionFunnel({ from, to: now }),
		prisma.analyticsEvent.findMany({
			where: { type: { in: ["SEARCH_ERROR", "ERROR_EVENT"] as unknown as AnalyticsEventType[] } },
			orderBy: { createdAt: "desc" },
			take: 25,
			select: {
				id: true,
				createdAt: true,
				type: true,
				userId: true,
				anonymousId: true,
				plan: true,
				metadata: true,
			},
		}),
		getProductEventCounts(),
	]);

	const maxVisitorCount = Math.max(1, ...points.map((p) => p.visitors));

	return (
		<div className="relative min-h-dvh w-full overflow-hidden bg-surface px-4 py-8 md:px-6">
			<div className="mx-auto w-full max-w-5xl">
				<h1 className="text-xl font-semibold tracking-tight text-content-primary">Analytics dashboard</h1>
				<p className="mt-1 text-sm text-content-secondary">
					Last {days} days. Admin-only, production data.
				</p>

				<section className="mt-6 grid gap-4 md:grid-cols-3">
					<div className="rounded-2xl border border-border-subtle bg-surface-elevated/30 p-4 backdrop-blur-md">
						<p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">
							Funnel
						</p>
						<div className="mt-3 grid gap-2 text-sm text-content-primary">
							<p>
								Visitors: <span className="font-semibold">{funnel.visitors}</span>
							</p>
							<p>
								Signups: <span className="font-semibold">{funnel.signups}</span> (
								{Math.round(funnel.visitorToSignupRate * 100)}%)
							</p>
							<p>
								Searches: <span className="font-semibold">{funnel.searches}</span>
							</p>
							<p>
								Shares: <span className="font-semibold">{funnel.shares}</span>
							</p>
							<p>
								Upgrades: <span className="font-semibold">{funnel.upgrades}</span>
							</p>
						</div>
					</div>

					<div className="rounded-2xl border border-border-subtle bg-surface-elevated/30 p-4 backdrop-blur-md md:col-span-2">
						<p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">
							Usage by day
						</p>
						<div className="mt-4 overflow-x-auto rounded-xl border border-border-subtle bg-surface-inset">
							<table className="min-w-[720px] w-full border-collapse text-sm">
								<thead>
									<tr className="text-left text-xs text-content-tertiary">
										<th className="px-3 py-2">Day</th>
										<th className="px-3 py-2">Visitors</th>
										<th className="px-3 py-2">Signups</th>
										<th className="px-3 py-2">Searches (Std)</th>
										<th className="px-3 py-2">Searches (Deep)</th>
										<th className="px-3 py-2">Shares</th>
										<th className="px-3 py-2">Upgrades</th>
										<th className="px-3 py-2">Quota / Plan gates</th>
									</tr>
								</thead>
								<tbody>
									{points.map((p) => {
										return (
											<tr key={p.day} className="border-t border-border-subtle/60">
												<td className="px-3 py-2 font-medium text-content-primary">{p.day}</td>
												<td className="px-3 py-2">
													<div className="flex items-center gap-2">
														<div className="h-2 w-24 rounded bg-accent/20 overflow-hidden">
															<div
																className="h-full bg-accent/70"
																style={{ width: `${Math.round((p.visitors / maxVisitorCount) * 100)}%` }}
															/>
														</div>
														<span className="tabular-nums">{p.visitors}</span>
													</div>
												</td>
												<td className="px-3 py-2 tabular-nums">{p.signups}</td>
												<td className="px-3 py-2 tabular-nums">{p.searchesStandard}</td>
												<td className="px-3 py-2 tabular-nums">{p.searchesDeep}</td>
												<td className="px-3 py-2 tabular-nums">{p.shares}</td>
												<td className="px-3 py-2 tabular-nums">{p.upgrades}</td>
												<td className="px-3 py-2 tabular-nums">
													{p.quotaExceeded} / {p.planRequired}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>
				</section>

				<section className="mt-8 rounded-2xl border border-border-subtle bg-surface-elevated/30 p-4 backdrop-blur-md">
					<h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">Product Events</h2>
					<p className="mt-1 text-sm text-content-secondary">
						Granular product events tracked in the last 30 days.
					</p>
					<div className="mt-4 overflow-x-auto rounded-xl border border-border-subtle bg-surface-inset">
						<table className="min-w-[720px] w-full border-collapse text-sm">
							<thead>
								<tr className="text-left text-xs text-content-tertiary">
									<th className="px-3 py-2">Event</th>
									<th className="px-3 py-2">Last 24h</th>
									<th className="px-3 py-2">Last 7d</th>
									<th className="px-3 py-2">Last 30d</th>
								</tr>
							</thead>
							<tbody>
								{productEvents.map((e) => (
									<tr key={e.event} className="border-t border-border-subtle/60">
										<td className="px-3 py-2 font-medium text-content-primary">{e.event}</td>
										<td className="px-3 py-2 tabular-nums">{e.count24h}</td>
										<td className="px-3 py-2 tabular-nums">{e.count7d}</td>
										<td className="px-3 py-2 tabular-nums">{e.count30d}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>

				<section className="mt-8 rounded-2xl border border-border-subtle bg-surface-elevated/30 p-4 backdrop-blur-md">
					<h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">Recent errors</h2>
					<p className="mt-1 text-sm text-content-secondary">
						Search failures and internal analytics errors.
					</p>
					<div className="mt-4 overflow-x-auto rounded-xl border border-border-subtle bg-surface-inset">
						<table className="min-w-[720px] w-full border-collapse text-sm">
							<thead>
								<tr className="text-left text-xs text-content-tertiary">
									<th className="px-3 py-2">Time</th>
									<th className="px-3 py-2">Type</th>
									<th className="px-3 py-2">User</th>
									<th className="px-3 py-2">Plan</th>
									<th className="px-3 py-2">Message</th>
								</tr>
							</thead>
							<tbody>
								{latestErrors.map((e) => {
									const meta = e.metadata as unknown as { readonly message?: unknown };
									return (
										<tr key={e.id} className="border-t border-border-subtle/60">
											<td className="px-3 py-2 tabular-nums">
												{new Date(e.createdAt).toLocaleString()}
											</td>
											<td className="px-3 py-2">{e.type}</td>
											<td className="px-3 py-2">{e.userId ?? "anon"}</td>
											<td className="px-3 py-2">{e.plan ?? "-"}</td>
											<td className="px-3 py-2 text-content-secondary">
												{typeof meta?.message === "string" ? meta.message : "—"}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</section>
			</div>
		</div>
	);
}

