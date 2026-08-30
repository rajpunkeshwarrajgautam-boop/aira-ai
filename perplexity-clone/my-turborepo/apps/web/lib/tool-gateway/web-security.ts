import { isIP } from "node:net";

export const UNTRUSTED_WEB_CONTENT = "UNTRUSTED_EXTERNAL_CONTENT" as const;

function normalizedHostname(value: string): string {
	return value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function ipv4Octets(hostname: string): readonly number[] | null {
	const parts = hostname.split(".");
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => Number(part));
	if (octets.some((value, index) => !Number.isInteger(value) || value < 0 || value > 255 || String(value) !== String(Number(parts[index])))) return null;
	return octets;
}

function isNonPublicIpv4(hostname: string): boolean {
	const octets = ipv4Octets(hostname);
	if (!octets) return false;
	const [a, b] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0 && octets[2] === 2) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && octets[2] === 100) ||
		(a === 203 && b === 0 && octets[2] === 113) ||
		a >= 224
	);
}

function isNonPublicIpv6(hostname: string): boolean {
	const host = normalizedHostname(hostname);
	if (isIP(host) !== 6) return false;
	if (host.includes("%")) return true;
	if (host === "::" || host === "::1") return true;
	const mapped = /(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
	if (mapped?.[1] && isNonPublicIpv4(mapped[1])) return true;
	const first = Number.parseInt(host.split(":", 1)[0] || "0", 16);
	if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
	if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if (host.startsWith("2001:db8:")) return true; // documentation-only
	if (host.startsWith("ff")) return true; // multicast
	return false;
}

export function isObviouslyNonPublicHostname(hostname: string): boolean {
	const host = normalizedHostname(hostname);
	if (!host) return true;
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
	if (isIP(host) === 4) return isNonPublicIpv4(host);
	if (isIP(host) === 6) return isNonPublicIpv6(host);
	return false;
}

export function publicWebUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
		if (isObviouslyNonPublicHostname(url.hostname)) return null;
		return url;
	} catch {
		return null;
	}
}

export function webSourceMatchesRequestedTarget(requested: URL, candidateValue: string): boolean {
	const candidate = publicWebUrl(candidateValue);
	if (!candidate) return false;
	const requestedHost = normalizedHostname(requested.hostname);
	const candidateHost = normalizedHostname(candidate.hostname);
	return (
		candidateHost === requestedHost ||
		candidateHost.endsWith(`.${requestedHost}`) ||
		requestedHost.endsWith(`.${candidateHost}`)
	);
}
