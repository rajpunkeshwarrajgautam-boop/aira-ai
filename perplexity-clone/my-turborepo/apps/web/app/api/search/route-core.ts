import { z } from "zod";

import { auth } from "@/auth";
import { assertAnonymousSearchAllowed, AnonymousQuotaError } from "@/lib/anonymous-search-quota";
import { getOrCreateAnonymousIdCookie } from "@/lib/analytics/anon-id";
import {
	ensureSignupCompletedTracked,
	trackSearchErrorEvent,
	trackPlanRequiredEvent,
	trackQuotaExceededEvent,
	trackSearchEvent,
} from "@/lib/analytics/analytics-service";
import {
	consumeSearchQuota,
	assertMinPlan,
	getEffectiveEntitlements,
	PlanEnforcementError,
} from "@/lib/billing/plan-enforcement";
import { providerAccessTierForBillingPlan } from "@/lib/billing/provider-policy";
import {
	getAnonymousSearchContext,
	getFollowUpContext,
	persistConversationTurn,
} from "@/lib/conversation-memory";
import { resolveRuntimeTemplate } from "@/lib/prompts/runtime-template";
import { isGreetingOnlyQuery, tryParseMathAnswer } from "@/lib/search/no-quota-query";
import { streamGroundedAnswer } from "@services/answer";
import { streamDeepResearchAnswer } from "@services/deep-research";
import { ProviderRouter } from "@services/providers/provider-router";
import {
	inferSourceQualityLabel,
	sanitizeSourceExcerpt,
	type SourceQualityLabel,
} from "@services/source-quality";
import { BillingPlan } from "@/generated/prisma/enums";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** Match upstream retrieval + generation budgets for hosted deployments (override per platform). */
export const maxDuration = 300;

const SearchRequestSchema = z.object({
	query: z
		.string()
		.min(1, { error: "query must not be empty" })
		.max(16_000, { error: "query exceeds maximum length" })
		.transform((s) => s.trim()),
	conversationId: z.string().min(3).max(128).optional(),
	parentMessageId: z.string().min(3).max(128).optional(),
	continueResearch: z.boolean().optional(),
	mode: z.enum(["standard", "deep"]).optional().default("standard"),
	presetId: z.string().optional().default("general"),
	/**
	 * Explicit per-request prompt template. When absent, the conversation or
	 * workspace assignment applies. Selecting a template here never changes a
	 * stored default — scope changes go through /api/prompts/assignments.
	 */
	promptId: z.string().min(3).max(128).optional(),
});

type CitationPayload = {
	readonly index: number;
	readonly url: string;
	readonly title: string;
	readonly publishedDate: string | null;
	readonly rankingScore: number;
	readonly excerpt?: string;
	readonly sourceQuality?: SourceQualityLabel;
};

const MAX_CITATION_EXCERPT_CHARS = 400;

function trimCitationExcerpt(excerpt: string): string | undefined {
	const t = sanitizeSourceExcerpt(excerpt);
	if (!t) return undefined;
	if (t.length <= MAX_CITATION_EXCERPT_CHARS) return t;
	return `${t.slice(0, MAX_CITATION_EXCERPT_CHARS - 1)}…`;
}

function mapCitation(s: {
	readonly index: number;
	readonly url: string;
	readonly title: string;
	readonly publishedDate: string | null;
	readonly compositeScore: number;
	readonly excerpt: string;
}): CitationPayload {
	const excerpt = trimCitationExcerpt(s.excerpt);
	const sourceQuality = inferSourceQualityLabel(s.url, s.title);
	return {
		index: s.index,
		url: s.url,
		title: s.title,
		publishedDate: s.publishedDate,
		rankingScore: s.compositeScore,
		sourceQuality,
		...(excerpt !== undefined ? { excerpt } : {}),
	};
}

type MetadataEvent = {
	readonly type: "metadata";
	readonly query: string;
	readonly citations: readonly CitationPayload[];
	readonly exaRequestId?: string;
	readonly exaSearchType?: string;
};

type TextEvent = {
	readonly type: "text";
	readonly delta: string;
};

type DoneEvent = {
	readonly type: "done";
	readonly conversationId?: string;
	readonly messageId?: string;
};

type StreamErrorEvent = {
	readonly type: "stream_error";
	readonly code: string;
	readonly message: string;
};

function sseEncode(event: string, payload: unknown): Uint8Array {
	const data = JSON.stringify(payload);
	const encoder = new TextEncoder();
	return encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
}

