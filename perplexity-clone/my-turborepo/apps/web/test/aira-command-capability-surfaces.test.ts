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

test("AIRA Command navigation commands resolve to real product routes", async () => {
  for (const [command, route] of [["/tasks", "/tasks"], ["/tools", "/tools"], ["/skills", "/skills"]] as const) {
    const result = await globalCommandRegistry.parseAndExecute(command);
    assert.equal(result?.type, "redirect");
    assert.equal(result?.payload, route);
  }
});

test("tool status API reports live registered adapter availability", () => {
  const route = read("app/api/agent-platform/tools/route.ts");
  const gateway = read("lib/tool-gateway/gateway.ts");

  assert.ok(route.includes("await auth()"));
  assert.ok(route.includes("registeredToolIds()"));
  assert.ok(route.includes("await toolAvailability()"));
  assert.ok(route.includes("availability[id] === true"));
  assert.ok(gateway.includes("const all: AiraToolId[] = [...adapters.keys()]"));
  for (const adapter of ["gmailToolAdapter", "slackToolAdapter", "googleDriveToolAdapter"]) {
    assert.ok(gateway.includes(adapter), `expected registered connector adapter ${adapter}`);
  }
});

test("skills APIs require authentication and enforce user ownership", () => {
  const collection = read("app/api/agent-platform/skills/route.ts");
  const detail = read("app/api/agent-platform/skills/[id]/route.ts");
  const store = read("lib/agents/installable-skills-store.ts");

  assert.ok(collection.includes('code: "UNAUTHENTICATED"'));
  assert.ok(collection.includes("listSkillsAsync(session.user.id)"));
  assert.ok(detail.includes("getSkillForUserAsync(session.user.id, id)"));
  assert.ok(detail.includes("toggleSkillForUserAsync(session.user.id, id"));
  assert.ok(detail.includes("uninstallSkillForUserAsync(session.user.id, id)"));
  assert.ok(detail.includes('code: "BUILTIN_IMMUTABLE"'));
  assert.ok(store.includes("skill.userId === userId ? skill : null"));
  assert.ok(store.includes("where: { id, userId, isBuiltin: false }"));
});

test("tasks API is scoped by authenticated AgentPlatformRun ownership", () => {
  const route = read("app/api/agent-platform/tasks/route.ts");
  const store = read("lib/agent-platform/store.ts");

  assert.ok(route.includes("await auth()"));
  assert.ok(route.includes("listTasksForUser(session.user.id"));
  assert.ok(store.includes('where r."userId" = ${userId}'));
  assert.ok(store.includes('join "AgentProject" p'));
  assert.ok(store.includes('p."userId" = r."userId"'));
});

test("Tools Skills and Tasks pages consume real APIs instead of placeholder arrays", () => {
  const tools = read("components/tools/ToolsWorkspace.tsx");
  const skills = read("components/skills/SkillsWorkspace.tsx");
  const tasks = read("components/tasks/TasksWorkspace.tsx");

  assert.ok(tools.includes('fetch("/api/agent-platform/tools"'));
  assert.ok(skills.includes('fetch("/api/agent-platform/skills"'));
  assert.ok(skills.includes('method: "POST"'));
  assert.ok(skills.includes('method: "PATCH"'));
  assert.ok(skills.includes('method: "DELETE"'));
  assert.ok(tasks.includes('fetch("/api/agent-platform/tasks?limit=150"'));
  assert.ok(tasks.includes("/work/runs/"));
  assert.ok(tasks.includes("No synthetic progress is generated on this screen."));
});

test("workspace shell exposes the AIRA Command capability section", () => {
  const frame = read("components/AiraV2Frame.tsx");
  for (const route of ["/work", "/agents", "/tasks", "/tools", "/skills"]) {
    assert.ok(frame.includes(`href: "${route}"`), `expected ${route} in capability navigation`);
  }
  assert.ok(frame.includes("AIRA Command"));
});
