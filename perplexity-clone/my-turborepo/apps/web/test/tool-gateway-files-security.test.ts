import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const adapterSource = readFileSync(new URL("../lib/tool-gateway/native-adapters.ts", import.meta.url), "utf8");

function fileScript(): string {
	const marker = "const SAFE_FILE_SCRIPT = String.raw`";
	const start = adapterSource.indexOf(marker);
	assert.notEqual(start, -1, "SAFE_FILE_SCRIPT must remain directly inspectable by the security regression test");
	const bodyStart = start + marker.length;
	const end = adapterSource.indexOf("\n`;", bodyStart);
	assert.notEqual(end, -1, "SAFE_FILE_SCRIPT closing marker is missing");
	return adapterSource.slice(bodyStart, end);
}

function writeArgs(path: string, content: string): string[] {
	return ["-c", fileScript(), "write", path, Buffer.from(content, "utf8").toString("base64")];
}

function runPython(workspace: string, args: string[]) {
	return spawnSync("python3", args, { cwd: workspace, encoding: "utf8" });
}

test("Files sandbox rejects traversal, absolute paths and existing symlink escapes", (t) => {
	const root = mkdtempSync(join(tmpdir(), "aira-files-security-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	const outside = join(root, "outside");
	mkdirSync(workspace);
	mkdirSync(outside);
	symlinkSync(outside, join(workspace, "escape"), "dir");

	const normal = runPython(workspace, writeArgs("src/ok.txt", "safe"));
	assert.equal(normal.status, 0, normal.stderr);
	assert.equal(readFileSync(join(workspace, "src", "ok.txt"), "utf8"), "safe");

	for (const unsafePath of ["escape/pwn.txt", "..\\pwn.txt", join(outside, "absolute.txt"), ".git/config"]) {
		const result = runPython(workspace, writeArgs(unsafePath, "blocked"));
		assert.notEqual(result.status, 0, `unsafe path unexpectedly succeeded: ${unsafePath}`);
	}
	assert.equal(existsSync(join(outside, "pwn.txt")), false);
	assert.equal(existsSync(join(outside, "absolute.txt")), false);
});

test("Files sandbox keeps a write on the opened directory when its pathname is swapped for an outside symlink", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "aira-files-race-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	const outside = join(root, "outside");
	const markerPath = join(root, "parent-opened");
	mkdirSync(workspace);
	mkdirSync(outside);
	mkdirSync(join(workspace, "race"));

	const source = fileScript();
	const needle = "pfd,name=parent_leaf(sys.argv[2],True)";
	const injected = `${needle};pathlib.Path(${JSON.stringify(markerPath)}).write_text('ready');import time;time.sleep(0.5)`;
	const racedScript = source.replace(needle, injected);
	assert.notEqual(racedScript, source, "race hook must be injected after the parent directory fd is opened");

	const child = spawn(
		"python3",
		["-c", racedScript, "write", "race/result.txt", Buffer.from("secure", "utf8").toString("base64")],
		{ cwd: workspace, stdio: ["ignore", "pipe", "pipe"] },
	);
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => { stderr += chunk; });

	const deadline = Date.now() + 3_000;
	while (!existsSync(markerPath) && Date.now() < deadline && child.exitCode === null) {
		await delay(10);
	}
	assert.equal(existsSync(markerPath), true, `race hook was never reached: ${stderr}`);

	renameSync(join(workspace, "race"), join(workspace, "race-original"));
	symlinkSync(outside, join(workspace, "race"), "dir");

	const exitCode = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	assert.equal(exitCode, 0, stderr);
	assert.equal(existsSync(join(outside, "result.txt")), false, "write escaped through the replacement symlink");
	assert.equal(readFileSync(join(workspace, "race-original", "result.txt"), "utf8"), "secure");
});