function jsonErrorResponse(
	status: number,
	code: string,
	message: string,
	details?: unknown,
): Response {
	const body: Record<string, unknown> = {
		error: {
			code,
			message,
			...(details !== undefined ? { details } : {}),
		},
	};
	return Response.json(body, {
		status,
		headers: {
			"Cache-Control": "no-store",
		},
	});
}

function classifyUpstreamError(err: Error): { status: number; code: string; clientMessage: string } {
	const upstream = err as Error & {
		readonly code?: unknown;
		readonly status?: unknown;
		readonly error?: {
			readonly code?: unknown;
			readonly message?: unknown;
		};
	};
	const msg = [
		err.message,
		typeof upstream.code === "string" ? upstream.code : "",
		typeof upstream.error?.code === "string" ? upstream.error.code : "",
		typeof upstream.error?.message === "string" ? upstream.error.message : "",
	]
		.join(" ")
		.toLowerCase();

	if (
		msg.includes("insufficient_quota") ||
		msg.includes("billing_hard_limit_reached") ||
		msg.includes("exceeded your current quota")
	) {
		return {
			status: 503,
			code: "UPSTREAM_QUOTA_EXHAUSTED",
			clientMessage: "The AI answer provider is temporarily unavailable. Please retry shortly.",
		};
	}

	if (
		msg.includes("api key missing") ||
		msg.includes("api key") ||
		msg.includes("authentication") ||
		msg.includes("401") ||
		msg.includes("no ai providers configured") ||
		msg.includes("no fallback is available")
	) {
		return {
			status: 503,
			code: "UPSTREAM_CONFIG",
			clientMessage: "The AI answer provider is temporarily unavailable. Please retry shortly.",
		};
	}

	if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
		return {
			status: 429,
			code: "UPSTREAM_RATE_LIMIT",
			clientMessage: "The AI answer provider is busy. Please retry in a moment.",
		};
	}

	if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("aborted")) {
		return {
			status: 504,
			code: "UPSTREAM_TIMEOUT",
			clientMessage: "The request took too long to complete.",
		};
	}

	return {
		status: 502,
		code: "UPSTREAM_ERROR",
		clientMessage: "Search could not be completed.",
	};
}

