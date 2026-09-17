import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("BL-02: mobile touch targets meet or exceed 44px min-dimensions", () => {
	const aiosCss = fs.readFileSync(
		path.join(__dirname, "../app/aira-intelligence-os.css"),
		"utf-8"
	);
	const redesignCss = fs.readFileSync(
		path.join(__dirname, "../app/aira-visual-redesign.css"),
		"utf-8"
	);

	// Verify .aira-v2-mobile-menu has min 44px
	assert.match(
		aiosCss,
		/\.aira-v2-mobile-menu\s*\{[^}]*min-width:\s*44px;\s*min-height:\s*44px;/s,
		"aira-v2-mobile-menu must enforce min-width and min-height 44px"
	);

	// Verify .aira-v2-mobile-close has min 44px
	assert.match(
		aiosCss,
		/\.aira-v2-mobile-close\s*\{[^}]*min-width:\s*44px;\s*min-height:\s*44px;/s,
		"aira-v2-mobile-close must enforce min-width and min-height 44px"
	);

	// Verify .aira-v2-topbar-command has min 44px
	assert.match(
		redesignCss,
		/\.aira-intelligence-os\s+\.aira-v2-topbar-command\s*\{[^}]*min-height:\s*44px\s*!important;\s*min-width:\s*44px\s*!important;/s,
		"aira-v2-topbar-command must enforce 44px touch target on mobile"
	);
});
