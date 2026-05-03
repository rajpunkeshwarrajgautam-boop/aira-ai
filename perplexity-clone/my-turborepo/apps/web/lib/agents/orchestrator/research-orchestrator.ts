import { z } from "zod";
import { globalToolRegistry } from "../tools/tool-registry";
import { ProviderRouter } from "../../../src/services/providers/provider-router";
import type { DeepResearchInput, DeepResearchStreamResult } from "../../../src/services/deep-research";
import type { RankedSource } from "../../../src/services/citations";

const PlanOutputSchema = z.object({
	subQueries: z.array(z.string().min(3).max(200)).min(2).max(5),
	answerOutline: z.array(z.string().min(3).max(80)).min(2).max(8),
});

type PlanOutput = z.infer<typeof PlanOutputSchema>;

export class ResearchOrchestrator {
	static async streamAnswer(input: DeepResearchInput): Promise<DeepResearchStreamResult> {
		console.log("[Orchestrator] Starting Agentic Deep Research...");
		
		// Ensure tools are registered
		const { registerBuiltInTools } = await import("../tools/tool-registry");
		await registerBuiltInTools();
		
		
		const router = input.router ?? (await ProviderRouter.createDefault());
		const abortSignal = input.abortSignal;

		// 0. Intent Classification (Intelligent Layer)
		const queryLower = input.query.toLowerCase().trim();
		const isMath = /^[0-9+\-*/().\s]+$/.test(queryLower) && /[0-9]/.test(queryLower) && /[+\-*/]/.test(queryLower);
		const isCalculatorRequested = queryLower.includes("calculate") || queryLower.includes("sum") || queryLower.includes("multiply");

		if (isMath || isCalculatorRequested) {
			console.log("[Orchestrator] Detected math/calculator intent. Executing calculator tool.");
			try {
				const mathResult = await globalToolRegistry.executeTool("calculator", { expression: input.query });
				
				async function* mathResultStream() {
					yield `The result of your calculation is: **${mathResult.result}**\n\nI used the deterministic calculator tool to ensure accuracy.`;
				}

				return {
					query: input.query,
					sources: [],
					textStream: mathResultStream(),
				};
			} catch (error) {
				console.error("[Orchestrator] Calculator tool failed, falling back to research flow", error);
			}
		}

		// Factual Bypass: Very short queries or specific factual keywords
		const factualKeywords = ["capital of", "who is", "when was", "where is", "population of", "height of"];
		const isFactual = factualKeywords.some(k => queryLower.includes(k)) || (queryLower.split(/\s+/).length <= 4 && queryLower.endsWith("?"));

		if (isFactual) {
			console.log("[Orchestrator] Detected simple factual intent. Bypassing complex planning.");
			// We skip Phase 1 (Planning) and set a single sub-query
			const plan = { subQueries: [input.query], answerOutline: ["Introduction", "Quick Fact", "Source Verification"] };
			return await this.executePlanAndStream(input, plan, router, abortSignal);
		}

		// 1. Planning Phase
		console.log("[Orchestrator] Phase 1: Planning");
		const planningMessages = [
			{ role: "system", content: "You are a research planner. Propose 3-5 sub-queries to answer the user's question. Return JSON only: { \"subQueries\": string[], \"answerOutline\": string[] }" },
			{ role: "user", content: `Question: ${input.query}` }
		];


		const streamPlan = router.streamChat(planningMessages as any, { temperature: 0.2, abortSignal });
		let planRaw = "";
		for await (const part of streamPlan) {
			planRaw += part;
		}

		let plan: PlanOutput;
		try {
			// Basic extraction logic for JSON
			const jsonMatch = planRaw.match(/\{[\s\S]*\}/);
			plan = PlanOutputSchema.parse(JSON.parse(jsonMatch ? jsonMatch[0] : planRaw));
		} catch (error) {
			console.error("[Orchestrator] Planning failed, falling back to single query", error);
			plan = { subQueries: [input.query], answerOutline: ["Introduction", "Analysis", "Conclusion"] };
		}

		return await this.executePlanAndStream(input, plan, router, abortSignal);
	}

	private static async executePlanAndStream(
		input: DeepResearchInput, 
		plan: PlanOutput, 
		router: ProviderRouter, 
		abortSignal?: AbortSignal
	): Promise<DeepResearchStreamResult> {
		// 2. Execution Phase (Tools)
		console.log(`[Orchestrator] Phase 2: Executing ${plan.subQueries.length} tool calls`);
		const allCandidates: any[] = [];
		
		const searchPromises = plan.subQueries.map(async (sq) => {
			if (abortSignal?.aborted) return;
			try {
				console.log(`[Orchestrator] Executing Tool: web_search for "${sq}"`);
				const result = await globalToolRegistry.executeTool("web_search", { 
					query: sq, 
					numResults: 5 
				});
				allCandidates.push(...(result.candidates || []));
			} catch (error) {
				console.error(`[Orchestrator] Tool execution failed for query "${sq}":`, error);
			}
		});

		await Promise.all(searchPromises);

		// 3. Processing Phase (Tools)
		console.log("[Orchestrator] Phase 3: Processing and Ranking Sources");
		let sources: RankedSource[] = [];
		try {
			const formatted = await globalToolRegistry.executeTool("citation_format", {
				candidates: allCandidates,
				rankingOptions: { maxSources: 12 }
			});
			sources = formatted.rankedSources || [];
		} catch (error) {
			console.error("[Orchestrator] Source processing failed:", error);
		}

		// 4. Generation Phase
		console.log("[Orchestrator] Phase 4: Generating Final Answer");
		const { getResearchPreset } = await import("../../../src/services/research-presets");
		const preset = getResearchPreset(input.presetId);
		
		const systemPrompt = `You are a helpful research assistant. Answer the question using the provided sources and citations [1], [2], etc.
		
Structure your response as follows:
1. **Summary**: A high-level, 2-3 line quick answer at the very top.
2. **Key Points**: Use a bulleted list for the most important facts.
3. **Detailed Analysis**: Use structured markdown sections (##) for in-depth explanation.

Rules:
- Place citations [1], [2], etc., immediately after the specific sentence or phrase they support.
- Maintain high readability with proper spacing and professional tone.\n\nStyle/Preset: ${preset.label}\n${preset.systemPromptModifier}`;

		const finalMessages = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: `Sources:\n${JSON.stringify(sources)}\n\nQuestion: ${input.query}\n\nOutline: ${plan.answerOutline.join(", ")}` }
		];

		async function* stream() {
			yield* router.streamChat(finalMessages as any, { 
				temperature: 0.2, 
				abortSignal 
			});
		}

		return {
			query: input.query,
			sources,
			textStream: stream(),
		};
	}
}
