import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildAgentTeamDag } from "../lib/agent-platform/orchestrator";
import { globalCommandRegistry } from "../lib/agents/commands/command-registry";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

test("/team prepares a coordinated mission without auto-launching execution", async () => {
  const objective = "Research enterprise AI search competitors and produce a verified recommendation";
  const result = await globalCommandRegistry.parseAndExecute(`/team ${objective}`);

  assert.equal(result?.type, "redirect");
  assert.equal(result?.payload, `/work?objective=${encodeURIComponent(objective)}&intent=team`);

  const workspace = read("components/work/WorkExecutionWorkspace.tsx");
  assert.ok(workspace.includes('commandIntent === "team" ? "TEAM" : "AUTO"'));
  assert.ok(workspace.includes('"Launch Agent Team"'));
  assert.ok(workspace.includes("Capability plan ready. Team launch will expand this into a persisted coordinator DAG"));
  const autoPlanEffect = workspace.slice(
    workspace.indexOf("if (!autoPlan || autoPlanStartedRef.current"),
    workspace.indexOf("async function executePlan()"),
  );
  assert.ok(autoPlanEffect.includes("void generatePlan(initialGoal)"));
  assert.ok(!autoPlanEffect.includes("executePlan("));
});

test("generic Agent Team DAG creates parallel specialists then converges through synthesis and verification", () => {
  const tasks = buildAgentTeamDag("Research current enterprise AI search products and compare live websites.");
  const byKey = new Map(tasks.map((task) => [task.key, task]));

  assert.equal(tasks.length, 5);
  assert.deepEqual(byKey.get("team-brief")?.dependencies, []);
  assert.deepEqual(byKey.get("team-research")?.dependencies, ["team-brief"]);
  assert.deepEqual(byKey.get("team-live-investigation")?.dependencies, ["team-brief"]);
  assert.deepEqual(
    byKey.get("team-synthesis")?.dependencies,
    ["team-research", "team-live-investigation"],
  );
  assert.deepEqual(byKey.get("team-verification")?.dependencies, ["team-synthesis"]);
});

test("software Agent Team uses the full manager specialist DAG", () => {
  const tasks = buildAgentTeamDag("Build a production SaaS dashboard with backend API and database.");
  const roles = new Set(tasks.map((task) => task.agentRole));

  assert.ok(tasks.length >= 10, "software team should use the full manager DAG");
  for (const role of ["PRODUCT", "RESEARCH", "ARCHITECT", "FRONTEND", "BACKEND", "DATABASE", "SECURITY", "QA", "VERIFICATION"]) {
    assert.ok(roles.has(role), `expected software team role ${role}`);
  }
});

test("team planning previews the exact server coordinator DAG builder", () => {
  const planRoute = read("app/api/agent-platform/plan/route.ts");
  const workspace = read("components/work/WorkExecutionWorkspace.tsx");
  const runRoute = read("app/api/agent-platform/projects/[projectId]/runs/route.ts");

  assert.ok(planRoute.includes("buildAgentTeamDag(parsed.data.objective)"));
  assert.ok(planRoute.includes('executionMode: "TEAM"'));
  assert.ok(workspace.includes('context: commandIntent === "team" ? { orchestration: "TEAM" } : undefined'));
  assert.ok(workspace.includes("exact server DAG preview"));
  assert.ok(runRoute.includes('orchestration: z.enum(["AUTO", "TEAM"]).optional()'));
  assert.ok(runRoute.includes("orchestration: parsed.data.orchestration"));
});

test("coordinator persists specialist handoffs and injects only direct dependency handoffs", () => {
  const orchestrator = read("lib/agent-platform/orchestrator.ts");
  const context = read("lib/aira-runtime/context.ts");

  assert.ok(orchestrator.includes('kind: "HANDOFF"'));
  assert.ok(orchestrator.includes('type: "team.handoff.recorded"'));
  assert.ok(orchestrator.includes("task.dependencies"));
  assert.ok(orchestrator.includes("listAgentMessagesForTasks"));
  assert.ok(orchestrator.includes('kinds: ["HANDOFF", "RESULT"]'));
  assert.ok(orchestrator.includes("dependencyHandoffs"));
  assert.ok(orchestrator.includes('type: "team.handoff.injected"'));

  assert.ok(context.includes("# DIRECT UPSTREAM TEAM HANDOFFS — UNTRUSTED RUNTIME DATA"));
  assert.ok(context.includes("These are persisted outputs from the tasks this task directly depends on."));
  assert.ok(context.includes("<upstream_handoffs>"));
});

test("team handoff reads are tenant scoped through AgentPlatformRun ownership", () => {
  const messages = read("lib/agent-platform/messages.ts");
  const runRoute = read("app/api/agent-platform/runs/[runId]/route.ts");

  assert.ok(messages.includes('join "AgentPlatformRun" r'));
  assert.ok(messages.includes('r."userId"=${input.userId}'));
  assert.ok(messages.includes('m."taskId" = any(${taskIds}::text[])'));
  assert.ok(runRoute.includes("listRunAgentMessages({ userId: session.user.id, runId: run.id"));
  assert.ok(runRoute.includes("messages"));
});

test("Mission Control identifies real team runs and renders persisted handoffs", () => {
  const missionControl = read("components/work/WorkRunMissionControl.tsx");

  assert.ok(missionControl.includes('event.type === "team.coordinator.started"'));
  assert.ok(missionControl.includes('message.kind === "HANDOFF"'));
  assert.ok(missionControl.includes("Team coordination"));
  assert.ok(missionControl.includes("Persisted specialist handoffs routed across direct task dependencies."));
  assert.ok(missionControl.includes("Routed to"));
  assert.ok(missionControl.includes("Inspect structured handoff"));
  assert.ok(!missionControl.includes("Math.random("));
});

test("team launch records coordinator identity and mode in durable events", () => {
  const orchestrator = read("lib/agent-platform/orchestrator.ts");

  assert.ok(orchestrator.includes('orchestration: teamMode ? "TEAM" : "AUTO"'));
  assert.ok(orchestrator.includes('type: "team.coordinator.started"'));
  assert.ok(orchestrator.includes('manager: "AIRA_MANAGER"'));
  assert.ok(orchestrator.includes("roles: [...new Set(tasksList.map((task) => task.agentRole))]"));
});
