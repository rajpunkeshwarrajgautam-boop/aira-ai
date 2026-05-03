import { z } from "zod";
import { type AgentTool } from "./tool-registry";

export const calculatorTool: AgentTool<{ expression: string }, { result: number }> = {
	name: "calculator",
	description: "Calculates the result of a mathematical expression.",
	category: "utility",
	requiresAuth: false,
	requiresPermission: false,
	inputSchema: z.object({
		expression: z.string().describe("The mathematical expression to evaluate (e.g., '2 + 2')"),
	}),
	execute: async ({ expression }) => {
		console.log(`[Tool: Calculator] Evaluating: ${expression}`);
		
		// Safety check: Only allow numbers, basic operators, spaces, and parentheses
		const safeExpression = expression.replace(/\s+/g, "");
		if (!/^[0-9+\-*/().]+$/.test(safeExpression)) {
			throw new Error("Invalid characters in mathematical expression. Only numbers and +-*/(). are allowed.");
		}

		try {
			// Using Function constructor on a whitelisted string
			const result = new Function(`return (${safeExpression})`)();
			
			if (typeof result !== "number" || !Number.isFinite(result)) {
				throw new Error("Result is not a finite number.");
			}

			return { result };
		} catch (error) {
			console.error("[Tool: Calculator] Evaluation error:", error);
			throw new Error("Failed to evaluate mathematical expression.");
		}
	},
};
