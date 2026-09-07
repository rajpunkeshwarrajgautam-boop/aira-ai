import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relative: string): string { return readFileSync(new URL(relative, import.meta.url), "utf8"); }

test("sidebar Work dispatches managed runs instead of client simulation", () => {
  const page = source("../app/work/page.tsx"); const workspace = source("../components/work/WorkExecutionWorkspace.tsx");
  assert.match(page, /WorkExecutionWorkspace/); assert.match(workspace, /\/api\/agent-platform\/projects/); assert.match(workspace, /\/runs/);
  assert.doesNotMatch(workspace, /setTimeout\(/); assert.doesNotMatch(workspace, /Certified cryptographically|fake validation/i);
});

test("Browser Agent reuses canonical BrowserWorkspace", () => {
  const page = source("../app/browser-agent/page.tsx"); assert.match(page, /BrowserWorkspace/); assert.doesNotMatch(page, /Not exposed|Coming soon|unsupported/i);
});

test("Projects and Swarms use persistent managed-run contracts", () => {
  const projects = source("../components/projects/ProjectsWorkspace.tsx"); const swarm = source("../components/swarms/SwarmWorkspace.tsx");
  assert.match(projects, /\/api\/agent-platform\/projects/); assert.match(projects, /method: "PATCH"/); assert.match(projects, /method: "DELETE"/);
  assert.match(swarm, /provider: "AGENT_SWARM"/); assert.doesNotMatch(swarm, /Optimal Path A|Contrarian Path B|confidence: 0\.9/i);
});

test("Workflows route points to durable automation workspace", () => {
  const frame = source("../components/AiraV2Frame.tsx"); const page = source("../app/workflows/page.tsx"); const workspace = source("../components/workflows/WorkflowWorkspace.tsx");
  assert.match(frame, /href: "\/workflows", label: "Workflows"/); assert.match(page, /WorkflowWorkspace/); assert.match(workspace, /\/api\/automation\/routines/); assert.match(workspace, /\/run/);
});

test("Agents expose durable definition lifecycle separately from run center", () => {
  const page = source("../app/agents/page.tsx"); const manager = source("../components/agents/UserAgentManager.tsx");
  assert.match(page, /UserAgentManager/); assert.match(page, /AgentDashboard/); assert.match(manager, /\/api\/agent-platform\/user-agents/); assert.match(manager, /Save new version/);
});

test("Artifacts have truthful empty state and canonical byte downloads", () => {
  const page = source("../app/artifacts/page.tsx"); const workspace = source("../components/artifacts/VerifiedArtifactWorkspace.tsx");
  assert.match(page, /VerifiedArtifactWorkspace/); assert.match(workspace, /\/api\/artifacts\/\$\{encodeURIComponent\(selected\.id\)\}\/download/);
  assert.doesNotMatch(workspace, /sha_sample|sha256_mock|art_sample_|sampleArtifacts/i);
});

test("Global Search covers projects artifacts and knowledge", () => {
  const route = source("../app/api/global-search/route.ts"); const page = source("../app/workspace-search/page.tsx");
  for (const kind of ["project", "artifact", "knowledge"]) { assert.match(route, new RegExp(`type: \\\"${kind}\\\"`)); assert.match(page, new RegExp(`\\\"${kind}\\\"`)); }
});

test("Federated knowledge contains no invented provider documents", () => {
  const service = source("../lib/federated-knowledge.ts"); assert.doesNotMatch(service, /Enterprise Architecture Guide\.pdf|Q3 Strategy Planning Deck\.gdoc|User architectural preference/); assert.match(service, /live connector authorization is required/);
});

test("connector registry never derives HEALTHY from env presence", () => {
  const registry = source("../lib/connectors/registry.ts");
  assert.doesNotMatch(registry, /process\.env\.[A-Z0-9_]+\?\.trim\(\)\s*\?\s*"HEALTHY"/); assert.match(registry, /refreshHealth/); assert.match(registry, /adapter\.health/);
});

test("Governance uses real organization API and share action is owner and org-role scoped", () => {
  const page = source("../app/governance/page.tsx"); const route = source("../app/api/enterprise/organizations/route.ts");
  assert.match(page, /\/api\/enterprise\/organizations/); assert.match(route, /canPerformActionAsync\(workspace\.orgId, session\.user\.id, "ADMIN"\)/); assert.match(route, /agent\.userId !== session\.user\.id/); assert.match(route, /updateAgentAsync/);
});
