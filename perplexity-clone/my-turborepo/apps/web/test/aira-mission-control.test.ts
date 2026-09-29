import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

test("Mission Control route returns real agents, tool calls, approvals, usage and artifacts", () => {
  const route = read("app/api/agent-platform/runs/[runId]/route.ts");

  assert.ok(route.includes("getRunForUser(session.user.id, runId)"));
  assert.ok(route.includes("listAgentInstancesForRun(session.user.id, run.id)"));
  assert.ok(route.includes("listMissionToolCalls(session.user.id, run.id, 150)"));
  assert.ok(route.includes("listRunApprovals(session.user.id, run.id)"));
  assert.ok(route.includes("listRunArtifacts(session.user.id, run.id)"));
  assert.ok(route.includes("readMissionUsage(run.id)"));
  assert.ok(route.includes("agents, toolCalls, usage"));
});

test("Agent roster and tool-call ledger are tenant scoped in SQL", () => {
  const platformStore = read("lib/agent-platform/store.ts");
  const toolStore = read("lib/tool-gateway/store.ts");

  assert.ok(platformStore.includes('where a."runId"=${runId} and r."userId"=${userId}'));
  assert.ok(platformStore.includes('where "userId"=${userId} and "runId"=${runId}'));
  assert.ok(toolStore.includes('where c."runId"=${runId} and c."userId"=${userId} and r."userId"=${userId}'));
});

test("Mission Control renders persisted execution evidence instead of fake progress", () => {
  const component = read("components/work/WorkRunMissionControl.tsx");

  for (const source of [
    "data.tasks.filter",
    "data.agents.filter",
    "data.toolCalls.filter",
    "usage?.toolCallsUsed",
    "usage?.inputTokensUsed",
    "usage?.knownCostUsd",
    "toolCalls.map",
    "agents.map",
    "approvals.map",
    "events].reverse().map",
    "artifacts.map",
  ]) {
    assert.ok(component.includes(source), `expected Mission Control to use ${source}`);
  }

  assert.ok(component.includes("Shown truthfully from persisted usage accounting"));
  assert.ok(component.includes("Actual Tool Gateway operations"));
  assert.ok(component.includes("Actual managed agent instances"));
  assert.ok(!component.includes("Math.random("));
  assert.ok(!component.includes("setTimeout("));
  assert.ok(!component.includes("fake"));
  assert.ok(!component.includes("mock"));
});

test("Mission Control keeps risky actions behind explicit user interaction", () => {
  const component = read("components/work/WorkRunMissionControl.tsx");

  assert.ok(component.includes('onClick={() => void handleApproval(approval.id, "approve")}'));
  assert.ok(component.includes('onClick={() => void handleApproval(approval.id, "reject")}'));
  assert.ok(component.includes('window.confirm("Cancel this managed run?'));
  assert.ok(component.includes('method: "POST"'));
});

test("Artifact inspection uses the existing tenant-scoped artifact endpoint", () => {
  const component = read("components/work/WorkRunMissionControl.tsx");
  const artifactRoute = read("app/api/agent-platform/runs/[runId]/artifacts/[artifactId]/route.ts");

  assert.ok(component.includes("/artifacts/"));
  assert.ok(component.includes("inspectArtifact"));
  assert.ok(artifactRoute.includes("getRunArtifact(session.user.id, runId, artifactId)"));
});
