/**
 * Dependency-free ESM resolution hooks for `node --test`.
 *
 * The application is authored with TypeScript's module resolution: extensionless
 * relative imports (`./client`) and the `@/*` / `@services/*` path aliases declared
 * in tsconfig.json. Node's ESM resolver understands neither. Registering these hooks
 * lets the built-in test runner load the real source modules under Node 22's native
 * type stripping, so tests exercise shipped code without adding a build step or a
 * third-party test toolchain to the production dependency surface.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function firstExisting(basePath) {
	if (existsSync(basePath) && !existsSync(path.join(basePath, "package.json"))) {
		if (path.extname(basePath)) return basePath;
	}
	for (const extension of EXTENSIONS) {
		const candidate = `${basePath}${extension}`;
		if (existsSync(candidate)) return candidate;
	}
	for (const extension of EXTENSIONS) {
		const candidate = path.join(basePath, `index${extension}`);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function aliasBase(specifier) {
	if (specifier.startsWith("@services/")) {
		return path.join(APP_ROOT, "src", "services", specifier.slice("@services/".length));
	}
	if (specifier.startsWith("@/")) {
		return path.join(APP_ROOT, specifier.slice("@/".length));
	}
	return null;
}

registerHooks({
	resolve(specifier, context, nextResolve) {
		const alias = aliasBase(specifier);
		if (alias) {
			const resolved = firstExisting(alias);
			if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
		}

		if (specifier.startsWith("./") || specifier.startsWith("../")) {
			const parentPath = context.parentURL?.startsWith("file:")
				? path.dirname(fileURLToPath(context.parentURL))
				: null;
			if (parentPath && !path.extname(specifier)) {
				const resolved = firstExisting(path.resolve(parentPath, specifier));
				if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
			}
		}

		return nextResolve(specifier, context);
	},
});
