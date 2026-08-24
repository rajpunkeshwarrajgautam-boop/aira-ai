import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../../../..");

function repoSource(relativePath: string): string {
	return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function webSource(relativePath: string): string {
	return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

test("FREE embedding OCI module is locked to a conservative Always Free A1 shape", () => {
	const variables = repoSource("infra/semantic-embedding/terraform-oci/variables.tf");
	const main = repoSource("infra/semantic-embedding/terraform-oci/main.tf");
	assert.match(variables, /default\s+=\s+"VM\.Standard\.A1\.Flex"/);
	assert.match(variables, /variable "instance_ocpus"[\s\S]*?default\s+=\s+1/);
	assert.match(variables, /variable "instance_memory_gb"[\s\S]*?default\s+=\s+6/);
	assert.match(variables, /variable "boot_volume_gb"[\s\S]*?default\s+=\s+50/);
	assert.match(main, /condition\s+=\s+var\.instance_memory_gb <= var\.instance_ocpus \* 6/);
	assert.match(main, /min = 80[\s\S]*?max = 80/);
	assert.match(main, /min = 443[\s\S]*?max = 443/);
	assert.doesNotMatch(main, /min = 8080|port\s*=\s*8080/);
});

test("host bootstrap pins upstream code and model integrity and keeps llama-server on loopback", () => {
	const bootstrap = repoSource("infra/semantic-embedding/scripts/bootstrap-host.sh");
	assert.match(bootstrap, /b3c3b96a139d4ef1bdec926ac17aa040981cfc5d/);
	assert.match(bootstrap, /3e24342164b3d94991ba9692fdc0dd08e3fd7362e0aacc396a9a5c54a544c3b7/);
	assert.match(bootstrap, /--embedding/);
	assert.match(bootstrap, /--pooling mean/);
	assert.match(bootstrap, /--host 127\.0\.0\.1/);
	assert.match(bootstrap, /path \/v1\/embeddings/);
	assert.match(bootstrap, /header Authorization "Bearer \{\$AIRA_EMBEDDING_AUTH_TOKEN\}"/);
	assert.match(bootstrap, /len\(vector\) == 768/);
	assert.doesNotMatch(bootstrap, /NEXT_PUBLIC_/);
});

test("external endpoint verifier requires HTTPS, bearer auth and a 768-dimensional finite vector", () => {
	const verifier = repoSource("infra/semantic-embedding/scripts/verify_endpoint.py");
	assert.match(verifier, /startswith\("https:\/\/"\)/);
	assert.match(verifier, /Authorization.*Bearer/);
	assert.match(verifier, /exc\.code == 401/);
	assert.match(verifier, /len\(vector\) != 768/);
	assert.match(verifier, /math\.isfinite/);
	assert.match(verifier, /token_printed=NO/);
	assert.match(verifier, /vector_printed=NO/);
});

test("semantic embedding telemetry is route-only and never logs user text or credentials", () => {
	const semantic = webSource("lib/semantic-memory.ts");
	assert.match(semantic, /\[AIRA semantic embedding\] request complete/);
	assert.match(semantic, /\[AIRA semantic embedding\] request failed/);
	assert.match(semantic, /workload: args\.workload/);
	assert.match(semantic, /failureClass: semanticEmbeddingFailureClass/);
	const telemetryBlock = semantic.slice(
		semantic.indexOf("function logSemanticEmbeddingAttempt"),
		semantic.indexOf("export function semanticEmbeddingVectorLiteral"),
	);
	assert.doesNotMatch(telemetryBlock, /userId|apiKey|input|text|query|content|authorization|cookie/i);
});
