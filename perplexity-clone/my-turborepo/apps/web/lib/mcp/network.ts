import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024;
const BLOCKED_HOSTS = new Set([
	"localhost",
	"metadata.google.internal",
	"metadata.google",
	"instance-data",
]);

export class McpNetworkError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "McpNetworkError";
		this.code = code;
	}
}

function isUnsafeIpv4(address: string): boolean {
	const octets = address.split(".").map(Number);
	if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
	const [a, b] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	);
}

function isUnsafeIpv6(address: string): boolean {
	const value = address.toLowerCase();
	if (value === "::" || value === "::1") return true;
	if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
	const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	return mapped ? isUnsafeIpv4(mapped[1]) : false;
}

export function isUnsafeMcpAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return isUnsafeIpv4(address);
	if (family === 6) return isUnsafeIpv6(address);
	return true;
}

export function validateMcpEndpoint(
	value: string,
	_nodeEnv = process.env.NODE_ENV ?? "development",
	options: { allowPath?: boolean } = {},
): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new McpNetworkError("MCP_URL_INVALID", "MCP endpoint URL is invalid.");
	}
	if (url.protocol !== "https:") {
		throw new McpNetworkError("MCP_URL_INSECURE", "MCP endpoints must use HTTPS.");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new McpNetworkError("MCP_URL_CREDENTIALS", "MCP endpoints may not contain credentials, query parameters, or fragments.");
	}
	if (options.allowPath === false && url.pathname !== "/") {
		throw new McpNetworkError("MCP_ISSUER_PATH", "MCP OAuth issuer must be an origin URL.");
	}
	const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
	if (
		BLOCKED_HOSTS.has(hostname) ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal")
	) {
		throw new McpNetworkError("MCP_URL_PRIVATE", "MCP endpoint hostname is not allowed.");
	}
	if (isIP(hostname) && isUnsafeMcpAddress(hostname)) {
		throw new McpNetworkError("MCP_URL_PRIVATE", "MCP endpoint address is not allowed.");
	}
	return url;
}

export async function assertMcpEndpointSafe(url: URL): Promise<void> {
	validateMcpEndpoint(url.toString());
	if (isIP(url.hostname)) return;
	let addresses: Awaited<ReturnType<typeof lookup>>;
	try {
		addresses = await lookup(url.hostname, { all: true, verbatim: true });
	} catch {
		throw new McpNetworkError("MCP_DNS_FAILED", "MCP endpoint hostname could not be resolved.");
	}
	if (!addresses.length || addresses.some(({ address }) => isUnsafeMcpAddress(address))) {
		throw new McpNetworkError("MCP_DNS_PRIVATE", "MCP endpoint resolved to a disallowed network address.");
	}
}

function inputUrl(input: string | URL | Request): URL {
	if (input instanceof URL) return input;
	if (typeof input === "string") return new URL(input);
	return new URL(input.url);
}

export function createMcpSafeFetch(timeoutMs: number): typeof fetch {
	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = inputUrl(input);
		await assertMcpEndpointSafe(url);
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
		const response = await fetch(input, {
			...init,
			redirect: "manual",
			signal,
		});
		if (response.status >= 300 && response.status < 400) {
			throw new McpNetworkError("MCP_REDIRECT_BLOCKED", "MCP HTTP redirects are not followed automatically.");
		}
		const declaredLength = Number(response.headers.get("content-length") ?? "0");
		if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_RESPONSE_BYTES) {
			throw new McpNetworkError("MCP_RESPONSE_TOO_LARGE", "MCP HTTP response exceeds the configured safety bound.");
		}
		return response;
	};
}
