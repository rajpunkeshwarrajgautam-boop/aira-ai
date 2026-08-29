import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../../../..");
const WORKER = path.join(REPO_ROOT, "infra/aira-runtime/reconciler-worker.sh");
const INSTALLER = path.join(REPO_ROOT, "infra/aira-runtime/install-reconciler.sh");
const UNIT = path.join(REPO_ROOT, "infra/aira-runtime/systemd/aira-reconciler.service");

async function source(file: string): Promise<string> {
	return readFile(file, "utf8");
}

test("persistent reconciler calls only AIRA's protected existing-run endpoint", async () => {
	const token = "contract-reconciler-token-not-a-secret";
	let calls = 0;
	let seenAuthorization = "";
	let seenMethod = "";
	let seenPath = "";

	const server = http.createServer((req, res) => {
		calls += 1;
		seenAuthorization = req.headers.authorization ?? "";
		seenMethod = req.method ?? "";
		seenPath = req.url ?? "";
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end('{"scanned":0,"refreshed":0,"skipped":0,"failed":0}');
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address === "object");
	const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "aira-reconciler-test-"));

	try {
		const result = await execFileAsync("bash", [WORKER, "--once"], {
			env: {
				...process.env,
				AIRA_APP_BASE_URL: `http://127.0.0.1:${address.port}`,
				AIRA_AGENT_RECONCILER_TOKEN: token,
				AIRA_RECONCILER_ALLOW_HTTP_LOOPBACK: "true",
				AIRA_RECONCILE_INTERVAL_SECONDS: "5",
				AIRA_RECONCILE_JITTER_SECONDS: "0",
				AIRA_RECONCILE_REQUEST_TIMEOUT_SECONDS: "5",
				AIRA_RECONCILE_MAX_BACKOFF_SECONDS: "10",
				RUNTIME_DIRECTORY: runtimeDir,
			},
		});

		assert.equal(calls, 1, "--once must issue exactly one reconciliation pass");
		assert.equal(seenMethod, "POST");
		assert.equal(seenPath, "/api/internal/agents/reconcile");
		assert.equal(seenAuthorization, `Bearer ${token}`);
		assert.ok(!result.stdout.includes(token));
		assert.ok(!result.stderr.includes(token));
	} finally {
		server.close();
		await rm(runtimeDir, { recursive: true, force: true });
	}
});

test("persistent reconciler rejects insecure non-loopback origins before network execution", async () => {
	const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "aira-reconciler-reject-"));
	try {
		await assert.rejects(
			execFileAsync("bash", [WORKER, "--once"], {
				env: {
					...process.env,
					AIRA_APP_BASE_URL: "http://example.com",
					AIRA_AGENT_RECONCILER_TOKEN: "contract-reconciler-token-not-a-secret",
					RUNTIME_DIRECTORY: runtimeDir,
				},
			}),
		);
	} finally {
		await rm(runtimeDir, { recursive: true, force: true });
	}
});

test("reconciler secrets stay out of argv/logging and installer persists one server-only token", async () => {
	const worker = await source(WORKER);
	const installer = await source(INSTALLER);

	assert.ok(worker.includes('curl --config "$curl_config" "$endpoint"'));
	assert.ok(!worker.includes('--header "Authorization: Bearer'));
	assert.ok(worker.includes('flock -n 9'));
	assert.ok(worker.includes("AIRA_RECONCILE_MAX_BACKOFF_SECONDS"));
	assert.ok(worker.includes("AIRA_RECONCILE_JITTER_SECONDS"));
	assert.ok(worker.includes('endpoint="$base_url/api/internal/agents/reconcile"'));
	assert.ok(!worker.includes("createDeerFlowRun"));
	assert.ok(!worker.includes("executeAutoGptGraph"));

	assert.ok(installer.includes("openssl rand -hex 32"));
	assert.ok(installer.includes("chmod 0600 \"$ENV_FILE\""));
	assert.ok(installer.includes("chmod 0600 \"$VERCEL_ENV_FILE\""));
	assert.ok(installer.includes("systemctl enable --now aira-reconciler.service"));
	assert.ok(!installer.includes('log "$existing_token"'));
});

test("systemd reconciler service is unprivileged and restart-safe", async () => {
	const unit = await source(UNIT);
	assert.ok(unit.includes("User=aira-reconciler"));
	assert.ok(unit.includes("EnvironmentFile=/etc/aira/reconciler.env"));
	assert.ok(unit.includes("RuntimeDirectory=aira-reconciler"));
	assert.ok(unit.includes("NoNewPrivileges=true"));
	assert.ok(unit.includes("ProtectSystem=strict"));
	assert.ok(unit.includes("ProtectHome=true"));
	assert.ok(unit.includes("CapabilityBoundingSet="));
	assert.ok(unit.includes("Restart=always"));
});
