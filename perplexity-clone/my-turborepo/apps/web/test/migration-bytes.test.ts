import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function sha256(buffer: Buffer): string {
	return crypto.createHash("sha256").update(buffer).digest("hex");
}

test("migration byte determinism and .gitattributes compliance", () => {
	// From apps/web/test, repo root is 4 levels up
	const repoRoot = path.resolve(process.cwd(), "../../../../");
	const gitattributesPath = path.join(repoRoot, ".gitattributes");
	const migrationsDir = path.join(repoRoot, "prisma", "migrations");

	assert.ok(fs.existsSync(gitattributesPath), ".gitattributes must exist at repository root");
	const gitattributes = fs.readFileSync(gitattributesPath, "utf8");

	assert.match(
		gitattributes,
		/prisma\/migrations\/\*\*\/\*\.sql\s+text\s+eol=lf/,
		".gitattributes must enforce LF on future migration SQL files",
	);

	const release4Migration = "20260912_browser_rate_limit_events";
	const release4Path = path.join(migrationsDir, release4Migration, "migration.sql");
	assert.ok(fs.existsSync(release4Path), "Release 4 migration must exist");

	const release4Bytes = fs.readFileSync(release4Path);
	const release4Hash = sha256(release4Bytes);

	// The hash must either be the production CRLF hash (42e6b334...) or the canonical LF hash (2cc17967...)
	const validRelease4Hashes = [
		"42e6b334d7f92f2688d8b1650ee8295e74f53433870a7e7db292da35ee0a5c7c",
		"2cc1796735b58a9d0f2a90cfb82f052d24b48f7c64b428c4c218c99db372682f",
	];
	assert.ok(
		validRelease4Hashes.includes(release4Hash),
		`Release 4 migration hash ${release4Hash} must match known valid ledger checksums`,
	);

	// Scan any migrations alphabetically after Release 4: MUST NOT contain CRLF
	const dirs = fs.readdirSync(migrationsDir)
		.filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory())
		.sort();

	for (const dir of dirs) {
		if (dir > release4Migration) {
			const sqlPath = path.join(migrationsDir, dir, "migration.sql");
			if (fs.existsSync(sqlPath)) {
				const bytes = fs.readFileSync(sqlPath);
				assert.ok(
					!bytes.includes(Buffer.from("\r\n")),
					`Future migration ${dir} must use LF line endings, but contains CRLF`,
				);
			}
		}
	}
});
