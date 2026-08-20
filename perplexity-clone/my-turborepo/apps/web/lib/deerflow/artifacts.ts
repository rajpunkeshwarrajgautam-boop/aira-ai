import { DeerFlowRequestError } from "./client";
import type { DeerFlowConfig } from "./config";

const OUTPUT_PREFIX = "mnt/user-data/outputs/";

export function normalizeDeerFlowArtifactPath(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
	if (!normalized.startsWith(OUTPUT_PREFIX)) {
		throw new DeerFlowRequestError({
			code: "DEERFLOW_ARTIFACT_PATH_INVALID",
			message: "Only DeerFlow output artifacts can be downloaded through AIRA.",
			status: 400,
		});
	}
	const segments = normalized.split("/");
	if (
		normalized.length > 1_024 ||
		segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))
	) {
		throw new DeerFlowRequestError({
			code: "DEERFLOW_ARTIFACT_PATH_INVALID",
			message: "The DeerFlow artifact path is invalid.",
			status: 400,
		});
	}
	return normalized;
}

function artifactUrl(config: DeerFlowConfig, threadId: string, artifactPath: string): URL {
	const base = config.baseUrl.toString().replace(/\/+$/, "");
	const encodedPath = normalizeDeerFlowArtifactPath(artifactPath)
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return new URL(`${base}/api/threads/${encodeURIComponent(threadId)}/artifacts/${encodedPath}?download=true`);
}

export async function fetchDeerFlowArtifact(options: {
	readonly config: DeerFlowConfig;
	readonly ownerUserId: string;
	readonly threadId: string;
	readonly artifactPath: string;
	readonly range?: string | null;
}): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.config.requestTimeoutMs);
	const headers = new Headers({
		Accept: "*/*",
		"X-DeerFlow-Internal-Token": options.config.internalAuthToken,
		"X-DeerFlow-Owner-User-Id": options.ownerUserId,
	});
	if (options.range) headers.set("Range", options.range);

	try {
		const response = await fetch(
			artifactUrl(options.config, options.threadId, options.artifactPath),
			{
				method: "GET",
				headers,
				cache: "no-store",
				signal: controller.signal,
			},
		);
		if (!response.ok && response.status !== 206) {
			throw new DeerFlowRequestError({
				code: `DEERFLOW_ARTIFACT_HTTP_${response.status}`,
				message: response.status === 404
					? "The DeerFlow artifact is no longer available."
					: "The DeerFlow artifact could not be downloaded.",
				status: response.status === 404 ? 404 : 502,
				retryable: response.status >= 500,
			});
		}
		return response;
	} catch (error) {
		if (error instanceof DeerFlowRequestError) throw error;
		throw new DeerFlowRequestError({
			code: controller.signal.aborted ? "DEERFLOW_ARTIFACT_TIMEOUT" : "DEERFLOW_ARTIFACT_UNREACHABLE",
			message: controller.signal.aborted
				? "The DeerFlow artifact download timed out."
				: "The DeerFlow artifact service could not be reached.",
			status: 503,
			retryable: true,
		});
	} finally {
		clearTimeout(timer);
	}
}
