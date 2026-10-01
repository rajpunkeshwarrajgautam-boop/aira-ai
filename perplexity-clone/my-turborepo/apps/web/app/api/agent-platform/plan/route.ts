import { auth } from "@/auth";
import { MissionInput } from "@/lib/contracts/mission";
import { globalCapabilityPlanner } from "@/lib/agents/capability-planner";
import { assertSafetyAllowed, SafetyBlockedError, SafetyGatewayError } from "@/src/services/safety/safety-gateway";
import { resolvePlanBudgetCeilings } from "@/lib/agent-platform/budgets";
import { getEffectiveEntitlements } from "@/lib/billing/plan-enforcement";
import { buildAgentTeamDag } from "@/lib/agent-platform/orchestrator";
import { compileAgentTeam, getAgentTeam, teamBudgets } from "@/lib/agent-platform/teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

// In-process sliding window for plan abuse defense (max 30 plan requests / min per user)
const planTimestampsByUser = new Map<string, number[]>();

function checkPlanRateLimit(userId: string): boolean {
	const now = Date.now();
	const windowMs = 60_000;
	const limit = 30;
	const history = planTimestampsByUser.get(userId) ?? [];
	const valid = history.filter((t) => now - t < windowMs);
	if (valid.length >= limit) {
		return false;
	}
	valid.push(now);
	planTimestampsByUser.set(userId, valid);
	return true;
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	if (!checkPlanRateLimit(session.user.id)) {
		return json(
			{ error: { code: "WORK_RATE_LIMITED", message: "Plan rate limit exceeded. Please wait a minute before requesting another plan." } },
			{ status: 429, headers: { "Retry-After": "60" } },
		);
	}

	const body = await req.json().catch(() => null);
	const candidate = body && typeof body === "object" && !Array.isArray(body)
		? { ...body, userId: session.user.id }
		: { userId: session.user.id };
	const parsed = MissionInput.safeParse(candidate);
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Invalid mission specification.", details: parsed.error.format() } }, { status: 400 });
	}

	try {
		await assertSafetyAllowed("agent-objective", parsed.data.objective);
	} catch (error) {
		if (error instanceof SafetyBlockedError) {
			return json(
				{ error: { code: "SAFETY_BLOCKED", message: "This objective cannot be planned under the configured safety policy." } },
				{ status: 403 },
			);
		}
		if (error instanceof SafetyGatewayError) {
			return json(
				{ error: { code: "SAFETY_GATEWAY_ERROR", message: error.message } },
				{ status: 502 },
			);
		}
		throw error;
	}

	const plan = globalCapabilityPlanner.plan(parsed.data);
	const requestedTeamId = typeof parsed.data.context?.teamId === "string" ? parsed.data.context.teamId.trim() : "";
	const savedTeam = requestedTeamId ? await getAgentTeam(session.user.id, requestedTeamId) : null;
	if (requestedTeamId && (!savedTeam || savedTeam.status !== "ACTIVE")) {
		return json({ error: { code: "AGENT_TEAM_NOT_FOUND", message: "The selected reusable Agent Team does not exist or is archived." } }, { status: 404 });
	}
	const teamMode = parsed.data.context?.orchestration === "TEAM" || Boolean(savedTeam);
	const compiledTeam = savedTeam ? await compileAgentTeam(session.user.id, savedTeam, parsed.data.objective) : null;
	const teamExecutionPlan = teamMode
		? (compiledTeam ?? buildAgentTeamDag(parsed.data.objective)).map((task) => {
			const config = task.config ?? {};
			return {
				key: task.key,
				title: task.title,
				objective: task.objective,
				agentRole: task.agentRole,
				modelTier: task.modelTier,
				priority: task.priority,
				dependencies: task.dependencies,
				approval: task.approval ?? null,
				agentDefinitionId: typeof config.agentDefinitionId === "string" ? config.agentDefinitionId : undefined,
				agentName: typeof config.agentName === "string" ? config.agentName : undefined,
				tools: Array.isArray(config.allowedTools) ? config.allowedTools.filter((value): value is string => typeof value === "string") : [],
				skills: Array.isArray(config.skillIds) ? config.skillIds.filter((value): value is string => typeof value === "string") : [],
			};
		})
		: undefined;
	const entitlements = await getEffectiveEntitlements(session.user.id).catch(() => null);
	const ceilings = entitlements ? resolvePlanBudgetCeilings(entitlements.billingPlan) : undefined;

	return json({
		plan: teamMode ? {
			...plan,
			executionMode: "TEAM",
			teamId: savedTeam?.id,
			teamName: savedTeam?.name,
			teamVersion: savedTeam?.version,
			teamBudgets: savedTeam ? teamBudgets(savedTeam) : undefined,
			teamTasks: teamExecutionPlan,
		} : plan,
		budgetCeilings: ceilings,
		entitlements: entitlements ? { plan: entitlements.billingPlan } : undefined,
	});
}

