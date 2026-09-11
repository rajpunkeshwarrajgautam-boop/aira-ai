import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import {
	assertSafeArtifactName,
	globalArtifactEngine,
	isBinaryExecutable,
} from "../lib/artifacts/engine";
import {
	buildZip,
	MAX_TOTAL_UNCOMPRESSED_SIZE,
	MAX_UNCOMPRESSED_FILE_SIZE,
	unpackZip,
} from "../lib/artifacts/native-formats";
import { redactSecrets } from "../lib/connectors/credential-store";

// ============================================================================
// GATE 29: AUTONOMOUS SECURITY RED TEAM & ADVERSARIAL REGRESSION CORPUS
// Malicious files, archives, MIME confusion, hostile filenames, oversize payloads
// ============================================================================

test("Gate 29 Red Team: Zip Slip traversal in archives is detected and rejected", () => {
	const maliciousPaths = [
		"../../../../etc/passwd",
		"..\\..\\..\\windows\\system32\\cmd.exe",
		"/absolute/root/escape.sh",
		"\\windows\\system.ini",
		"C:\\boot.ini",
		"normal/sub/../../../escape.txt",
		"null_byte\0escape.txt",
	];

	for (const malPath of maliciousPaths) {
		// Construct zip entry with malicious path
		const zipBuffer = buildZip([{ path: malPath, data: "malicious_payload" }]);
		assert.throws(
			() => unpackZip(zipBuffer),
			(err: Error) =>
				err.message.includes("Zip Slip") ||
				err.message.includes("Malicious zip entry path") ||
				err.message.includes("malformed") ||
				err.message.includes("boundary"),
			`Path ${malPath} must be rejected by unpackZip`,
		);
	}
});

test("Gate 29 Red Team: Zip decompression bomb / expansion ratio attack is rejected", () => {
	// Construct a payload that claims an oversized uncompressed header or large data
	const largeBuf = Buffer.alloc(1024, "A");
	const deflated = deflateRawSync(largeBuf);

	// Craft a local zip header where uncompressed size claims > MAX_UNCOMPRESSED_FILE_SIZE
	const name = "bomb.txt";
	const header = Buffer.alloc(30 + name.length);
	header.writeUInt32LE(0x04034b50, 0); // local file header sig
	header.writeUInt16LE(20, 4); // version needed
	header.writeUInt16LE(0, 6); // general flags
	header.writeUInt16LE(8, 8); // compression method (deflate)
	header.writeUInt16LE(0, 10); // time
	header.writeUInt16LE(0, 12); // date
	header.writeUInt32LE(0x12345678, 14); // crc32
	header.writeUInt32LE(deflated.length, 18); // compressed size
	header.writeUInt32LE(MAX_UNCOMPRESSED_FILE_SIZE + 1024, 22); // OVERSIZED UNCOMPRESSED SIZE HEADER
	header.writeUInt16LE(name.length, 26); // file name length
	header.writeUInt16LE(0, 28); // extra field length
	header.write(name, 30, "utf8");

	const craftedZip = Buffer.concat([header, deflated]);

	assert.throws(
		() => unpackZip(craftedZip),
		(err: Error) => err.message.includes("exceeds maximum allowed file size"),
		"Oversized uncompressed size header must trigger immediate rejection",
	);
});

test("Gate 29 Red Team: Corrupt and out-of-bounds zip structures fail closed", () => {
	const corruptBuffer = Buffer.alloc(60);
	corruptBuffer.writeUInt32LE(0x04034b50, 0); // sig
	corruptBuffer.writeUInt16LE(0, 8); // stored
	corruptBuffer.writeUInt32LE(5000, 18); // compressed size extends far beyond buffer length
	corruptBuffer.writeUInt16LE(4, 26); // name length
	corruptBuffer.writeUInt16LE(0, 28); // extra length
	corruptBuffer.write("test", 30, "utf8");

	assert.throws(
		() => unpackZip(corruptBuffer),
		(err: Error) => err.message.includes("extends beyond buffer boundary") || err.message.includes("Malformed"),
	);
});

