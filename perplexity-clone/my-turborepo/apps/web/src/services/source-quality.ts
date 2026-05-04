/**
 * Trust/readability helpers: excerpt sanitization and domain-only source typing.
 */

export type SourceQualityLabel =
	| "Peer-reviewed"
	| "Preprint"
	| "Official"
	| "Company"
	| "Blog"
	| "Aggregator"
	| "Unknown";

/** Unicode Cc (control) and Cf (format); preserves letters, numbers, punctuation, symbols, marks. */
const CONTROL_OR_FORMAT = /\p{Cc}|\p{Cf}/gu;

/**
 * Strips problematic control/format characters and normalizes whitespace for display and LLM context.
 * Does not apply NFKC/NFKD or other destructive normalizations.
 */
export function sanitizeSourceExcerpt(text: string): string {
	if (!text) return "";
	const stripped = text.replace(CONTROL_OR_FORMAT, "");
	return stripped
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/[\n\t\f\v]+/g, " ")
		.replace(/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, " ")
		.trim();
}

function hostAndPath(url: string): { host: string; path: string } {
	try {
		const u = new URL(url);
		return { host: u.hostname.toLowerCase(), path: u.pathname.toLowerCase() };
	} catch {
		return { host: "", path: "" };
	}
}

function hostIsOrUnder(host: string, domain: string): boolean {
	return host === domain || host.endsWith(`.${domain}`);
}

const PREPRINT_DOMAINS = ["arxiv.org", "biorxiv.org", "medrxiv.org"] as const;

const PEER_REVIEW_DOMAINS = [
	"nature.com",
	"science.org",
	"sciencedirect.com",
	"pubmed.ncbi.nlm.nih.gov",
	"pmc.ncbi.nlm.nih.gov",
	"aclanthology.org",
	"openreview.net",
	"ieee.org",
	"acm.org",
] as const;

const AGGREGATOR_HOSTS = ["emergentmind.com", "news.google.com"] as const;

const BLOG_SUBSTRINGS = ["medium.com", "substack.com", "dev.to", "hashnode.com"] as const;

/**
 * Domain/path heuristics only; first matching rule wins.
 */
export function inferSourceQualityLabel(url: string, _title?: string): SourceQualityLabel {
	const { host, path } = hostAndPath(url);
	if (!host) return "Unknown";

	for (const d of PREPRINT_DOMAINS) {
		if (hostIsOrUnder(host, d)) return "Preprint";
	}

	for (const d of PEER_REVIEW_DOMAINS) {
		if (hostIsOrUnder(host, d)) return "Peer-reviewed";
	}

	if (
		host.startsWith("ir.") ||
		host.startsWith("investors.") ||
		path.includes("/investors") ||
		path.includes("/news-releases")
	) {
		return "Company";
	}

	if (host.startsWith("blog.") || BLOG_SUBSTRINGS.some((s) => host.includes(s))) {
		return "Blog";
	}

	for (const h of AGGREGATOR_HOSTS) {
		if (hostIsOrUnder(host, h)) return "Aggregator";
	}

	if (hostIsOrUnder(host, "yahoo.com") && path.startsWith("/news")) return "Aggregator";

	if (
		hostIsOrUnder(host, "clinicaltrials.gov") ||
		hostIsOrUnder(host, "fda.gov") ||
		hostIsOrUnder(host, "who.int") ||
		hostIsOrUnder(host, "europa.eu") ||
		host.endsWith(".gov")
	) {
		return "Official";
	}

	return "Unknown";
}
