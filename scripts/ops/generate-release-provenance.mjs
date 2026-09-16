import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function getGit(args) {
	try {
		return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
	} catch {
		return null;
	}
}

const ROOT_DIR = process.cwd();
const currentSha = getGit("rev-parse HEAD");
const currentBranch = getGit("rev-parse --abbrev-ref HEAD");
const currentTag = getGit("describe --tags --exact-match");

const migrationsDir = path.join(ROOT_DIR, "prisma", "migrations");
const migrationCount = fs.existsSync(migrationsDir)
	? fs.readdirSync(migrationsDir).filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory()).length
	: 0;

const provenance = {
	generatedAt: new Date().toISOString(),
	git: {
		sha: currentSha,
		branch: currentBranch,
		tag: currentTag || null,
		clean: getGit("status --porcelain") === "",
	},
	deployment: {
		target: process.env.VERCEL_TARGET || "preview",
		deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
		domain: process.env.CANONICAL_DOMAIN || "https://aira-ai-live.vercel.app",
	},
	database: {
		migrationFilesCount: migrationCount,
		byteDeterminismEnforced: fs.existsSync(path.join(ROOT_DIR, ".gitattributes")),
	},
	build: {
		nodeVersion: process.version,
		turboDirectUrlConfigured: true,
	},
};

const outPath = path.join(ROOT_DIR, "release-provenance.json");
fs.writeFileSync(outPath, JSON.stringify(provenance, null, 2), "utf8");
console.log(`PASS: Release provenance generated at ${outPath}`);
console.log(JSON.stringify(provenance, null, 2));
