import { auth } from "@/auth";
import { getAgentRun } from "@/lib/autogpt/runs";
import {
	fetchDeerFlowArtifact,
	normalizeDeerFlowArtifactPath,
} from "@/lib/deerflow/artifacts";
import { DeerFlowRequestError } from "@/lib/deerflow/client";
import { getDeerFlowConfig } from "@/lib/deerflow/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string; artifactPath: string[] }> };

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

function resultRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function recordedArtifacts(result: unknown): Set<string> {
	const record = resultRecord(result);
	const artifacts = record?.artifacts;
	if (!Array.isArray(artifacts)) return new Set();
	const paths = artifacts.flatMap((value) => {
		if (typeof value !== "string") return [];
		try {
			return [normalizeDeerFlowArtifactPath(value)];
		} catch {
			return [];
		}
	});
	return new Set(paths);
}

function recordedThreadId(result: unknown): string | null {
	const value = resultRecord(result)?.threadId;
	return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	const { runId, artifactPath } = await params;
	const run = await getAgentRun(session.user.id, runId);
	if (!run || run.provider !== "DEERFLOW" || run.status !== "COMPLETED") {
		return noStoreJson(
			{ error: { code: "NOT_FOUND", message: "DeerFlow artifact not found." } },
			{ status: 404 },
		);
	}

	let requestedPath: string;
	try {
		requestedPath = normalizeDeerFlowArtifactPath(artifactPath.join("/"));
	} catch {
		return noStoreJson(
			{ error: { code: "INVALID_ARTIFACT_PATH", message: "Invalid artifact path." } },
			{ status: 400 },
		);
	}
	if (!recordedArtifacts(run.result).has(requestedPath)) {
		return noStoreJson(
			{ error: { code: "NOT_FOUND", message: "DeerFlow artifact not found." } },
			{ status: 404 },
		);
	}
	const threadId = recordedThreadId(run.result);
	if (!threadId) {
		return noStoreJson(
			{ error: { code: "ARTIFACT_STATE_INVALID", message: "Artifact metadata is incomplete." } },
			{ status: 409 },
		);
	}

	try {
		const upstream = await fetchDeerFlowArtifact({
			config: getDeerFlowConfig(),
			ownerUserId: session.user.id,
			threadId,
			artifactPath: requestedPath,
			range: request.headers.get("range"),
		});
		const headers = new Headers({
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		});
		for (const name of [
			"content-type",
			"content-disposition",
			"content-length",
			"accept-ranges",
			"content-range",
			"etag",
			"last-modified",
		]) {
			const value = upstream.headers.get(name);
			if (value) headers.set(name, value);
		}
		return new Response(upstream.body, { status: upstream.status, headers });
	} catch (error) {
		if (error instanceof DeerFlowRequestError) {
			return noStoreJson(
				{ error: { code: error.code, message: error.message } },
				{ status: error.status },
			);
		}
		console.error("[agents:runs:artifact]", error);
		return noStoreJson(
			{ error: { code: "ARTIFACT_DOWNLOAD_FAILED", message: "Artifact download failed." } },
			{ status: 500 },
		);
	}
}
