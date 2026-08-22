import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = path.join(WEB_ROOT, "app");
const COMPONENTS_ROOT = path.join(WEB_ROOT, "components");

function read(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

function walkTsx(root: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(root)) {
		const full = path.join(root, name);
		const stat = statSync(full);
		if (stat.isDirectory()) files.push(...walkTsx(full));
		else if (name.endsWith(".tsx")) files.push(full);
	}
	return files;
}

function relativeToWeb(file: string): string {
	return path.relative(WEB_ROOT, file).replaceAll(path.sep, "/");
}

function appRouteExists(rawHref: string): boolean {
	const pathname = rawHref.split(/[?#]/, 1)[0] || "/";
	if (!pathname.startsWith("/") || pathname.startsWith("/api/")) return true;
	if (pathname === "/") return existsSync(path.join(APP_ROOT, "page.tsx"));
	const segments = pathname.split("/").filter(Boolean);
	return existsSync(path.join(APP_ROOT, ...segments, "page.tsx"));
}

test("core UI contains no literal empty or hash-only links", () => {
	for (const file of [...walkTsx(APP_ROOT), ...walkTsx(COMPONENTS_ROOT)]) {
		const source = readFileSync(file, "utf8");
		assert.ok(!/href\s*=\s*["'](?:|#)["']/.test(source), `${relativeToWeb(file)} contains a blank href`);
	}
});

test("static Next Link destinations resolve to real app routes", () => {
	const failures: string[] = [];
	for (const file of [...walkTsx(APP_ROOT), ...walkTsx(COMPONENTS_ROOT)]) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(/<Link\b[^>]*\bhref=["'](\/[A-Za-z0-9_?=#&./-]*)["'][^>]*>/g)) {
			const href = match[1];
			if (href && !appRouteExists(href)) failures.push(`${relativeToWeb(file)} -> ${href}`);
		}
	}
	assert.deepEqual(failures, [], `Found static links with no page route:\n${failures.join("\n")}`);
});

test("type=button controls are not decorative no-ops", () => {
	const failures: string[] = [];
	for (const file of [...walkTsx(APP_ROOT), ...walkTsx(COMPONENTS_ROOT)]) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(/<button\b[^>]*>/gs)) {
			const tag = match[0];
			if (!/type=["']button["']/.test(tag)) continue;
			if (/\bonClick=/.test(tag) || /\bdisabled\b/.test(tag)) continue;
			failures.push(`${relativeToWeb(file)}: ${tag.replace(/\s+/g, " ").slice(0, 180)}`);
		}
	}
	assert.deepEqual(failures, [], `Found type=button controls without an action:\n${failures.join("\n")}`);
});

test("global search conversation results open the saved conversation", () => {
	const api = read("app/api/global-search/route.ts");
	const sidebar = read("components/conversations/ConversationSidebar.tsx");
	assert.ok(api.includes("?conversation="));
	assert.ok(sidebar.includes('searchParams.get("conversation")'));
	assert.ok(sidebar.includes("onSelectConversation(targetConversationId)"));
});

test("history command resolves to the real workspace search", () => {
	const registry = read("lib/agents/commands/command-registry.ts");
	const composer = read("components/SearchBox.tsx");
	assert.ok(registry.includes('payload: "/workspace-search"'));
	assert.ok(composer.includes('window.location.assign("/workspace-search")'));
	assert.ok(!registry.includes("Type /help"), "registry must not advertise an unregistered /help command");
});

test("thread share controls use a real browser share or clipboard action", () => {
	const messages = read("components/conversations/ConversationMessageList.tsx");
	assert.ok(messages.includes("navigator.share"));
	assert.ok(messages.includes("navigator.clipboard.writeText(shareableText)"));
	assert.ok(!messages.includes('onClick={() => emitComposerCommand("/share")}'), "visible share controls should not recursively invoke the slash command");
	assert.ok(!messages.includes('>AIRA</button>'), "AIRA state label must not masquerade as a no-op button");
});

test("integrations shortcut lands on an actual settings anchor", () => {
	const settings = read("app/settings/page.tsx");
	const sidebar = read("components/conversations/ConversationSidebar.tsx");
	assert.ok(sidebar.includes('href="/settings#integrations"'));
	assert.ok(settings.includes('id="integrations"'));
});

test("pricing preserves Pro and Team checkout selections", () => {
	const pricing = read("app/pricing/page.tsx");
	const upgrade = read("app/upgrade/page.tsx");
	assert.ok(pricing.includes('"/upgrade?plan=pro"'));
	assert.ok(pricing.includes('"/upgrade?plan=team"'));
	assert.ok(upgrade.includes('new URLSearchParams(window.location.search).get("plan")'));
	assert.ok(upgrade.includes("callbackUrl = requested ? `/upgrade?plan=${requested}` : \"/upgrade\""));
});
