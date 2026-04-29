/* eslint-disable no-console */
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

// Ensure prisma datasource validation can run without relying on shell env.
function loadDatabaseUrlFromDotEnv(dotEnvPath) {
  const raw = fs.readFileSync(dotEnvPath, "utf8");
  const match = raw.match(/^DATABASE_URL="([^"]+)"$/m);
  if (match?.[1]) {
    process.env.DATABASE_URL = match[1];
  }
}

loadDatabaseUrlFromDotEnv(".env");

const args = ["prisma", "generate", "--schema", "prisma/schema.prisma"];
const prismaBin = require.resolve("prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaBin, "generate", "--schema", "prisma/schema.prisma"], {
  stdio: "pipe",
  env: process.env,
  encoding: "utf8",
});

try {
  fs.writeFileSync(
    "prisma-generate.log",
    `${result.stdout ?? ""}\n--- STDERR ---\n${result.stderr ?? ""}\n--- SPAWN ERROR ---\n${
      result.error ? String(result.error) : ""
    }`.slice(0, 200_000),
    "utf8",
  );
} catch {
  // Ignore log write failures.
}

process.exit(result.status ?? 1);

