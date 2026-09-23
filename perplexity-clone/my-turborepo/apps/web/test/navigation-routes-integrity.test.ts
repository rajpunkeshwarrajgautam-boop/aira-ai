import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("AiraV2Frame navigation destinations all resolve to existing app routes", () => {
	const routes = routeFiles();
	const framePath = path.join(WEB_ROOT, "components", "AiraV2Frame.tsx");
	const frameSource = readFileSync(framePath, "utf8");

	// Extract hrefs from PRIMARY_NAV and BOTTOM_NAV definitions
	const navMatches = [
		...frameSource.matchAll(/\{\s*href:\s*["']([^"']+)["'],\s*label:\s*["']([^"']+)["']/g),
	];

	assert.ok(navMatches.length >= 6, "Expected at least 6 navigation items defined in AiraV2Frame");

	for (const match of navMatches) {
		const href = match[1]!;
		const label = match[2]!;
		const route = href.split(/[?#]/)[0] || "/";
		assert.ok(
			routes.has(route),
			`Navigation item "${label}" with href "${href}" must resolve to a valid page route, but none was found in app/`,
		);
	}
});

test("Library and Templates routes exist as authentic pages under Concept 7", () => {
	const routes = routeFiles();
	assert.ok(routes.has("/library"), "Missing canonical route /library");
	assert.ok(routes.has("/templates"), "Missing canonical route /templates");

	const libraryPath = path.join(WEB_ROOT, "app", "library", "page.tsx");
	const templatesPath = path.join(WEB_ROOT, "app", "templates", "page.tsx");

	assert.ok(existsSync(libraryPath), "app/library/page.tsx must exist");
	assert.ok(existsSync(templatesPath), "app/templates/page.tsx must exist");

	const libraryContent = readFileSync(libraryPath, "utf8");
	const templatesContent = readFileSync(templatesPath, "utf8");

	// Verify Concept 7 Frame integration
	assert.ok(libraryContent.includes("AiraV2Frame"), "Library must render within AiraV2Frame");
	assert.ok(templatesContent.includes("AiraV2Frame"), "Templates must render within AiraV2Frame");

	// Verify authentic data sources (no placeholder stubs)
	assert.ok(
		libraryContent.includes("/api/conversations"),
		"Library must fetch real research conversations",
	);
	assert.ok(
		templatesContent.includes("/api/automation/routines"),
		"Templates must fetch real automation routine templates",
	);
});

test("AiraV2Frame topbar search button maintains mobile responsiveness invariants", () => {
	const framePath = path.join(WEB_ROOT, "components", "AiraV2Frame.tsx");
	const frameContent = readFileSync(framePath, "utf8");
	assert.ok(frameContent.includes("truncate"), "Topbar search label must truncate on narrow viewports");
	assert.ok(frameContent.includes("hidden sm:inline"), "Topbar search must conditionally collapse long placeholder text on mobile");
	assert.ok(frameContent.includes("sm:hidden"), "Topbar search must have short label for mobile viewports");
});
