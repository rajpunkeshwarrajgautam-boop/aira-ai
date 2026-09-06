import { isIP } from "node:net";

export const UNTRUSTED_WEB_CONTENT = "UNTRUSTED_EXTERNAL_CONTENT" as const;

type Ipv4Octets = readonly [number, number, number, number];

function normalizedHostname(value: string): string {
	return value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function ipv4Octets(hostname: string): Ipv4Octets | null {
	const parts = hostname.split(".");
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => Number(part));
	if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
	return octets as unknown as Ipv4Octets;
}

function isNonPublicIpv4(hostname: string): boolean {
	const octets = ipv4Octets(hostname);
	if (!octets) return false;
	const [a, b, c] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && (c === 0 || c === 2)) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

function mappedIpv4(host: string): string | null {
	if (!host.startsWith("::ffff:")) return null;
	const tail = host.slice("::ffff:".length);
	if (ipv4Octets(tail)) return tail;
	const words = tail.split(":");
	if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null;
	const high = Number.parseInt(words[0]!, 16);
	const low = Number.parseInt(words[1]!, 16);
	return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function isNonPublicIpv6(hostname: string): boolean {
	const host = normalizedHostname(hostname);
	if (host.includes("%")) return true;
	if (isIP(host) !== 6) return false;
	if (host === "::" || host === "::1") return true;
	const mapped = mappedIpv4(host);
	if (mapped && isNonPublicIpv4(mapped)) return true;
	const first = Number.parseInt(host.split(":", 1)[0] || "0", 16);
	if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
	if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if (host.startsWith("2001:db8:")) return true; // documentation-only
	if ((first & 0xff00) === 0xff00) return true; // multicast
	return false;
}

export function isObviouslyNonPublicHostname(hostname: string): boolean {
	const host = normalizedHostname(hostname);
	if (!host) return true;
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
	if (isIP(host) === 4) return isNonPublicIpv4(host);
	if (isIP(host) === 6 || host.includes("%")) return isNonPublicIpv6(host);
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
