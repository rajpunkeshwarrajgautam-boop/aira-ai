import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

function walk(dir: string): string[] {
	const output: string[] = [];
	for (const entry of readdirSync(dir)) {
		const absolute = path.join(dir, entry);
		if (statSync(absolute).isDirectory()) output.push(...walk(absolute));
		else output.push(absolute);
	}
	return output;
}

function routeFiles(): Set<string> {
	const routes = new Set<string>(["/"]);
	const appDir = path.join(WEB_ROOT, "app");
	for (const file of walk(appDir)) {
		if (!file.endsWith(`${path.sep}page.tsx`)) continue;
		const relative = path.relative(appDir, path.dirname(file)).replaceAll(path.sep, "/");
		routes.add(relative ? `/${relative}` : "/");
	}
	return routes;
}

test("core UI contains no literal empty or hash-only links", () => {
	const directories = [path.join(WEB_ROOT, "app"), path.join(WEB_ROOT, "components")];
	for (const directory of directories) {
		for (const file of walk(directory)) {
			if (!/\.(tsx|ts)$/.test(file)) continue;
			const source = readFileSync(file, "utf8");
			assert.ok(!/href=["'](?:|#)["']/.test(source), `${path.relative(WEB_ROOT, file)} contains an empty or hash-only href`);
		}
	}
});

test("static Next Link destinations resolve to real app routes", () => {
	const routes = routeFiles();
	const directories = [path.join(WEB_ROOT, "app"), path.join(WEB_ROOT, "components")];
	for (const directory of directories) {
		for (const file of walk(directory)) {
			if (!/\.tsx$/.test(file)) continue;
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(/<Link[^>]*href=["']([^"']+)["']/g)) {
				const href = match[1];
				if (!href) continue;
				if (!href.startsWith("/") || href.startsWith("//")) continue;
				const route = href.split(/[?#]/)[0] || "/";
				if (route.includes("${") || route.includes("[")) continue;
				assert.ok(routes.has(route), `${path.relative(WEB_ROOT, file)} links to missing route ${route}`);
			}
		}
	}
});

test("type=button controls are not decorative no-ops", () => {
	const directories = [path.join(WEB_ROOT, "app"), path.join(WEB_ROOT, "components")];
	for (const directory of directories) {
		for (const file of walk(directory)) {
			if (!/\.tsx$/.test(file)) continue;
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(/<button(?<attrs>[^>]*)type=["']button["'](?<rest>[^>]*)>/g)) {
				const attrs = `${match.groups?.attrs ?? ""}${match.groups?.rest ?? ""}`;
				const interactive = /onClick=|onMouseDown=|onPointerDown=|onSubmit=/.test(attrs) || /disabled/.test(attrs);
				assert.ok(interactive, `${path.relative(WEB_ROOT, file)} contains a type=button control without an action`);
			}
		}
	}
});

test("global search conversation results open any authenticated saved conversation", () => {
	const api = read("app/api/global-search/route.ts");
	const sidebar = read("components/conversations/ConversationSidebar.tsx");
	assert.ok(api.includes("listConversations(session.user.id"));
	assert.ok(api.includes("listConversationMessages(session.user.id"));
	assert.ok(api.includes("listUserMemories(session.user.id"));
	assert.ok(api.includes("/?conversation=${encodeURIComponent(conversation.id)}"));
	assert.ok(sidebar.includes('searchParams.get("conversation")'));
	assert.ok(sidebar.includes("onSelectConversation(targetConversationId)"));
});

test("global memory search opens and focuses the exact memory", () => {
	const api = read("app/api/global-search/route.ts");
	const manager = read("components/memory/MemoryManager.tsx");
	assert.ok(api.includes("/memory?memory="));
	assert.ok(manager.includes('searchParams.get("memory")'));
	assert.ok(manager.includes("scrollIntoView"));
	assert.ok(manager.includes("Search result"));
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
	const frame = read("components/AiraV2Frame.tsx");
	assert.ok(frame.includes('href: "/settings#integrations"'));
	assert.ok(settings.includes('id="integrations"'));
	assert.ok(settings.includes("Refresh status"));
	assert.ok(settings.includes("INTEGRATION_DESTINATIONS"));
});

test("pricing preserves Pro and Team checkout selections", () => {
	const pricing = read("app/pricing/page.tsx");
	const upgrade = read("app/upgrade/page.tsx");
	assert.ok(pricing.includes('"/upgrade?plan=pro"'));
	assert.ok(pricing.includes('"/upgrade?plan=team"'));
	assert.ok(pricing.includes('fetch("/api/billing/status"'));
	assert.ok(upgrade.includes('new URLSearchParams(window.location.search).get("plan")'));
	assert.ok(upgrade.includes("callbackUrl = requested ? `/upgrade?plan=${requested}` : \"/upgrade\""));
});

test("admin analytics navigation is capability-aware", () => {
	const frame = read("components/AiraV2Frame.tsx");
	const accessRoute = read("app/api/admin/access/route.ts");
	assert.ok(frame.includes('fetch("/api/admin/access"'));
	assert.ok(frame.includes("analyticsAdmin ? [...SYSTEM_NAV, ANALYTICS_NAV] : SYSTEM_NAV"));
	assert.ok(accessRoute.includes("requireAnalyticsAdmin"));
	assert.ok(accessRoute.includes("analyticsAdmin: true"));
	assert.ok(accessRoute.includes("analyticsAdmin: false"));
});

test("Automation navigation resolves to truthful capability-aware routes", () => {
	const frame = read("components/AiraV2Frame.tsx");
	const browserAgent = read("app/browser-agent/page.tsx");
	const swarms = read("app/swarms/page.tsx");
	const projects = read("app/projects/page.tsx");
	const governance = read("app/governance/page.tsx");

	for (const destination of ["/browser-agent", "/swarms", "/projects", "/governance"]) {
		assert.ok(frame.includes(`href: "${destination}"`), `expected ${destination} in the unified shell`);
	}
	assert.ok(frame.includes('label="Automation"'));
	assert.ok(browserAgent.includes('fetch("/api/local-ai/status"'));
	assert.ok(browserAgent.includes("does not yet expose a durable browser-session control contract"));
	assert.ok(swarms.includes('fetch("/api/agents/runs?limit=12"'));
	assert.ok(swarms.includes("does not fabricate a control-room graph"));
	assert.ok(projects.includes('state="unsupported"'));
	assert.ok(projects.includes("durable Project entity"));
	assert.ok(governance.includes('fetch("/api/admin/access"'));
	assert.ok(governance.includes("do not yet have a complete server-side policy contract"));
});