export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequestOptions {
	method?: HttpMethod;
	headers?: Record<string, string>;
	body?: string | Buffer | Record<string, unknown> | URLSearchParams;
	timeoutMs?: number;
	maxResponseSizeBytes?: number;
}

export interface HttpResponse<T = unknown> {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	data: T;
	rawText: string;
}

export interface HttpTransport {
	request<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
}

export class HttpTransportError extends Error {
	readonly status?: number;
	readonly code: string;
	readonly retryable: boolean;
	readonly retryAfterSeconds?: number;

	constructor(params: { message: string; status?: number; code: string; retryable?: boolean; retryAfterSeconds?: number }) {
		super(params.message);
		this.name = "HttpTransportError";
		this.status = params.status;
		this.code = params.code;
		this.retryable = params.retryable ?? (params.status === 429 || (params.status !== undefined && params.status >= 500));
		this.retryAfterSeconds = params.retryAfterSeconds;
	}
}

const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const DEFAULT_TIMEOUT_MS = 30_000;

export class FetchHttpTransport implements HttpTransport {
	async request<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
		const method = options?.method ?? "GET";
		const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const maxSizeBytes = options?.maxResponseSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

		const headers: Record<string, string> = { ...options?.headers };
		let body: string | undefined;

		if (options?.body !== undefined) {
			if (typeof options.body === "string") {
				body = options.body;
			} else if (Buffer.isBuffer(options.body)) {
				body = options.body.toString("utf8");
			} else if (options.body instanceof URLSearchParams) {
				body = options.body.toString();
				if (!headers["content-type"]) {
					headers["content-type"] = "application/x-www-form-urlencoded";
				}
			} else if (typeof options.body === "object") {
				body = JSON.stringify(options.body);
				if (!headers["content-type"]) {
					headers["content-type"] = "application/json";
				}
			}
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(url, {
				method,
				headers,
				body,
				signal: controller.signal,
			});

			const resHeaders: Record<string, string> = {};
			res.headers.forEach((v, k) => {
				resHeaders[k.toLowerCase()] = v;
			});

			const rawText = await res.text();
			if (rawText.length > maxSizeBytes) {
				throw new HttpTransportError({
					message: `Response size ${rawText.length} bytes exceeded maximum allowed ${maxSizeBytes} bytes`,
					status: res.status,
					code: "RESPONSE_OVERSIZED",
					retryable: false,
				});
			}

			let data: T;
			const contentType = resHeaders["content-type"] ?? "";
			if (contentType.includes("application/json") || rawText.trim().startsWith("{") || rawText.trim().startsWith("[")) {
				try {
					data = JSON.parse(rawText) as T;
				} catch {
					if (!res.ok) {
						throw new HttpTransportError({
							message: `HTTP ${res.status}: Malformed JSON in error response`,
							status: res.status,
							code: "MALFORMED_JSON",
							retryable: false,
						});
					}
					throw new HttpTransportError({
						message: "Failed to parse JSON response body",
						status: res.status,
						code: "MALFORMED_JSON",
						retryable: false,
					});
				}
			} else {
				data = rawText as unknown as T;
			}

			if (!res.ok) {
				let retryAfterSec: number | undefined;
				const retryAfterHeader = resHeaders["retry-after"];
				if (retryAfterHeader) {
					const parsedSec = parseInt(retryAfterHeader, 10);
					if (!isNaN(parsedSec)) {
						retryAfterSec = parsedSec;
					}
				}

				let code = `HTTP_${res.status}`;
				if (res.status === 400) code = "BAD_REQUEST";
				else if (res.status === 401) code = "UNAUTHORIZED";
				else if (res.status === 403) code = "FORBIDDEN";
				else if (res.status === 404) code = "NOT_FOUND";
				else if (res.status === 409) code = "CONFLICT";
				else if (res.status === 429) code = "RATE_LIMITED";
				else if (res.status >= 500) code = "SERVER_ERROR";

				const errObj = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
				const nestedErr = errObj && typeof errObj.error === "object" && errObj.error !== null ? (errObj.error as Record<string, unknown>) : null;
				const errMsg = (nestedErr?.message ? String(nestedErr.message) : undefined) ?? (errObj?.message ? String(errObj.message) : undefined) ?? `HTTP ${res.status} ${res.statusText}`;

				throw new HttpTransportError({
					message: errMsg,
					status: res.status,
					code,
					retryable: res.status === 429 || res.status >= 500,
					retryAfterSeconds: retryAfterSec,
				});
			}

			return {
				status: res.status,
				statusText: res.statusText,
				headers: resHeaders,
				data,
				rawText,
			};
		} catch (err: unknown) {
			if (err instanceof HttpTransportError) {
				throw err;
			}
			if ((err as Error)?.name === "AbortError") {
				throw new HttpTransportError({
					message: `Request timed out after ${timeoutMs}ms`,
					code: "TIMEOUT",
					retryable: true,
				});
			}
			throw new HttpTransportError({
				message: (err as Error)?.message ?? "Network transport error",
				code: "NETWORK_ERROR",
				retryable: true,
			});
		} finally {
			clearTimeout(timeoutId);
		}
	}
}

let activeTransport: HttpTransport = new FetchHttpTransport();

export function getGlobalHttpTransport(): HttpTransport {
	return activeTransport;
}

export function setGlobalHttpTransport(transport: HttpTransport | null): void {
	activeTransport = transport ?? new FetchHttpTransport();
}
