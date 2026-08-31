import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../lib/tool-gateway/external-adapters.ts", import.meta.url), "utf8");

test("Supabase table access is bound to a server-owned allowlist", () => {
	assert.match(source, /AIRA_SUPABASE_TOOL_ALLOWED_TABLES/);
	assert.match(source, /function assertSupabaseTableAllowed\(schema: string, table: string\)/);
	const guards = source.match(/assertSupabaseTableAllowed\(parsed\.data\.schema, parsed\.data\.table\)/g) ?? [];
	assert.equal(guards.length, 2, "both read and write table access must be allowlisted");
	assert.match(source, /code:\s*"SUPABASE_TABLE_NOT_ALLOWED"/);
});

test("Supabase schema inspection is restricted to allowlisted tables", () => {
	assert.match(source, /\(table_schema \|\| '\.' \|\| table_name\)=any\(\$1::text\[\]\)/);
	assert.match(source, /allowedTableCount/);
});

test("non-destructive writes do not echo generated or default row columns", () => {
	assert.doesNotMatch(source, /values \(\$\{placeholders\}\) returning \*/);
	assert.match(source, /return \{ result: \{ rowCount: result\.rowCount \?\? 0 \} \}/);
});

test("Supabase writes remain disabled in production environments", () => {
	assert.match(source, /AIRA_SUPABASE_TOOL_ALLOW_WRITES/);
	assert.match(source, /\^prod\(\?:uction\)\?\$/);
	assert.match(source, /code:\s*"SUPABASE_WRITE_DISABLED"/);
});
