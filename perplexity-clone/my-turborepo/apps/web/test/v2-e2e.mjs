import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = Number(process.env.V2_E2E_PORT ?? "3217");
const baseUrl = `http://127.0.0.1:${port}`;
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const child = spawn(command, ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AUTH_SECRET: process.env.AUTH_SECRET || "aira-v2-e2e-secret-not-for-production-000000000000",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "aira-v2-e2e-secret-not-for-production-000000000000",
    AUTH_URL: process.env.AUTH_URL || baseUrl,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || baseUrl,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "v2-e2e-google-client",
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "v2-e2e-google-secret",
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || "v2-e2e-github-client",
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || "v2-e2e-github-secret",
    DATABASE_URL:
      process.env.DATABASE_URL || "postgresql://aira:aira@127.0.0.1:65432/aira_v2_e2e?connect_timeout=1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += String(chunk); });
child.stderr.on("data", (chunk) => { output += String(chunk); });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before V2 E2E started.\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/v2`, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // Server has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${output}`);
}

async function expectUnauthenticated(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  assert.equal(response.status, 401, `${path} must remain protected for an anonymous V2 client`);
  const body = await response.json();
  assert.equal(body?.error?.code, "UNAUTHENTICATED", `${path} must use the existing auth contract`);
}

try {
  await waitForServer();

  const page = await fetch(`${baseUrl}/v2`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /AIRA/);
  assert.match(html, /V2 ACCEPTANCE/);
  assert.match(html, /Skip to main content/);
  assert.match(html, /Research/);
  assert.match(html, /Agents/);
  assert.match(html, /Memory/);
  assert.match(html, /Library/);
  assert.match(html, /Settings/);
  assert.doesNotMatch(html, /NEXT_REDIRECT/);

  await expectUnauthenticated("/api/billing/status");
  await expectUnauthenticated("/api/memory");
  await expectUnauthenticated("/api/agents/runs?limit=1");
  await expectUnauthenticated("/api/history/research?limit=1");
  await expectUnauthenticated("/api/share", {
    method: "POST",
    body: JSON.stringify({ conversationId: "e2e-conversation", messageId: "e2e-message" }),
  });

  const invalidSearch = await fetch(`${baseUrl}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json",
  });
  assert.equal(invalidSearch.status, 400, "search route should reject invalid JSON before any provider execution");

  console.log("AIRA V2 E2E passed: built route rendered and protected compatibility APIs remained fail-closed.");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
