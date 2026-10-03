import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const buildDirectory = "perplexity-clone/my-turborepo/apps/web/.next";
const buildOnlyDependency = /node_modules\/(?:\.pnpm\/)?(?:braces|tailwindcss|autoprefixer|@tailwindcss[+/]typography)(?:@|\/)/;

// Inspect the files Next.js actually ships, including the production server.
// A missing build is a failure, rather than an empty successful inspection.
await readFile(join(buildDirectory, "next-server.js.nft.json"), "utf8");
let traces = 0;
const violations = [];

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "cache") {
      await inspect(path);
    } else if (entry.isFile() && entry.name.endsWith(".nft.json")) {
      const trace = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(trace.files)) throw new Error(`Invalid trace: ${path}`);
      traces += 1;
      for (const file of trace.files) {
        if (buildOnlyDependency.test(file.replaceAll("\\", "/"))) {
          violations.push(`${path}: ${file}`);
        }
      }
    }
  }
}

await inspect(buildDirectory);
if (traces < 2) throw new Error("Expected production server and route traces.");
if (violations.length) {
  throw new Error(`Build-only dependency in production output:\n${violations.join("\n")}`);
}
console.log(`Verified ${traces} production traces: CSS build tools and braces are excluded.`);
