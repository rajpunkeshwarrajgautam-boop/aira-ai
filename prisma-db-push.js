/* eslint-disable no-console */
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function loadDatabaseUrlFromDotEnv(dotEnvPath) {
  const raw = fs.readFileSync(dotEnvPath, "utf8");
  const match = raw.match(/^DATABASE_URL="([^"]+)"$/m);
  if (match?.[1]) process.env.DATABASE_URL = match[1];
}

loadDatabaseUrlFromDotEnv(".env");

const prismaBin = require.resolve("prisma/build/index.js");
const args = ["db", "push", "--accept-data-loss"];

const result = spawnSync(process.execPath, [prismaBin, ...args], {
  stdio: "pipe",
  env: process.env,
  encoding: "utf8",
});

try {
  fs.writeFileSync(
    "prisma-db-push.log",
    `${result.stdout ?? ""}\n--- STDERR ---\n${result.stderr ?? ""}`.slice(0, 250_000),
    "utf8",
  );
} catch {
  // ignore
}

process.exit(result.status ?? 1);

