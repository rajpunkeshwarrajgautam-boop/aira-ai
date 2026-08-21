import { z } from "zod";

import { runHybridTextTask, type HybridTextResult } from "./hybrid-router";

export const LeadWorkerInputSchema = z.object({
	name: z.string().trim().max(200).optional().default(""),
	company: z.string().trim().max(300).optional().default(""),
	role: z.string().trim().max(200).optional().default(""),
	source: z.string().trim().max(500).optional().default(""),
	notes: z.string().trim().min(2).max(12_000),
});

export const LeadWorkerOutputSchema = z.object({
	industry: z.string().max(160),
	intent: z.enum(["buyer", "partner", "vendor", "investor", "unknown"]),
	lead_score: z.number().int().min(0).max(100),
	priority: z.enum(["low", "medium", "high"]),
	recommended_service: z.string().max(300),
	next_action: z.string().max(500),
	rationale: z.string().max(900),
});

export const EmailWorkerInputSchema = z.object({
	from: z.string().trim().max(320).optional().default(""),
	subject: z.string().trim().max(500).optional().default(""),
	body: z.string().trim().min(2).max(16_000),
});

export const EmailWorkerOutputSchema = z.object({
	category: z.enum(["sales", "customer", "support", "partnership", "invoice", "admin", "spam", "other"]),
	priority: z.enum(["low", "medium", "high"]),
	requires_reply: z.boolean(),
	summary: z.string().max(900),
	requested_action: z.string().max(700),
	suggested_next_step: z.string().max(700),
	entities: z.array(z.string().max(180)).max(20),
});

function parseJsonObject(raw: string): unknown {
	let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("Worker returned no JSON object.");
	text = text.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
	return JSON.parse(text) as unknown;
}

async function runStructuredWorker<T>(args: {
	readonly system: string;
	readonly prompt: string;
	readonly taskKind: "lead" | "email";
	readonly schema: z.ZodType<T>;
}): Promise<{ readonly data: T; readonly execution: Omit<HybridTextResult, "text"> }> {
	const result = await runHybridTextTask({
		system: args.system,
		prompt: args.prompt,
		taskKind: args.taskKind,
		temperature: 0,
		maxCompletionTokens: 1200,
	});
	const parsed = args.schema.parse(parseJsonObject(result.text));
	const { text: _text, ...execution } = result;
	return { data: parsed, execution };
}

export async function runLeadWorker(input: z.infer<typeof LeadWorkerInputSchema>) {
	return runStructuredWorker({
		taskKind: "lead",
		schema: LeadWorkerOutputSchema,
		system:
			"You are Virexa AI Ventures' private lead qualification worker. Use only the supplied prospect data. Do not invent company facts, revenue, headcount, budget, contacts, or intent. Score fit and urgency conservatively. Return exactly one JSON object and no markdown.",
		prompt: `Qualify this lead for Virexa AI Ventures.\n\nName: ${input.name || "unknown"}\nCompany: ${input.company || "unknown"}\nRole: ${input.role || "unknown"}\nSource: ${input.source || "unknown"}\nNotes:\n${input.notes}\n\nReturn keys exactly: industry, intent, lead_score, priority, recommended_service, next_action, rationale. intent must be buyer|partner|vendor|investor|unknown. priority must be low|medium|high. lead_score is an integer 0-100.`,
	});
}

export async function runEmailWorker(input: z.infer<typeof EmailWorkerInputSchema>) {
	return runStructuredWorker({
		taskKind: "email",
		schema: EmailWorkerOutputSchema,
		system:
			"You are Virexa AI Ventures' private inbox triage worker. Classify only what is present in the email. Do not invent sender identity or obligations. Return exactly one JSON object and no markdown.",
		prompt: `Triage this business email.\n\nFrom: ${input.from || "unknown"}\nSubject: ${input.subject || "(none)"}\nBody:\n${input.body}\n\nReturn keys exactly: category, priority, requires_reply, summary, requested_action, suggested_next_step, entities. category must be sales|customer|support|partnership|invoice|admin|spam|other. priority must be low|medium|high. entities is an array of names, companies, dates, amounts, or products explicitly present in the email.`,
	});
}
