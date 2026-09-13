import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BillingPlan } from "../generated/prisma/enums";
import { resolvePlanBudgetCeilings } from "../lib/agent-platform/budgets";
import {
	buildWorkDag,
	buildManagerDag,
	wantsSoftwareBuild,
} from "../lib/agent-platform/orchestrator";
import { MissionInput } from "../lib/contracts/mission";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

test("Gate 3: Work Execution Workspace removes Builder coupling", () => {
	const workspaceSource = readWeb("components/work/WorkExecutionWorkspace.tsx");
	// Must NOT link to /build for mission control
	assert.ok(!workspaceSource.includes('href={`/build?'), "Work UI must not couple to /build route");
	// Must link to native Work run mission control
	assert.ok(workspaceSource.includes('href={`/work/runs/'), "Work UI must link to /work/runs/[runId]");
	// Must use dedicated runtime status endpoint
	assert.ok(workspaceSource.includes('fetch("/api/agent-platform/runtime/status"'), "Work UI must probe dedicated runtime status");
	assert.ok(!workspaceSource.includes('fetch("/api/agents/runs?limit=1"'), "Work UI must not probe legacy /api/agents/runs endpoint");
});

test("Gate 4: Dedicated Work runtime status route contract", () => {
	const statusRouteSource = readWeb("app/api/agent-platform/runtime/status/route.ts");
	assert.ok(statusRouteSource.includes("AIRA_WORK_RUNTIME_ENABLED"), "Status probe must check work runtime killswitch");
	assert.ok(statusRouteSource.includes("getAgentRuntimeStates"), "Status probe must query registered agent runtimes");
	assert.ok(statusRouteSource.includes("degradedCapabilities"), "Status probe must report capability degradation");
	assert.ok(statusRouteSource.includes("ready"), "Status probe must report ready flag");
});

test("Gate 5 & 50: Cross-user isolation and tenant boundaries (IDOR defense)", () => {
	const runDetailRoute = readWeb("app/api/agent-platform/runs/[runId]/route.ts");
	assert.ok(runDetailRoute.includes("session?.user?.id"), "Run detail must require authenticated session");
	assert.ok(runDetailRoute.includes("getRunForUser(session.user.id, runId)"), "Run detail must verify user ownership");
	assert.ok(runDetailRoute.includes('status: 404'), "Cross-user or missing run must return 404");

	const cancelRoute = readWeb("app/api/agent-platform/runs/[runId]/cancel/route.ts");
	assert.ok(cancelRoute.includes("getRunForUser(session.user.id, runId)"), "Cancel route must verify user ownership");
	assert.ok(cancelRoute.includes('status: 404'), "Unauthorized cancel attempt must return 404");

	const approvalRoute = readWeb("app/api/agent-platform/approvals/[approvalId]/route.ts");
	assert.ok(approvalRoute.includes("userId: session.user.id"), "Approval resolution must be tenant-scoped");
});

test("Gate 6: Server-authoritative Mission Input bounds", () => {
	// Reject empty or tiny objective
	const tiny = MissionInput.safeParse({ id: "m-1", userId: "u-1", objective: "hi" });
	assert.equal(tiny.success, false, "Objective < 3 chars must fail validation");

	// Valid Work objective
	const valid = MissionInput.safeParse({
		id: "m-2",
		userId: "u-1",
		objective: "Research official Next.js 15 documentation and produce a summary of Route Handlers with citations.",
	});
	assert.equal(valid.success, true);

	// Max bounds enforced
	const huge = MissionInput.safeParse({ id: "m-3", userId: "u-1", objective: "a".repeat(10_000) });
	assert.equal(huge.success, false, "Objective > 8000 chars must fail validation");
});

test("Gate 7: Server-side budget clamping and escalation defense", () => {
	const freeCeilings = resolvePlanBudgetCeilings(BillingPlan.FREE);
	assert.equal(freeCeilings.maxAgents, 6);
	assert.equal(freeCeilings.maxParallelAgents, 2);
	assert.equal(freeCeilings.maxCostUsd, 5);
	assert.equal(freeCeilings.maxTokens, 250_000);
	assert.equal(freeCeilings.maxActiveRuns, 3);

	const proCeilings = resolvePlanBudgetCeilings(BillingPlan.PRO);
	assert.equal(proCeilings.maxAgents, 12);
	assert.equal(proCeilings.maxParallelAgents, 4);
	assert.equal(proCeilings.maxCostUsd, 25);
	assert.equal(proCeilings.maxActiveRuns, 5);

	const teamCeilings = resolvePlanBudgetCeilings(BillingPlan.TEAM);
	assert.equal(teamCeilings.maxAgents, 24);
	assert.equal(teamCeilings.maxCostUsd, 100);
	assert.equal(teamCeilings.maxActiveRuns, 10);
});

