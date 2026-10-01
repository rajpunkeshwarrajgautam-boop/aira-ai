import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AgentTeamDefinitionSchema } from "../lib/agent-platform/teams";
import { globalCommandRegistry } from "../lib/agents/commands/command-registry";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const WEB_ROOT = path.resolve(HERE, "..");

function web(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}
function repo(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

test("reusable Agent Team definition schema accepts a bounded verified DAG", () => {
  const parsed = AgentTeamDefinitionSchema.safeParse({
    name: "Research Team",
    description: "Reusable evidence team",
    members: [
      {
        key: "research",
        title: "Research",
        role: "RESEARCH",
        objectiveTemplate: "Research {{objective}}",
        modelTier: "long-context",
        tools: ["web", "files"],
        skills: ["research"],
        dependencies: [],
        priority: 90,
      },
      {
        key: "verification",
        title: "Verification",
        role: "VERIFICATION",
        objectiveTemplate: "Verify {{objective}}",
        modelTier: "reasoning",
        tools: ["files", "web"],
        skills: [],
        dependencies: ["research"],
        priority: 50,
      },
    ],
    budgets: {
      maxAgents: 4,
      maxParallelAgents: 2,
      maxToolCalls: 100,
      maxTokens: 200000,
      maxCostUsd: 10,
      maxDurationMinutes: 60,
      maxRetries: 1,
    },
    coordinatorPolicy: {
      handoffMode: "DIRECT_DEPENDENCIES",
      requireIndependentVerification: true,
      maxHandoffsPerTask: 8,
    },
  });
  assert.equal(parsed.success, true);
});

test("migration creates durable versioned teams, RLS lockdown and additive task config", () => {
  const migration = repo("prisma/migrations/20260929_reusable_agent_teams/migration.sql");
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "AgentTeam"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "AgentTeamVersion"'));
  assert.ok(migration.includes('ALTER TABLE "AgentTask"'));
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "config" JSONB'));
  assert.ok(migration.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(migration.includes('deny_direct_data_api_access'));
  assert.ok(migration.includes('revoke all privileges on table "AgentTeam", "AgentTeamVersion"'));
});

test("team store scopes reads and writes by user and records versions", () => {
  const source = web("lib/agent-platform/teams.ts");
  assert.ok(source.includes('where "id"=${teamId} and "userId"=${userId}'));
  assert.ok(source.includes('where "userId"=${userId}'));
  assert.ok(source.includes('insert into "AgentTeamVersion"'));
  assert.ok(source.includes('"version"=${current.version}'));
  assert.ok(source.includes("Team changed concurrently. Refresh and try again."));
  assert.ok(source.includes("agent.userId !== userId"));
});

test("team validation binds real tools and accessible skills", () => {
  const source = web("lib/agent-platform/teams.ts");
  assert.ok(source.includes("registeredToolIds()"));
  assert.ok(source.includes("globalSkillsStore.getSkillForUserAsync(userId, skillId)"));
  assert.ok(source.includes("skill.requiredTools.filter"));
  assert.ok(source.includes("references unknown Tool Gateway id"));
  assert.ok(source.includes("requires unauthorized tool"));
});

test("compiled team tasks snapshot member agent, tools, skills and version", () => {
  const source = web("lib/agent-platform/teams.ts");
  assert.ok(source.includes("teamVersion: team.version"));
  assert.ok(source.includes("agentDefinitionId: agent.id"));
  assert.ok(source.includes("instructions: agent.instructions"));
  assert.ok(source.includes("modelPolicy: { ...agent.modelPolicy }"));
  assert.ok(source.includes("allowedTools"));
  assert.ok(source.includes("skillIds"));
});

test("AgentTask persistence stores immutable launch config and retries hydrate it", () => {
  const store = web("lib/agent-platform/store.ts");
  const orchestrator = web("lib/agent-platform/orchestrator.ts");
  assert.ok(store.includes('"config", "dependencies"'));
  assert.ok(store.includes('${config}::jsonb'));
  assert.ok(store.includes("config: jsonObject(row.config)"));
  assert.ok(orchestrator.includes("const taskConfig = task.config ?? {}"));
  assert.ok(orchestrator.includes('taskConfigString(taskConfig, "teamId")'));
});

test("saved team budgets cap rather than expand the request budget", () => {
  const orchestrator = web("lib/agent-platform/orchestrator.ts");
  assert.ok(orchestrator.includes("function capBudgets"));
  for (const key of ["maxAgents", "maxParallelAgents", "maxToolCalls", "maxTokens", "maxCostUsd", "maxDurationMinutes", "maxRetries"]) {
    assert.ok(orchestrator.includes(`${key}: Math.min(requested.${key}, team.${key})`));
  }
  assert.ok(orchestrator.includes("savedTeam ? capBudgets(requestedBudgets, teamBudgets(savedTeam))"));
});

test("runtime applies saved custom agent instructions and configured skills", () => {
  const context = web("lib/aira-runtime/context.ts");
  const orchestrator = web("lib/agent-platform/orchestrator.ts");

  assert.ok(context.includes("# SAVED AGENT DEFINITION"));
  assert.ok(context.includes("# TEAM-CONFIGURED SKILLS"));
  assert.ok(context.includes("globalSkillsStore.getSkillForUserAsync"));
  assert.ok(orchestrator.includes("configuredSkillIds"));
  assert.ok(orchestrator.includes("agentInstructions"));
  assert.ok(orchestrator.includes("agentDefinitionId"));
  assert.ok(orchestrator.includes("name: agentName ?? task.title"));
});

test("saved team planning and launch use the same owner-scoped team id", () => {
  const plan = web("app/api/agent-platform/plan/route.ts");
  const run = web("app/api/agent-platform/projects/[projectId]/runs/route.ts");
  const work = web("components/work/WorkExecutionWorkspace.tsx");

  assert.ok(plan.includes("getAgentTeam(session.user.id, requestedTeamId)"));
  assert.ok(plan.includes("compileAgentTeam(session.user.id, savedTeam"));
  assert.ok(run.includes('teamId: z.string().uuid().optional()'));
  assert.ok(run.includes("teamId: parsed.data.teamId"));
  assert.ok(work.includes("...(teamId ? { teamId } : {})"));
  assert.ok(work.includes("Saved team:"));
});

test("reusable team APIs are authenticated and mutation paths are owner scoped", () => {
  for (const relative of [
    "app/api/agent-platform/teams/route.ts",
    "app/api/agent-platform/teams/[id]/route.ts",
    "app/api/agent-platform/teams/[id]/versions/route.ts",
  ]) {
    const source = web(relative);
    assert.ok(source.includes("await auth()"));
    assert.ok(source.includes("session.user.id"));
  }
});

test("/teams is a real navigation command while /team remains explicit mission preparation", async () => {
  const teams = await globalCommandRegistry.parseAndExecute("/teams");
  const team = await globalCommandRegistry.parseAndExecute("/team investigate reusable agent systems");

  assert.equal(teams?.type, "redirect");
  assert.equal(teams?.payload, "/teams");
  assert.equal(team?.type, "redirect");
  assert.match(String(team?.payload), /intent=team/);

  const frame = web("components/AiraV2Frame.tsx");
  const composer = web("components/SearchBox.tsx");
  assert.ok(frame.includes('href: "/teams"'));
  assert.ok(composer.includes('command: "/teams"'));
});

test("Teams workspace persists through APIs and only prepares Work launch", () => {
  const workspace = web("components/teams/TeamsWorkspace.tsx");
  assert.ok(workspace.includes('fetch("/api/agent-platform/teams"'));
  assert.ok(workspace.includes('method: selected ? "PUT" : "POST"'));
  assert.ok(workspace.includes('method: "DELETE"'));
  assert.ok(workspace.includes("/versions"));
  assert.ok(workspace.includes("/work?intent=team&teamId="));
  assert.ok(workspace.includes("A saved team never executes from this screen."));
  assert.ok(!workspace.includes("/runs"));
  assert.ok(!workspace.includes("executePlan("));
});
