import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..");

test("P0-MEM-01: route-core suppresses contextualMemory on standalone greetings", () => {
	const routeSource = readFileSync(path.join(WEB_ROOT, "app/api/search/route-core.ts"), "utf8");
	assert.ok(
		routeSource.includes("contextualMemory: context.chatHistory.length > 0 ? context.contextualMemory : []"),
		"route-core must not inject background contextualMemory on standalone greetings with empty chat history",
	);
});

test("P0-MEM-02: persistent-memory-core suppresses recall when queryTokens is empty and !showAll", () => {
	const coreSource = readFileSync(path.join(WEB_ROOT, "lib/persistent-memory-core.ts"), "utf8");
	assert.ok(
		coreSource.includes("if (queryTokens.length === 0 && !showAll) return [];"),
		"persistent-memory-core must return empty when query has zero meaningful tokens unless explicitly requested with showAll",
	);
});

test("P0-WORK-01: managed run route checks AIRA_WORK_RUNTIME_ENABLED before project lookup in POST handler", () => {
	const runsRouteSource = readFileSync(
		path.join(WEB_ROOT, "app/api/agent-platform/projects/[projectId]/runs/route.ts"),
		"utf8",
	);
	const postIndex = runsRouteSource.indexOf("export async function POST");
	assert.ok(postIndex !== -1, "POST handler must exist");
	const postSource = runsRouteSource.slice(postIndex);

	const killswitchIndex = postSource.indexOf("process.env.AIRA_WORK_RUNTIME_ENABLED !== \"true\"");
	const projectLookupIndex = postSource.indexOf("getProjectForUser(session.user.id, projectId)");

	assert.ok(killswitchIndex !== -1, "Killswitch check must be present in POST handler");
	assert.ok(projectLookupIndex !== -1, "Project lookup must be present in POST handler");
	assert.ok(
		killswitchIndex < projectLookupIndex,
		"AIRA_WORK_RUNTIME_ENABLED check must execute BEFORE getProjectForUser to fail closed uniformly with 503",
	);
});
