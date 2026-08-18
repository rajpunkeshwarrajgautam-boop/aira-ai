import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AiraLogo } from "@/components/AiraLogo";
import { CitationCards } from "@/components/CitationCards";
import { CopyShareLinkButton } from "@/components/share/CopyShareLinkButton";
import { ShareAnswerMarkdown } from "@/components/share/ShareAnswerMarkdown";
import { ShareFollowUpCta } from "@/components/share/ShareFollowUpCta";
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
		<div className="aira-shell min-h-dvh w-full overflow-hidden">
			<div className="relative z-10 flex min-h-dvh flex-col">
				<header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 md:px-6">
					<Link href="/" aria-label="Open AiraAI"><AiraLogo /></Link>
					<div className="flex items-center gap-2"><CopyShareLinkButton url={url} /></div>
				</header>

				<main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-12 pt-3 md:px-6 md:pt-6">
					<div className="aira-enter text-center">
						<span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-accent ring-1 ring-accent/10 backdrop-blur"><span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" aria-hidden />Shared Aira research</span>
						<h1 className="aira-display mx-auto mt-4 max-w-4xl text-3xl leading-tight text-content-primary sm:text-4xl md:text-5xl">{share.query}</h1>
						<p className="mt-3 text-sm text-content-tertiary">A read-only research result with the evidence preserved.</p>
					</div>

					<section className="aira-glass rounded-3xl p-5 sm:p-7" aria-label="Research answer">
						<ShareAnswerMarkdown markdown={share.assistantAnswer} citations={share.citations} maxValid={share.citations.length} />
					</section>

					{share.citations.length > 0 ? <CitationCards citations={share.citations} className="p-0" citedIndices={citedIndices} /> : null}

					<section className="aira-card aira-fun-card flex flex-col gap-3 rounded-3xl p-5 sm:p-6">
						<h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Continue in your own workspace</h2>
						<p className="text-sm leading-6 text-content-secondary">Ask a follow-up based on this research. Aira will open a new private thread for you.</p>
						<ShareFollowUpCta initialQuery={share.query} />
					</section>
				</main>
			</div>
		</div>
	);
}