async function handleSearchPost(req: Request): Promise<Response> {
	const session = await auth();
	const userId = session?.user?.id ?? null;
	const anonymousId = await getOrCreateAnonymousIdCookie();

	let body: unknown;
	try {
		body = await req.json();
	} catch (e) {
		console.error("SEARCH_ERROR:", e);
		return jsonErrorResponse(400, "INVALID_JSON", "Request body must be valid JSON.");
	}

	const parsed = SearchRequestSchema.safeParse(body);
	if (!parsed.success) {
		console.error("SEARCH_ERROR:", parsed.error);
		return jsonErrorResponse(400, "VALIDATION_ERROR", "Invalid request body.", z.treeifyError(parsed.error));
	}

	const mathAnswer = tryParseMathAnswer(parsed.data.query);
	const greetingOnly =
		mathAnswer === null && isGreetingOnlyQuery(parsed.data.query);
	const skipSearchQuota = mathAnswer !== null || greetingOnly;

	if (!userId) {
		if (parsed.data.conversationId || parsed.data.parentMessageId || parsed.data.continueResearch) {
			return jsonErrorResponse(
				401,
				"UNAUTHENTICATED",
				"Sign in to continue a saved conversation.",
			);
		}
		if (parsed.data.mode === "deep") {
			return jsonErrorResponse(
				402,
				"PLAN_REQUIRED",
				"Sign in to use Deep Research.",
			);
		}
		if (!skipSearchQuota) {
			try {
				await assertAnonymousSearchAllowed(anonymousId);
			} catch (e) {
				if (e instanceof AnonymousQuotaError) {
					return jsonErrorResponse(e.status, e.code, e.message);
				}
				throw e;
			}
		}
	}

	let entitlements: Awaited<ReturnType<typeof getEffectiveEntitlements>> | null = null;

	if (userId) {
		try {
			if (!skipSearchQuota) {
				if (parsed.data.mode === "deep") {
					await assertMinPlan(userId, BillingPlan.PRO);
				}
				entitlements = await consumeSearchQuota(userId);
			} else {
				entitlements = await getEffectiveEntitlements(userId);
			}
			await ensureSignupCompletedTracked({
				userId,
				anonymousId,
				plan: entitlements.billingPlan,
			});
		} catch (e) {
			if (e instanceof PlanEnforcementError) {
				if (e.code === "QUOTA_EXCEEDED") {
					await trackQuotaExceededEvent({
						userId,
						anonymousId,
					});
				} else if (e.code === "PLAN_REQUIRED" && parsed.data.mode === "deep") {
					await trackPlanRequiredEvent({
						userId,
						anonymousId,
						requiredPlan: BillingPlan.PRO,
					});
				}
				console.error("SEARCH_ERROR:", e);
				return jsonErrorResponse(e.status, e.code, e.message);
			}
			console.error("SEARCH_ERROR:", e);
			throw e;
		}
	}

	const abort = new AbortController();
	const reason = () => {
		const r = new DOMException("Client disconnected", "AbortError");
		return r;
	};

	const onAbort = () => abort.abort(reason());
	req.signal.addEventListener("abort", onAbort, { once: true });

	let context: Awaited<ReturnType<typeof getFollowUpContext>>;
	try {
		if (userId) {
			context = await getFollowUpContext({
				userId,
				query: parsed.data.query,
				conversationId: parsed.data.conversationId,
				parentMessageId: parsed.data.parentMessageId,
				messageLimit: parsed.data.continueResearch ? 20 : 10,
				memoryLimit: parsed.data.continueResearch ? 8 : 5,
			});
		} else {
			context = getAnonymousSearchContext();
		}
	} catch (e) {
		console.error("SEARCH_ERROR:", e);
		return jsonErrorResponse(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
	}


	/**
	 * Prompt Studio template for this request, resolved server-side and scoped
	 * to the signed-in user. It compiles into the low-trust `template` layer, so
	 * it can shape voice and structure but cannot weaken AIRA's grounding,
	 * citation or safety policy.
	 */
	const promptTemplate = await resolveRuntimeTemplate({
		userId,
		promptId: parsed.data.promptId,
		conversationId: parsed.data.conversationId ?? context.resolvedConversationId ?? null,
	});

	let grounded:
		| Awaited<ReturnType<typeof streamGroundedAnswer>>
		| Awaited<ReturnType<typeof streamDeepResearchAnswer>>;
	/** Analytics mode: bypass paths always count as standard (no web retrieval). */
	let analyticsSearchMode: "standard" | "deep" = parsed.data.mode;
	try {
		const providerTier = providerAccessTierForBillingPlan(entitlements?.billingPlan);
		if (mathAnswer !== null) {
			analyticsSearchMode = "standard";
			let resultText = mathAnswer;
			try {
				const mathExpression = parsed.data.query
					.trim()
					.replace(/^\/calc\s+/i, "")
					.replace(/^=\s*/, "");
				const { globalToolRegistry, registerBuiltInTools } = await import(
					"@/lib/agents/tools/tool-registry"
				);
				await registerBuiltInTools();
				const toolResult = await globalToolRegistry.executeTool<{ result: number }>(
					"calculator",
					{ expression: mathExpression },
				);
				resultText = String(toolResult.result);
			} catch {
				// keep tryParseMathAnswer fallback
			}
			grounded = {
				query: parsed.data.query.trim(),
				sources: [],
				exaRequestId: undefined,
				exaSearchType: undefined,
				textStream: (async function* () {
					yield `The result is **${resultText}**.`;
				})(),
			};
		} else if (greetingOnly) {
			analyticsSearchMode = "standard";
			grounded = await streamGroundedAnswer({
				query: parsed.data.query,
				router: await ProviderRouter.createDefault(providerTier),
				abortSignal: abort.signal,
				chatHistory: context.chatHistory,
				contextualMemory: context.contextualMemory,
				disableSearch: true,
				presetId: parsed.data.presetId,
				promptTemplate,
			});
		} else if (parsed.data.mode === "deep") {
			const isAgenticEnabled = process.env.AGENTIC_DEEP_RESEARCH_ENABLED === "true";

			if (isAgenticEnabled) {
				const { ResearchOrchestrator } = await import(
					"@/lib/agents/orchestrator/research-orchestrator"
				);
				grounded = await ResearchOrchestrator.streamAnswer({
					query: parsed.data.query,
					router: await ProviderRouter.createDefault(providerTier),
					abortSignal: abort.signal,
					chatHistory: context.chatHistory,
					contextualMemory: context.contextualMemory,
					presetId: parsed.data.presetId,
				});
			} else {
				grounded = await streamDeepResearchAnswer({
					query: parsed.data.query,
					router: await ProviderRouter.createDefault(providerTier),
					abortSignal: abort.signal,
					chatHistory: context.chatHistory,
					contextualMemory: context.contextualMemory,
					presetId: parsed.data.presetId,
				});
			}
		} else {
			grounded = await streamGroundedAnswer({
				query: parsed.data.query,
				router: await ProviderRouter.createDefault(providerTier),
				abortSignal: abort.signal,
				chatHistory: context.chatHistory,
				contextualMemory: context.contextualMemory,
				presetId: parsed.data.presetId,
				promptTemplate,
			});
		}
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		console.error("SEARCH_ERROR:", err);
		const { status, code, clientMessage } = classifyUpstreamError(err);
		const message =
			process.env.NODE_ENV === "development" ? err.message : clientMessage;

		await trackSearchErrorEvent({
			userId: userId ?? undefined,
			anonymousId,
			code,
			message,
			metadata: {
				mode: parsed.data.mode,
			},
		});
		return jsonErrorResponse(status, code, message);
	} finally {
		req.signal.removeEventListener("abort", onAbort);
	}

	const metadata: MetadataEvent = {
		type: "metadata",
		query: grounded.query,
		citations: grounded.sources.map(mapCitation),
		exaRequestId: grounded.exaRequestId,
		exaSearchType: grounded.exaSearchType,
	};

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(sseEncode("metadata", metadata));
			let fullText = "";
			let persistedConversationId: string | undefined;
			let persistedAssistantMessageId: string | undefined;

			try {
				for await (const delta of grounded.textStream) {
					if (abort.signal.aborted) break;
					fullText += delta;
					const chunk: TextEvent = { type: "text", delta };
					controller.enqueue(sseEncode("text", chunk));
				}

				if (!abort.signal.aborted) {
					// Strip phantom citation markers before persisting.
					// Valid indices come from the ranked sources sent in metadata.
					const validIndices = new Set(grounded.sources.map((s) => s.index));
					const cleanedText = fullText.replace(
						/\[(\d{1,4})\]/g,
						(match, num: string) => {
							const n = parseInt(num, 10);
							return validIndices.has(n) ? match : "";
						},
					);

					if (userId) {
						const persisted = await persistConversationTurn({
							userId,
							query: parsed.data.query,
							answer: cleanedText,
							conversationId: context.resolvedConversationId,
							parentMessageId: parsed.data.parentMessageId,
							citations: metadata.citations,
							exaRequestId: metadata.exaRequestId,
							exaSearchType: metadata.exaSearchType,
						});
						persistedConversationId = persisted.conversationId;
						persistedAssistantMessageId = persisted.assistantMessageId;
					}

					await trackSearchEvent({
						userId: userId ?? undefined,
						anonymousId,
						plan: entitlements?.billingPlan ?? BillingPlan.FREE,
						mode: analyticsSearchMode,
						citationCount: metadata.citations.length,
						exaSearchType: metadata.exaSearchType,
					});

					const done: DoneEvent = {
						type: "done",
						conversationId: persistedConversationId,
						messageId: persistedAssistantMessageId,
					};
					controller.enqueue(sseEncode("done", done));
				}
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				console.error("SEARCH_ERROR:", err);
				const { code, clientMessage } = classifyUpstreamError(err);
				const message =
					process.env.NODE_ENV === "development" ? err.message : clientMessage;

				await trackSearchErrorEvent({
					userId: userId ?? undefined,
					anonymousId,
					code,
					message,
					metadata: { mode: parsed.data.mode },
				});

				const payload: StreamErrorEvent = {
					type: "stream_error",
					code,
					message,
				};
				controller.enqueue(sseEncode("error", payload));
			} finally {
				controller.close();
			}
		},
		cancel() {
			abort.abort(reason());
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}

export async function POST(req: Request): Promise<Response> {
	try {
		return await handleSearchPost(req);
	} catch (error) {
		console.error("SEARCH_ERROR:", error);
		const message =
			process.env.NODE_ENV === "development" && error instanceof Error
				? error.message
				: "Search could not be completed.";
		return new Response(
			JSON.stringify({
				error: "Search failed",
				message,
			}),
			{
				status: 500,
				headers: {
					"Content-Type": "application/json",
					"Cache-Control": "no-store",
				},
			},
		);
	}
}

export function GET(): Response {
	return new Response(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }), {
		status: 405,
		headers: {
			Allow: "POST",
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
	});
}
