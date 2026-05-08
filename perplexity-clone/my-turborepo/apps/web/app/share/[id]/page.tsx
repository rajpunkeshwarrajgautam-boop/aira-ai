import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CitationCards } from "@/components/CitationCards";
import { CopyShareLinkButton } from "@/components/share/CopyShareLinkButton";
import { ShareAnswerMarkdown } from "@/components/share/ShareAnswerMarkdown";
import { ShareFollowUpCta } from "@/components/share/ShareFollowUpCta";
import { cn } from "@/lib/cn";
import { getPublicResearchShareByToken, buildShareUrl } from "@/lib/research-share";
import { parseCitationIndicesFromAnswer } from "@/src/services/citations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function baseUrlFromRequestHeaders(): Promise<string> {
	const h = await headers();
	const host = h.get("x-forwarded-host") ?? h.get("host");
	if (!host) return "http://localhost:3000";
	const proto = h.get("x-forwarded-proto") ?? "https";
	return `${proto}://${host}`;
}

function sanitizeForTitle(input: string): string {
	return input.replace(/\s+/g, " ").trim().slice(0, 70);
}

function buildDescription(answer: string): string {
	const oneLine = answer.replace(/\s+/g, " ").trim();
	return oneLine.length > 160 ? oneLine.slice(0, 157) + "…" : oneLine;
}

export async function generateMetadata({
	params,
}: {
	readonly params: Promise<{ readonly id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const share = await getPublicResearchShareByToken(id);
	if (!share) notFound();

	const baseUrl = await baseUrlFromRequestHeaders();
	const url = buildShareUrl(share.token, baseUrl);

	const title = `Research: ${sanitizeForTitle(share.query)}`;
	const description = buildDescription(share.assistantAnswer);

	return {
		title,
		description,
		openGraph: {
			title,
			description,
			type: "article",
			url,
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}

export default async function SharePage({
	params,
}: {
	readonly params: Promise<{ readonly id: string }>;
}) {
	const { id } = await params;
	const share = await getPublicResearchShareByToken(id);
	if (!share) notFound();

	const baseUrl = await baseUrlFromRequestHeaders();
	const url = buildShareUrl(share.token, baseUrl);
	const citedIndices = parseCitationIndicesFromAnswer(share.assistantAnswer);

	return (
		<div className="relative min-h-dvh w-full overflow-hidden bg-surface">
			<div
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--accent)/0.18),transparent)]"
				aria-hidden
			/>

			<div className="relative z-10 flex min-h-dvh flex-col">
				<header className="flex items-center justify-between gap-4 px-4 py-6 md:px-6">
					<div className="flex min-w-0 flex-col">
						<h1 className="truncate text-lg font-semibold tracking-tight text-content-primary sm:text-xl">
							{share.query}
						</h1>
						<p className="mt-0.5 text-xs text-content-secondary">
							Shared research with live web citations.
						</p>
					</div>

					<div className="flex items-center gap-2">
						<CopyShareLinkButton url={url} />
					</div>
				</header>

				<main className="flex flex-1 flex-col gap-6 px-4 pb-10 md:px-6">
					<section
						className={cn(
							"rounded-2xl border border-border-subtle bg-surface-elevated/30 p-5 backdrop-blur-md",
						)}
						aria-label="Research answer"
					>
						<ShareAnswerMarkdown markdown={share.assistantAnswer} maxValid={share.citations.length} />
					</section>

					{share.citations.length > 0 ? (
						<CitationCards citations={share.citations} className="p-0" citedIndices={citedIndices} />
					) : null}

					<section className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-elevated/30 p-5 backdrop-blur-md">
						<h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">
							Follow-up
						</h2>
						<p className="text-sm text-content-secondary">
							Ask a follow-up question based on this shared research. You will start a new private thread.
						</p>
						<ShareFollowUpCta initialQuery={share.query} />
					</section>
				</main>
			</div>
		</div>
	);
}