test("Gate 9: Idempotency enforcement in run creation", () => {
	const runsRouteSource = readWeb("app/api/agent-platform/projects/[projectId]/runs/route.ts");
	assert.ok(runsRouteSource.includes("clientRequestId: parsed.data.clientRequestId"), "Run creation must bind clientRequestId");
	assert.ok(runsRouteSource.includes("resolveEffectiveWorkBudgets"), "Run creation must clamp client budgets to server ceilings");
	assert.ok(runsRouteSource.includes("assertSafetyAllowed"), "Run creation must execute safety gateway checks");
});

test("Gate 13: Work Task Graph vs Software Builder DAG", () => {
	const workDag = buildWorkDag("Research machine learning deployment strategies");
	assert.equal(workDag.length, 4);
	assert.equal(workDag[0]!.key, "scoping");
	assert.equal(workDag[1]!.key, "investigation");
	assert.equal(workDag[1]!.agentRole, "RESEARCH");
	assert.equal(workDag[2]!.key, "synthesis");
	assert.equal(workDag[2]!.agentRole, "ARCHITECT");
	assert.equal(workDag[3]!.key, "verification");
	assert.equal(workDag[3]!.agentRole, "VERIFICATION");

	// None of the work roles require git worktree
	const workRoles = new Set(workDag.map((t) => t.agentRole));
	assert.ok(!workRoles.has("FRONTEND"));
	assert.ok(!workRoles.has("BACKEND"));
	assert.ok(!workRoles.has("DATABASE"));
	assert.ok(!workRoles.has("INTEGRATOR"));

	// Browser objective
	const browserDag = buildWorkDag("Open https://example.com and screenshot the homepage");
	assert.equal(browserDag[1]!.agentRole, "BROWSER");

	// Builder DAG has 12-13 tasks
	const builderDag = buildManagerDag("Build a production-ready CRM application");
	assert.equal(builderDag.length, 12);
	assert.equal(wantsSoftwareBuild("Build a production-ready CRM application"), true);
	assert.equal(wantsSoftwareBuild("Research machine learning deployment strategies"), false);
});

test("Gate 27 & 28: Acceptance criteria and persisted deliverables", () => {
	const orchestratorSource = readWeb("lib/agent-platform/orchestrator.ts");
	assert.ok(orchestratorSource.includes("listRunArtifacts(userId, run.id)"), "Orchestrator must retrieve persisted run artifacts");
	assert.ok(orchestratorSource.includes("acceptanceVerified"), "run.completed event must contain acceptance verification payload");
	assert.ok(orchestratorSource.includes("artifactCount"), "run.completed event must report persisted deliverable count");

	const storeSource = readWeb("lib/agent-platform/store.ts");
	assert.ok(storeSource.includes("export async function listRunArtifacts"), "Store must export listRunArtifacts query");
	assert.ok(storeSource.includes('from "AgentArtifact" a'), "listRunArtifacts must query AgentArtifact table");
	assert.ok(storeSource.includes('r."userId" = ${userId}'), "Artifact listing must be user-isolated");
});

test("Gate 31: Native Work Mission Control UI Page and Component exist", () => {
	const pageSource = readWeb("app/work/runs/[runId]/page.tsx");
	assert.ok(pageSource.includes("WorkRunMissionControl"), "Page must render WorkRunMissionControl");

	const componentSource = readWeb("components/work/WorkRunMissionControl.tsx");
	assert.ok(componentSource.includes("Managed Task Graph"), "Component must display managed task graph");
	assert.ok(componentSource.includes("Persisted Deliverables"), "Component must display deliverables");
	assert.ok(componentSource.includes("Execution Evidence Stream"), "Component must display live evidence stream");
	assert.ok(componentSource.includes("handleCancel"), "Component must support cancellation");
	assert.ok(componentSource.includes("handleApproval"), "Component must support interactive approvals");
});

test("Gate 40 & 41: Production runtime killswitch defense", () => {
	const runsRouteSource = readWeb("app/api/agent-platform/projects/[projectId]/runs/route.ts");
	assert.ok(runsRouteSource.includes("AIRA_WORK_RUNTIME_ENABLED"), "Killswitch check must be present");
	assert.ok(runsRouteSource.includes("WORK_RUNTIME_UNAVAILABLE"), "Killswitch must return WORK_RUNTIME_UNAVAILABLE status");
	assert.ok(runsRouteSource.includes("status: 503"), "Disabled runtime must return HTTP 503");
});
