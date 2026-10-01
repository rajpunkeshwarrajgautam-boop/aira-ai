import { CAPABILITY_REGISTRY, normalizeCapabilities, unavailableCapabilities } from "./capabilities";
import {
	EXPLICIT_COMMANDS,
	IntentDecisionSchema,
	IntentRouteResultSchema,
	SemanticIntentProposalSchema,
	type Complexity,
	type ExecutionSurface,
	type Intent,
	type IntentDecision,
	type IntentRouteResult,
	type Recurrence,
	type Risk,
	type SemanticIntentProposal,
	type SideEffect,
} from "./contract";

export interface IntentSignals {
	readonly normalizedText: string;
	readonly explanatory: boolean;
	readonly explicitDeepResearch: boolean;
	readonly capabilities: readonly string[];
	readonly recurrence?: Recurrence;
	readonly multiStep: boolean;
	readonly mission: boolean;
	readonly ambiguousConsequential: boolean;
}

export type SemanticClassifier = (input: {
	readonly message: string;
	readonly signals: IntentSignals;
}) => Promise<unknown>;

export interface RouteIntentOptions {
	readonly timezone?: string;
	readonly availableCapabilities?: ReadonlySet<string>;
	readonly semanticClassifier?: SemanticClassifier;
}

const RISK_ORDER: readonly Risk[] = ["READ_ONLY", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SIDE_EFFECT_ORDER: readonly SideEffect[] = ["NONE", "READ", "WRITE", "SEND", "PUBLISH", "DELETE", "FINANCIAL"];

function includesAny(text: string, expressions: readonly RegExp[]): boolean {
	return expressions.some((expression) => expression.test(text));
}

function parseRecurrence(text: string, timezone: string): Recurrence | undefined {
	const weekly = text.match(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
	if (weekly) {
		const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(weekly[1]!.toLowerCase());
		let hour = Number(weekly[2] ?? 9);
		const minute = Number(weekly[3] ?? 0);
		const meridiem = weekly[4]?.toLowerCase();
		if (meridiem === "pm" && hour < 12) hour += 12;
		if (meridiem === "am" && hour === 12) hour = 0;
		return { type: "cron", schedule: `${minute} ${hour} * * ${day}`, timezone };
	}

	const interval = text.match(/\bevery\s+(\d+)\s+(minute|hour|day|week)s?\b/i);
	if (interval) return { type: "interval", schedule: `every ${interval[1]} ${interval[2]!.toLowerCase()}(s)`, timezone };

	if (/\b(whenever|when)\b/i.test(text)) {
		if (/\b(email|message)\b.*\b(arrives?|received?)\b/i.test(text)) return { type: "event", event: "email.received" };
		if (/\b(invoice|file)\b.*\b(appears?|created|uploaded)\b.*\bdrive\b/i.test(text)) return { type: "event", event: "drive.file.created" };
	}
	return undefined;
}

export function extractIntentSignals(message: string, timezone = "UTC"): IntentSignals {
	const normalizedText = message.trim().replace(/\s+/g, " ").toLowerCase();
	const explanatory = /^(explain|describe|show me an example|how (?:do|does|to|can)|what (?:is|are)|i need a strategy)\b/.test(normalizedText);
	const recurrence = parseRecurrence(normalizedText, timezone);
	const capabilities: string[] = [];
	const add = (capability: string) => capabilities.push(capability);

	if (!explanatory && /\b(calendar|schedule|appointments?)\b/.test(normalizedText)) add(/\b(create|add|book|schedule)\b/.test(normalizedText) ? "calendar.create" : "calendar.read");
	if (!explanatory && /\b(drive|google drive)\b/.test(normalizedText)) add(/\b(write|upload|update|save)\b/.test(normalizedText) ? "drive.write" : /\b(find|search|latest|invoice)\b/.test(normalizedText) ? "drive.search" : "drive.read");
	if (!explanatory && /\b(draft|prepare)\b.*\b(email|emails|message|outreach|drafts)\b/.test(normalizedText)) add("email.draft");
	if (!explanatory && (/\b(send|email)\b.*\b(to|through|customer|recipient|rahul|gmail|email)\b/.test(normalizedText) || /\balert|notify\b.*\bslack\b/.test(normalizedText))) {
		add(/\bslack\b/.test(normalizedText) ? "slack.send" : "email.send");
	}
	if (!explanatory && !capabilities.includes("email.draft") && /\b(email|emails|inbox)\b/.test(normalizedText) && /\b(check|read|find|search|latest)\b/.test(normalizedText)) add("email.read");
	if (!explanatory && /\b(leads?|prospects?)\b/.test(normalizedText) && /\b(find|search|new)\b/.test(normalizedText)) add("crm.lead.search");
	if (!explanatory && /\benrich\b/.test(normalizedText)) add("crm.lead.enrich");
	if (!explanatory && /\b(add|create)\b.*\b(crm|contacts?|qualified)\b|\badd qualified ones to crm\b/.test(normalizedText)) add("crm.contact.create");
	if (!explanatory && /\b(update)\b.*\bcrm\b/.test(normalizedText)) add("crm.contact.update");
	if (!explanatory && /(?:\bclassify\b.*\b(support|email)\b|\b(support|email)\b.*\bclassify\b)/.test(normalizedText)) add("support.classify");
	if (!explanatory && /\bpublish\b/.test(normalizedText)) add("content.publish");
	if (!explanatory && /\bdelete|remove everything\b/.test(normalizedText)) add("resource.delete");
	if (!explanatory && /\b(buy|purchase|transfer|pay)\b/.test(normalizedText)) add("finance.transfer");

	const operationalSteps = normalizeCapabilities(capabilities).length;
	const multiStep = operationalSteps >= 3 || (!explanatory && (normalizedText.match(/\b(and|then)\b/g)?.length ?? 0) >= 2);
	const mission = !explanatory && includesAny(normalizedText, [
		/\b(research|analy[sz]e)\b.*\b(strategy|decide)\b.*\b(plan)\b.*\b(carry it out|execute|implement)\b/,
		/\b(run|launch|start)\b.*\b(autonomous|agent|mission)\b/,
	]);
	const ambiguousConsequential = !explanatory && capabilities.length === 0 && /\b(handle|manage|take care of)\b.*\b(email|emails|inbox|calendar|crm)\b/.test(normalizedText);

	return {
		normalizedText,
		explanatory,
		explicitDeepResearch: /\b(deep research|in-depth research|comprehensive research)\b/.test(normalizedText),
		capabilities: normalizeCapabilities(capabilities),
		recurrence,
		multiStep,
		mission,
		ambiguousConsequential,
	};
}

function surfaceFor(intent: Intent, signals: IntentSignals): ExecutionSurface {
	if (intent === "RESEARCH") return signals.explicitDeepResearch ? "DEEP_RESEARCH" : "SEARCH";
	if (intent === "TOOL_ACTION") return "TOOL_GATEWAY";
	if (intent === "WORKFLOW") return "AUTOMATION_ENGINE";
	if (intent === "AUTOMATION_CREATE") return "AUTOMATION_ENGINE";
	if (intent === "AGENT_MISSION") return "WORK_PLANNER";
	return "SEARCH";
}

function deterministicProposal(signals: IntentSignals): SemanticIntentProposal {
	if (signals.explanatory) return { intent: "ANSWER", confidence: 0.98, complexity: "LOW", requiredCapabilities: ["answer.generate"], executionSurface: "SEARCH" };
	if (signals.mission) return { intent: "AGENT_MISSION", confidence: 0.96, complexity: "HIGH", requiredCapabilities: ["agent.plan"], executionSurface: "WORK_PLANNER" };
	if (signals.recurrence && signals.capabilities.length > 0) return { intent: "AUTOMATION_CREATE", confidence: 0.97, complexity: "HIGH", requiredCapabilities: ["automation.create", ...signals.capabilities], recurrence: signals.recurrence, executionSurface: "AUTOMATION_ENGINE" };
	if (signals.multiStep && signals.capabilities.length > 0) return { intent: "WORKFLOW", confidence: 0.94, complexity: "HIGH", requiredCapabilities: [...signals.capabilities], executionSurface: "AUTOMATION_ENGINE" };
	if (signals.capabilities.length > 0) return { intent: "TOOL_ACTION", confidence: 0.94, complexity: "MEDIUM", requiredCapabilities: [...signals.capabilities], executionSurface: "TOOL_GATEWAY" };
	if (/\b(research|compare|investigate)\b/.test(signals.normalizedText) && /\b(current|latest|sources?|market|capabilit)/.test(signals.normalizedText)) {
		const capability = signals.explicitDeepResearch ? "research.deep_research" : "research.web_search";
		return { intent: "RESEARCH", confidence: 0.93, complexity: signals.explicitDeepResearch ? "HIGH" : "MEDIUM", requiredCapabilities: [capability], executionSurface: surfaceFor("RESEARCH", signals) };
	}
	if (signals.ambiguousConsequential) return { intent: "TOOL_ACTION", confidence: 0.35, complexity: "MEDIUM", requiredCapabilities: [], executionSurface: "TOOL_GATEWAY" };
	return { intent: "ANSWER", confidence: 0.72, complexity: "LOW", requiredCapabilities: ["answer.generate"], executionSurface: "SEARCH" };
}

function maxByOrder<T extends string>(values: readonly T[], order: readonly T[]): T {
	return values.reduce((highest, value) => (order.indexOf(value) > order.indexOf(highest) ? value : highest), order[0]!);
}

export function applyDeterministicPolicy(proposal: SemanticIntentProposal, signals: IntentSignals, availableCapabilities?: ReadonlySet<string>): IntentDecision {
	const requiredCapabilities = normalizeCapabilities(proposal.requiredCapabilities);
	const policies = requiredCapabilities.map((capability) => CAPABILITY_REGISTRY.get(capability));
	const hasUnknownCapability = policies.some((policy) => !policy);
	const knownPolicies = policies.filter((policy) => policy !== undefined);
	let risk: Risk = hasUnknownCapability ? "CRITICAL" : maxByOrder(knownPolicies.map((policy) => policy.risk), RISK_ORDER);
	let sideEffect: SideEffect = hasUnknownCapability ? "WRITE" : maxByOrder(knownPolicies.map((policy) => policy.sideEffect), SIDE_EFFECT_ORDER);
	let requiresApproval = hasUnknownCapability || knownPolicies.some((policy) => policy.requiresApproval);

	if (proposal.intent === "AUTOMATION_CREATE" || proposal.intent === "AGENT_MISSION") requiresApproval = true;
	if (signals.ambiguousConsequential) {
		risk = maxByOrder([risk, "HIGH"], RISK_ORDER);
		sideEffect = maxByOrder([sideEffect, "WRITE"], SIDE_EFFECT_ORDER);
		requiresApproval = true;
	}

	const unavailable = unavailableCapabilities(requiredCapabilities, availableCapabilities);
	let fallbackReason: string | undefined;
	if (signals.ambiguousConsequential || (proposal.confidence < 0.7 && sideEffect !== "NONE" && sideEffect !== "READ")) fallbackReason = "CLARIFICATION_REQUIRED: consequential intent is ambiguous";
	else if (unavailable.length > 0) fallbackReason = `CAPABILITY_UNAVAILABLE: ${unavailable.join(",")}`;

	return IntentDecisionSchema.parse({
		...proposal,
		executionSurface: surfaceFor(proposal.intent, signals),
		requiredCapabilities,
		risk,
		sideEffect,
		requiresApproval,
		...(fallbackReason ? { fallbackReason } : {}),
	});
}

function explicitCommand(message: string): IntentRouteResult | undefined {
	const match = message.trim().match(/^\/([a-z]+)(?:\s|$)/i);
	if (!match) return undefined;
	const command = match[1]!.toLowerCase();
	if (!EXPLICIT_COMMANDS.includes(command as (typeof EXPLICIT_COMMANDS)[number])) return undefined;
	return IntentRouteResultSchema.parse({ kind: "EXPLICIT_COMMAND", command, rawInput: message });
}

export async function routeIntent(message: string, options: RouteIntentOptions = {}): Promise<IntentRouteResult> {
	const command = explicitCommand(message);
	if (command) return command;
	const signals = extractIntentSignals(message, options.timezone);
	let proposal = deterministicProposal(signals);
	if (options.semanticClassifier && (signals.ambiguousConsequential || proposal.confidence < 0.7)) {
		try {
			proposal = SemanticIntentProposalSchema.parse(await options.semanticClassifier({ message, signals }));
		} catch {
			proposal = deterministicProposal(signals);
		}
	}
	return IntentRouteResultSchema.parse({ kind: "INTENT", decision: applyDeterministicPolicy(proposal, signals, options.availableCapabilities) });
}

export function requiresClarification(decision: IntentDecision): boolean {
	return decision.fallbackReason?.startsWith("CLARIFICATION_REQUIRED:") ?? false;
}
