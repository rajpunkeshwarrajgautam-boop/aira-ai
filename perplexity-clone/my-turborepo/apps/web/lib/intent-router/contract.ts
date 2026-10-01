import { z } from "zod";

export const IntentSchema = z.enum([
	"ANSWER",
	"RESEARCH",
	"TOOL_ACTION",
	"WORKFLOW",
	"AUTOMATION_CREATE",
	"AGENT_MISSION",
]);

export const ComplexitySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const RiskSchema = z.enum(["READ_ONLY", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const SideEffectSchema = z.enum(["NONE", "READ", "WRITE", "SEND", "PUBLISH", "DELETE", "FINANCIAL"]);
export const ExecutionSurfaceSchema = z.enum([
	"SEARCH",
	"DEEP_RESEARCH",
	"TOOL_GATEWAY",
	"AUTOMATION_ENGINE",
	"WORK_PLANNER",
]);

export const RecurrenceSchema = z
	.object({
		type: z.enum(["cron", "interval", "event"]),
		schedule: z.string().min(1).max(160).optional(),
		timezone: z.string().min(1).max(100).optional(),
		event: z.string().min(1).max(160).optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.type === "cron" || value.type === "interval") && !value.schedule) {
			context.addIssue({ code: "custom", message: `${value.type} recurrence requires a schedule`, path: ["schedule"] });
		}
		if (value.type === "event" && !value.event) {
			context.addIssue({ code: "custom", message: "event recurrence requires an event", path: ["event"] });
		}
	});

export const IntentDecisionSchema = z
	.object({
		intent: IntentSchema,
		confidence: z.number().min(0).max(1),
		complexity: ComplexitySchema,
		risk: RiskSchema,
		sideEffect: SideEffectSchema,
		requiredCapabilities: z.array(z.string().min(1).max(120)).max(32),
		requiresApproval: z.boolean(),
		recurrence: RecurrenceSchema.optional(),
		executionSurface: ExecutionSurfaceSchema,
		fallbackReason: z.string().min(1).max(240).optional(),
	})
	.strict();

export type Intent = z.infer<typeof IntentSchema>;
export type Complexity = z.infer<typeof ComplexitySchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type SideEffect = z.infer<typeof SideEffectSchema>;
export type ExecutionSurface = z.infer<typeof ExecutionSurfaceSchema>;
export type Recurrence = z.infer<typeof RecurrenceSchema>;
export type IntentDecision = z.infer<typeof IntentDecisionSchema>;

export const SemanticIntentProposalSchema = z
	.object({
		intent: IntentSchema,
		confidence: z.number().min(0).max(1),
		complexity: ComplexitySchema,
		requiredCapabilities: z.array(z.string().min(1).max(120)).max(32),
		recurrence: RecurrenceSchema.optional(),
		executionSurface: ExecutionSurfaceSchema,
	})
	.strict();

export type SemanticIntentProposal = z.infer<typeof SemanticIntentProposalSchema>;

export const EXPLICIT_COMMANDS = [
	"research",
	"deep",
	"plan",
	"agent",
	"team",
	"work",
	"tasks",
	"tools",
	"skills",
	"teams",
	"history",
	"new",
	"share",
] as const;

export const ExplicitCommandRouteSchema = z
	.object({
		kind: z.literal("EXPLICIT_COMMAND"),
		command: z.enum(EXPLICIT_COMMANDS),
		rawInput: z.string().min(1),
	})
	.strict();

export const IntentRouteSchema = z
	.object({
		kind: z.literal("INTENT"),
		decision: IntentDecisionSchema,
	})
	.strict();

export const IntentRouteResultSchema = z.discriminatedUnion("kind", [ExplicitCommandRouteSchema, IntentRouteSchema]);
export type IntentRouteResult = z.infer<typeof IntentRouteResultSchema>;
