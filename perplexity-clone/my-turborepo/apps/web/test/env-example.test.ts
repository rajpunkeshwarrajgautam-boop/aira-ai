import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const ENV_EXAMPLE = path.join(REPO_ROOT, ".env.example");

const lines = readFileSync(ENV_EXAMPLE, "utf8").split(/\r?\n/);

const assignments = new Map<string, string>();
for (const line of lines) {
	const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
	if (match) assignments.set(match[1]!, match[2]!);
}

const REQUIRED_NAMES = [
	"DATABASE_URL",
	"AUTH_SECRET",
	"NEXTAUTH_SECRET",
	"AUTH_URL",
	"NEXTAUTH_URL",
	"GOOGLE_CLIENT_ID",
	"GOOGLE_CLIENT_SECRET",
	"GITHUB_CLIENT_ID",
	"GITHUB_CLIENT_SECRET",
	"EXA_API_KEY",
];

const SERVER_ONLY_NAMES = [
	"DEERFLOW_INTERNAL_AUTH_TOKEN",
	"SUPABASE_SERVICE_ROLE_KEY",
	"AUTH_SECRET",
	"NEXTAUTH_SECRET",
	"EXA_API_KEY",
	"NVIDIA_API_KEY",
	"OPENAI_API_KEY",
	"OMNIROUTE_API_KEY",
	"CASHFREE_CLIENT_SECRET",
	"CASHFREE_WEBHOOK_SECRET",
	"AIRA_CONTROL_PLANE_TOKEN",
	"AIRA_SANDBOX_TOKEN",
	"AIRA_KNOWLEDGE_WORKER_TOKEN",
	"AIRA_SAFETY_GATEWAY_TOKEN",
	"AUTOGPT_PRIMARY_API_KEY",
	"AUTOGPT_SECONDARY_API_KEY",
];

test("documents every variable required to boot and serve a grounded search", () => {
	for (const name of REQUIRED_NAMES) {
		assert.ok(assignments.has(name), `.env.example must document ${name}`);
	}
});

test("ships no populated credential", () => {
	const credentialShapes = [
		/^sk-[A-Za-z0-9_-]{8,}/,
		/^ghp_[A-Za-z0-9]{8,}/,
		/^gho_[A-Za-z0-9]{8,}/,
		/^AIza[A-Za-z0-9_-]{8,}/,
		/^nvapi-[A-Za-z0-9_-]{8,}/,
		/^eyJ[A-Za-z0-9_-]{16,}\./,
		/^postgres(ql)?:\/\/[^:]+:[^@]*[^@:]@/,
	];

	for (const [name, value] of assignments) {
		for (const shape of credentialShapes) {
			assert.ok(!shape.test(value), `.env.example appears to contain a real value for ${name}`);
		}
	}

	for (const name of SERVER_ONLY_NAMES) {
		const value = assignments.get(name);
		if (value === undefined) continue;
		assert.equal(value, "", `${name} is a secret and must be left blank in .env.example`);
	}
});

test("never exposes a secret through a NEXT_PUBLIC_ name", () => {
	const publicNames = [...assignments.keys()].filter((name) => name.startsWith("NEXT_PUBLIC_"));
	for (const name of publicNames) {
		assert.ok(
			!/(SECRET|TOKEN|_KEY|PASSWORD|CREDENTIAL)/.test(name),
			`${name} is browser-exposed and must not name a secret`,
		);
	}
	for (const name of SERVER_ONLY_NAMES) {
		assert.ok(
			!assignments.has(`NEXT_PUBLIC_${name}`),
			`NEXT_PUBLIC_${name} would publish a server-only secret to the browser`,
		);
	}
});

test("keeps every externally gated runtime disabled by default", () => {
	for (const name of [
		"DEERFLOW_AGENT_ENABLED",
		"AUTOGPT_AGENT_ENABLED",
		"OMNIROUTE_ENABLED",
		"PYTHON_SANDBOX_ENABLED",
		"SEMANTIC_MEMORY_ENABLED",
		"GRAPH_MEMORY_ENABLED",
		"MEMORY_CONSOLIDATION_ENABLED",
		"MULTIMODAL_INGESTION_ENABLED",
		"ADVANCED_MULTIMODAL_ENABLED",
		"FOUNDATION_CONTROL_PLANE_ENABLED",
		"AIRA_SAFETY_GATEWAY_ENABLED",
		"AIRA_TRAINING_EXECUTION_APPROVED",
		"AUTH_DEBUG",
	]) {
		const value = assignments.get(name);
		assert.ok(value !== undefined, `.env.example must document ${name}`);
		assert.equal(value, "false", `${name} must default to false`);
	}
});
