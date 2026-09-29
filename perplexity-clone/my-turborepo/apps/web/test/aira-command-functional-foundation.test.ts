import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { globalCommandRegistry } from "../lib/agents/commands/command-registry";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

test("/research executes through the real Deep Research command action", async () => {
  const result = await globalCommandRegistry.parseAndExecute("/research compare OpenAI and Anthropic");
  assert.deepEqual(result, {
    type: "action",
    payload: { mode: "deep", query: "compare OpenAI and Anthropic" },
    message: "Starting Deep Research for: compare OpenAI and Anthropic",
  });
});

test("/plan routes an objective into AIRA Work with server-side auto planning", async () => {
  const objective = "Audit the application security posture";
  const result = await globalCommandRegistry.parseAndExecute(`/plan ${objective}`);
  assert.equal(result?.type, "redirect");
  assert.equal(result?.payload, `/work?objective=${encodeURIComponent(objective)}&intent=plan`);
});

test("/agent prepares a managed mission but does not bypass explicit launch approval", async () => {
  const objective = "Research competitors and create a verified report";
  const result = await globalCommandRegistry.parseAndExecute(`/agent ${objective}`);
  assert.equal(result?.type, "redirect");
  assert.equal(result?.payload, `/work?objective=${encodeURIComponent(objective)}&intent=agent`);

  const workspace = read("components/work/WorkExecutionWorkspace.tsx");
  const autoPlanEffectStart = workspace.indexOf("if (!autoPlan || autoPlanStartedRef.current");
  const executePlanStart = workspace.indexOf("async function executePlan()");
  assert.ok(autoPlanEffectStart >= 0, "command intent must auto-start real planning");
  assert.ok(executePlanStart > autoPlanEffectStart, "managed execution must remain a separate explicit step");
  assert.ok(
    !workspace.slice(autoPlanEffectStart, executePlanStart).includes("executePlan("),
    "command auto-planning must never auto-launch autonomous execution",
  );
});

test("Work command objectives are passed from the route into the real planner", () => {
  const page = read("app/work/page.tsx");
  const workspace = read("components/work/WorkExecutionWorkspace.tsx");

  assert.ok(page.includes("initialObjective={initialObjective}"));
  assert.ok(page.includes("autoPlan={autoPlan}"));
  assert.ok(page.includes("commandIntent={commandIntent}"));
  assert.ok(workspace.includes('fetch("/api/agent-platform/plan"'));
  assert.ok(workspace.includes("void generatePlan(initialGoal)"));
  assert.ok(workspace.includes("Plan ready. Review tasks, risk and estimated cost before launching the managed run."));
});

test("composer exposes the new functional command entry points", () => {
  const composer = read("components/SearchBox.tsx");
  for (const command of ["/research ", "/plan ", "/agent ", "/work "]) {
    assert.ok(composer.includes(command), `expected ${command} in composer command menu`);
  }
});
