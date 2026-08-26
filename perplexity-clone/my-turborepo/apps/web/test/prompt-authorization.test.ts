import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	assertVersionMutationAllowed,
	authorizePromptAction,
	canExecutePromptVersion,
	canTestPromptVersion,
	type PromptAction,
} from "@services/prompt/prompt-authorization";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_API_ROOT = path.join(WEB_ROOT, "app", "api", "prompts");

function read(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

function walkRoutes(root: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(root, { withFileTypes: true })) {
		const full = path.join(root, name.name);
		if (name.isDirectory()) files.push(...walkRoutes(full));
		else if (name.name === "route.ts") files.push(full);
	}
	return files;
}

const OWNER = "user-a";
const OTHER = "user-b";
const ALL_ACTIONS: readonly PromptAction[] = [
	"view",
	"edit",
	"publish",
	"archive",
	"delete",
	"run",
	"assign",
	"evaluate",
];

test("unauthenticated requests are denied for every action", () => {
	for (const action of ALL_ACTIONS) {
		const decision = authorizePromptAction(
			{ userId: null },
			{ ownerUserId: OWNER, status: "PUBLISHED", visibility: "PRIVATE" },
			action,
		);
		assert.equal(decision.allowed, false);
		assert.equal(decision.allowed === false && decision.status, 401);
		assert.equal(decision.allowed === false && decision.code, "UNAUTHENTICATED");
	}
});

test("a different user is denied every action on a private prompt", () => {
	for (const action of ALL_ACTIONS) {
		const decision = authorizePromptAction(
			{ userId: OTHER },
			{ ownerUserId: OWNER, status: "PUBLISHED", visibility: "PRIVATE" },
			action,
		);
		assert.equal(decision.allowed, false, `${action} must be denied cross-user`);
		assert.equal(
			decision.allowed === false && decision.status,
			404,
			"cross-user access reports 404 so prompt ids cannot be probed",
		);
	}
});

test("workspace visibility grants read only — never write or execute", () => {
	const shared = { ownerUserId: OWNER, status: "PUBLISHED", visibility: "WORKSPACE" } as const;
	assert.equal(authorizePromptAction({ userId: OTHER }, shared, "view").allowed, true);
	for (const action of ["edit", "publish", "archive", "delete", "run", "assign", "evaluate"] as const) {
		const decision = authorizePromptAction({ userId: OTHER }, shared, action);
		assert.equal(decision.allowed, false, `${action} must stay with the owner`);
	}
});

test("the owner is allowed, except publishing or running an archived prompt", () => {
	const live = { ownerUserId: OWNER, status: "DRAFT", visibility: "PRIVATE" } as const;
	for (const action of ALL_ACTIONS) {
		assert.equal(authorizePromptAction({ userId: OWNER }, live, action).allowed, true);
	}

	const archived = { ownerUserId: OWNER, status: "ARCHIVED", visibility: "PRIVATE" } as const;
	for (const action of ["publish", "run"] as const) {
		const decision = authorizePromptAction({ userId: OWNER }, archived, action);
		assert.equal(decision.allowed, false);
		assert.equal(decision.allowed === false && decision.status, 409);
	}
	assert.equal(authorizePromptAction({ userId: OWNER }, archived, "view").allowed, true);
});

test("only the published version may execute in a runtime surface", () => {
	assert.equal(
		canExecutePromptVersion({
			status: "PUBLISHED",
			publishedVersionId: "v3",
			requestedVersionId: "v3",
		}).allowed,
		true,
	);
	for (const input of [
		{ status: "DRAFT" as const, publishedVersionId: null, requestedVersionId: "v1" },
		{ status: "PUBLISHED" as const, publishedVersionId: "v3", requestedVersionId: "v2" },
		{ status: "ARCHIVED" as const, publishedVersionId: null, requestedVersionId: "v1" },
	]) {
		const decision = canExecutePromptVersion(input);
		assert.equal(decision.allowed, false);
		assert.equal(decision.allowed === false && decision.status, 409);
	}
});

