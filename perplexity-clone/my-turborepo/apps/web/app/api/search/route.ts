import { z } from "zod";

import { auth } from "@/auth";
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
	PlanEnforcementError,
} from "@/lib/billing/plan-enforcement";
import {
	getFollowUpContext,
	persistConversationTurn,
} from "@/lib/conversation-memory";
import { streamGroundedAnswer } from "@services/answer";
import { streamDeepResearchAnswer } from "@services/deep-research";
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
});

type CitationPayload = {
	readonly index: number;
	readonly url: string;
	readonly title: string;
	readonly publishedDate: string | null;
	readonly rankingScore: number;
};

function mapCitation(s: {
	readonly index: number;
	readonly url: string;
	readonly title: string;
	readonly publishedDate: string | null;
	readonly compositeScore: number;
}): CitationPayload {
	return {
		index: s.index,
		url: s.url,
		title: s.title,
		publishedDate: s.publishedDate,
		rankingScore: s.compositeScore,
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
	const msg = err.message.toLowerCase();

	if (
		msg.includes("api key missing") ||
		msg.includes("api key") ||
		msg.includes("authentication") ||
		msg.includes("401")
	) {
		return {
			status: 503,
			code: "UPSTREAM_CONFIG",
			clientMessage: "Search is temporarily unavailable.",
		};
	}

	if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
		return {
			status: 429,
			code: "UPSTREAM_RATE_LIMIT",
			clientMessage: "Too many requests. Please retry shortly.",
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
	if (!session?.user?.id) {
		console.error("SEARCH_ERROR:", { code: "UNAUTHENTICATED", message: "Sign in to run search." });
		return jsonErrorResponse(401, "UNAUTHENTICATED", "Sign in to run search.");
	}

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

	let entitlements:
		| Awaited<ReturnType<typeof consumeSearchQuota>>
		| undefined;
	try {
		if (parsed.data.mode === "deep") {
			await assertMinPlan(session.user.id, BillingPlan.PRO);
		}
		entitlements = await consumeSearchQuota(session.user.id);
		await ensureSignupCompletedTracked({
			userId: session.user.id,
			anonymousId,
			plan: entitlements.billingPlan,
		});
	} catch (e) {
		if (e instanceof PlanEnforcementError) {
			if (e.code === "QUOTA_EXCEEDED") {
				await trackQuotaExceededEvent({
					userId: session.user.id,
					anonymousId,
				});
			} else if (e.code === "PLAN_REQUIRED" && parsed.data.mode === "deep") {
				await trackPlanRequiredEvent({
					userId: session.user.id,
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

	const abort = new AbortController();
	const reason = () => {
		const r = new DOMException("Client disconnected", "AbortError");
		return r;
	};

	const onAbort = () => abort.abort(reason());
	req.signal.addEventListener("abort", onAbort, { once: true });

	let context: Awaited<ReturnType<typeof getFollowUpContext>>;
	try {
		context = await getFollowUpContext({
			userId: session.user.id,
			query: parsed.data.query,
			conversationId: parsed.data.conversationId,
			parentMessageId: parsed.data.parentMessageId,
			messageLimit: parsed.data.continueResearch ? 20 : 10,
			memoryLimit: parsed.data.continueResearch ? 8 : 5,
		});
	} catch (e) {
		console.error("SEARCH_ERROR:", e);
		return jsonErrorResponse(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
	}

	function classifyQueryIntent(query: string): "simple_chat" | "research" | "math" {
		const q = query.trim().toLowerCase();
		
		// Math detection (minimal: check if it looks like a simple arithmetic expression)
		// Matches: 2+2, 10 * 45, (10+5)/2, etc.
		if (/^[0-9+\-*/().\s]+$/.test(q) && /[0-9]/.test(q) && /[+\-*/]/.test(q)) {
			return "math";
		}

		const exactGreetings = ["hi", "hello", "hey", "yo", "thanks", "thank you", "ok", "yes", "no"];
		if (exactGreetings.includes(q)) return "simple_chat";

		const researchKeywords = [
			"latest", "current", "news", "comparison", "compare", 
			"explain", "research", "best", "how", "why", "what", "who", "when", "where"
		];
		const words = q.split(/\s+/);

		for (const w of words) {
			if (researchKeywords.includes(w)) return "research";
		}

		if (words.length < 4 && !q.includes("?")) {
			return "simple_chat";
		}

		return "research";
	}

	let grounded:
		| Awaited<ReturnType<typeof streamGroundedAnswer>>
		| Awaited<ReturnType<typeof streamDeepResearchAnswer>>;
	try {
		const query = parsed.data.query;
		const intent = classifyQueryIntent(query);

		if (intent === "math") {
			const { globalToolRegistry, registerBuiltInTools } = await import("@/lib/agents/tools/tool-registry");
			await registerBuiltInTools();
			
			const result = await globalToolRegistry.executeTool("calculator", { expression: query });
			
			async function* mathStream() {
				yield `The result of **${query}** is **${result.result}**.`;
			}
			
			grounded = {
				query: query,
				sources: [],
				textStream: mathStream(),
			};
		} else if (parsed.data.mode === "deep") {
			const isAgenticEnabled = process.env.AGENTIC_DEEP_RESEARCH_ENABLED === "true";
			
			if (isAgenticEnabled) {
				const { ResearchOrchestrator } = await import("@/lib/agents/orchestrator/research-orchestrator");
				grounded = await ResearchOrchestrator.streamAnswer({
					query: parsed.data.query,
					abortSignal: abort.signal,
					chatHistory: context.chatHistory,
					contextualMemory: context.contextualMemory,
					presetId: parsed.data.presetId,
				});
			} else {
				grounded = await streamDeepResearchAnswer({
					query: parsed.data.query,
					abortSignal: abort.signal,
					chatHistory: context.chatHistory,
					contextualMemory: context.contextualMemory,
					presetId: parsed.data.presetId,
				});
			}
		} else if (intent === "simple_chat") {
			// Hardcode the short friendly response for basic greetings to save API calls,
			// or use disableSearch for general short non-questions.
			const q = parsed.data.query.trim().toLowerCase();
			if (["hi", "hello", "hey", "yo", "thanks", "thank you", "ok"].includes(q)) {
				async function* mockStream() {
					if (q.includes("thank")) {
						yield "You're welcome! Ask me anything you'd like to research.";
					} else if (q === "ok") {
						yield "Got it! Let me know if you need anything else.";
					} else {
						yield "Hi! Ask me anything you'd like to research.";
					}
				}
				grounded = {
					query: parsed.data.query,
					sources: [],
					textStream: mockStream()
				};
			} else {
				grounded = await streamGroundedAnswer({
					query: parsed.data.query,
					abortSignal: abort.signal,
					chatHistory: context.chatHistory,
					contextualMemory: context.contextualMemory,
					disableSearch: true,
					presetId: parsed.data.presetId,
				});
			}
		} else {
			grounded = await streamGroundedAnswer({
				query: parsed.data.query,
				abortSignal: abort.signal,
				chatHistory: context.chatHistory,
				contextualMemory: context.contextualMemory,
				presetId: parsed.data.presetId,
			});
		}
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		console.error("SEARCH_ERROR:", err);
		const { status, code, clientMessage } = classifyUpstreamError(err);
		const message =
			process.env.NODE_ENV === "development" ? err.message : clientMessage;

		await trackSearchErrorEvent({
			userId: session.user.id,
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
					const persisted = await persistConversationTurn({
						userId: session.user.id,
						query: parsed.data.query,
						answer: fullText,
						conversationId: context.resolvedConversationId,
						parentMessageId: parsed.data.parentMessageId,
						citations: metadata.citations,
						exaRequestId: metadata.exaRequestId,
						exaSearchType: metadata.exaSearchType,
					});
					persistedConversationId = persisted.conversationId;
					persistedAssistantMessageId = persisted.assistantMessageId;

					// Track successful search completion (funnel stage).
					await trackSearchEvent({
						userId: session.user.id,
						anonymousId,
						plan: entitlements?.billingPlan,
						mode: parsed.data.mode,
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
					userId: session.user.id,
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
		return new Response(
			JSON.stringify({
				error: "Search failed",
				message: error instanceof Error ? error.message : "unknown",
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
