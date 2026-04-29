/* eslint-disable no-console */
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function loadDatabaseUrlFromDotEnv(dotEnvPath) {
	const raw = fs.readFileSync(dotEnvPath, "utf8");
	const match = raw.match(/^DATABASE_URL="([^"]+)"$/m);
	if (match?.[1]) process.env.DATABASE_URL = match[1];
}

loadDatabaseUrlFromDotEnv(".env");

const args = ["prisma", "migrate", "dev", "--name", "add-research-share-token"];
const prismaBin = require.resolve("prisma/build/index.js");

const result = spawnSync(process.execPath, [prismaBin, ...args.slice(1)], {
	stdio: "pipe",
	env: process.env,
	encoding: "utf8",
});

try {
	fs.writeFileSync(
		"prisma-migrate-dev.log",
		`${result.stdout ?? ""}\n--- STDERR ---\n${result.stderr ?? ""}`.slice(0, 250_000),
		"utf8",
	);
} catch {
	// Ignore.
}

process.exit(result.status ?? 1);