test("the playground allows drafts but only for the owner", () => {
	const draft = { ownerUserId: OWNER, status: "DRAFT", visibility: "PRIVATE" } as const;
	assert.equal(canTestPromptVersion({ userId: OWNER }, draft).allowed, true);
	assert.equal(canTestPromptVersion({ userId: OTHER }, draft).allowed, false);
	assert.equal(canTestPromptVersion({ userId: null }, draft).allowed, false);

	const shared = { ownerUserId: OWNER, status: "DRAFT", visibility: "WORKSPACE" } as const;
	assert.equal(
		canTestPromptVersion({ userId: OTHER }, shared).allowed,
		false,
		"workspace read access does not grant execution",
	);
});

test("version rows are immutable — only create, publish and unpublish are permitted", () => {
	for (const allowed of ["create", "publish", "unpublish"]) {
		assert.doesNotThrow(() => assertVersionMutationAllowed(allowed));
	}
	for (const forbidden of ["update", "edit", "overwrite", "delete", "patch"]) {
		assert.throws(() => assertVersionMutationAllowed(forbidden), /immutable/);
	}
});

// --- Route-level contract ------------------------------------------------

test("every prompt API route resolves a session before doing work", () => {
	const routes = walkRoutes(PROMPT_API_ROOT);
	assert.ok(routes.length >= 7, `expected the prompt API surface, found ${routes.length} routes`);

	for (const file of routes) {
		const source = readFileSync(file, "utf8");
		const relative = path.relative(WEB_ROOT, file).replaceAll(path.sep, "/");
		assert.ok(
			source.includes("requireUserId()"),
			`${relative} must resolve the session through requireUserId`,
		);
		for (const handler of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
			const marker = `export async function ${handler}`;
			const index = source.indexOf(marker);
			if (index < 0) continue;
			const body = source.slice(index, index + 600);
			assert.ok(
				body.includes("await requireUserId()"),
				`${relative} ${handler} must authenticate before any other work`,
			);
			assert.ok(
				body.includes("if (!session.ok) return session.response;"),
				`${relative} ${handler} must return the unauthenticated response`,
			);
		}
	}
});

test("the registry scopes every prompt read and write by userId", () => {
	const source = read("lib/prompts/prompt-registry.ts");

	for (const call of [
		"prisma.prompt.findFirst({ where: { id: promptId, userId } })",
		"prisma.promptVersion.findFirst({",
		"prisma.prompt.deleteMany({ where: { id: promptId, userId } })",
	]) {
		assert.ok(source.includes(call), `registry must contain ownership-scoped call: ${call}`);
	}

	// No prompt lookup may be keyed by id alone.
	assert.ok(
		!/prisma\.prompt\.findUnique\(\s*\{\s*where:\s*\{\s*id:/.test(source),
		"prompts must never be fetched by id without a userId scope",
	);
	assert.ok(
		!/prisma\.promptVersion\.findUnique\(/.test(source),
		"versions must never be fetched without a userId scope",
	);
});

test("the runtime template resolver refuses drafts and other users' prompts", () => {
	const source = read("lib/prompts/runtime-template.ts");
	assert.ok(
		source.includes("where: { id: request.promptId, userId: request.userId }"),
		"an explicit promptId is always scoped to the session user",
	);
	assert.ok(
		source.includes("prompt.status !== PromptStatus.PUBLISHED"),
		"only published prompts reach the runtime",
	);
	assert.ok(source.includes("return undefined;"), "resolution failure falls back to AIRA defaults");
});

test("the chat runtime never trusts a client-supplied template body", () => {
	const source = read("app/api/search/route-core.ts");
	assert.ok(source.includes("resolveRuntimeTemplate({"), "templates resolve server-side");
	assert.ok(source.includes("userId,"), "resolution is scoped to the session user");
	assert.ok(
		!/promptBody|templateBody|systemPrompt\s*:/.test(source),
		"no prompt text may be accepted from the client",
	);
});