test("Gate 29 Red Team: Hostile artifact filenames are rejected", () => {
	const hostileNames = [
		"",
		"   ",
		"../../traversal.pdf",
		"..\\windows\\system32.dll",
		"/etc/shadow",
		"C:\\Windows\\explorer.exe",
		"null\0byte.txt",
		"CON.txt",
		"prn.pdf",
		"aux.docx",
		"NUL.json",
		"com1.csv",
		"lpt1.txt",
		"trojan\u202Ecod.exe", // RTL override
		"a".repeat(256) + ".pdf", // Exceeds 255 chars
	];

	for (const name of hostileNames) {
		assert.throws(
			() => assertSafeArtifactName(name),
			(err: Error) =>
				err.message.includes("Artifact name") ||
				err.message.includes("null") ||
				err.message.includes("traversal") ||
				err.message.includes("reserved") ||
				err.message.includes("override") ||
				err.message.includes("maximum length"),
			`Hostile filename "${name}" must be rejected`,
		);
	}

	// Safe filenames must pass without error
	assertSafeArtifactName("quarterly-report-2026.pdf");
	assertSafeArtifactName("data_analysis_v2.xlsx");
	assertSafeArtifactName("diagram.svg");
	assertSafeArtifactName("archive-bundle.zip");
});

test("Gate 29 Red Team: MIME / Polyglot and executable disguised as text/JSON is detected", () => {
	// PE Executable header (MZ)
	const fakePe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
	assert.equal(isBinaryExecutable(fakePe), true);

	// ELF Linux executable header
	const fakeElf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
	assert.equal(isBinaryExecutable(fakeElf), true);

	// Mach-O headers
	const fakeMachO1 = Buffer.from([0xfe, 0xed, 0xfa, 0xce, 0x00, 0x00, 0x00, 0x00]);
	assert.equal(isBinaryExecutable(fakeMachO1), true);
	const fakeMachO2 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00, 0x00, 0x00, 0x00]);
	assert.equal(isBinaryExecutable(fakeMachO2), true);

	// Clean text / json is not executable
	const cleanJson = Buffer.from('{"status": "ok", "count": 42}');
	assert.equal(isBinaryExecutable(cleanJson), false);

	// Validation rejection when trying to create a text/json artifact with binary executable
	const result = globalArtifactEngine["validator"].validate("JSON", fakePe);
	assert.equal(result.isValid, false);
	assert.ok(result.errors.some((e) => e.includes("Forbidden executable binary signature")));
});

test("Gate 29 Red Team: SVG active content (XSS vectors) are neutralized / rejected", () => {
	const xssSvgs = [
		'<svg><script>alert("xss")</script></svg>',
		'<svg onload="alert(1)"></svg>',
		'<svg><a href="javascript:alert(1)"><text>Click</text></a></svg>',
		'<svg><foreignObject><iframe src="evil.com"></iframe></foreignObject></svg>',
	];

	for (const svg of xssSvgs) {
		const result = globalArtifactEngine["validator"].validate("DESIGN_SVG", svg);
		assert.equal(result.isValid, false);
		assert.ok(result.errors.some((e) => e.includes("dangerous active content")));
	}

	// Clean SVG passes
	const cleanSvg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>';
	const cleanResult = globalArtifactEngine["validator"].validate("DESIGN_SVG", cleanSvg);
	assert.equal(cleanResult.isValid, true);
});

test("Gate 29 Red Team: Recursive credential scrubber protects sensitive tokens and URIs", () => {
	const sensitiveInput = {
		user: "admin",
		apiKey: "sk-proj-1234567890abcdef1234567890abcdef",
		authToken: "ghp_1234567890abcdef1234567890abcdef",
		clientSecret: "super_secret_client_key_999",
		connectionUrl: "postgresql://postgres:p@ssword123@db.prod.internal:5432/secrets",
		nested: {
			awsSecret: "AKIAIOSFODNN7EXAMPLE",
			bearer: "Bearer eyJhbGciOiJIUzI1NiJ9.token",
		},
		cleanPublicInfo: "Safe description",
	};

	const scrubbed = redactSecrets(sensitiveInput);

	assert.equal(scrubbed.apiKey, "[REDACTED]");
	assert.equal(scrubbed.authToken, "[REDACTED_SECRET]");
	assert.equal(scrubbed.clientSecret, "[REDACTED]");
	assert.equal(scrubbed.cleanPublicInfo, "Safe description");
	assert.ok(!JSON.stringify(scrubbed).includes("p@ssword123"));
	assert.ok(!JSON.stringify(scrubbed).includes("sk-proj-"));
	assert.ok(!JSON.stringify(scrubbed).includes("ghp_"));
});
