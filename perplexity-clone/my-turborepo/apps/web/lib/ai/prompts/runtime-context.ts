import type { AiraPromptRuntimeContext } from "./types";

const FORBIDDEN_SECRET_KEYS = [
	"password",
	"secret",
	"apikey",
	"api_key",
	"token",
	"database_url",
	"service_role",
	"private_key",
	"bearer",
	"credential",
];

/**
 * Sanitizes and formats safe runtime metadata for trusted prompt inclusion.
 * STRICT SECURITY INVARIANT:
 * Strips any accidentally passed keys or values containing secret patterns.
 */
export function formatSafeRuntimeContext(ctx: Partial<AiraPromptRuntimeContext>): string {
	const lines: string[] = ["## Runtime Environment"];

	if (ctx.currentDate) {
		lines.push(`- Current date: ${ctx.currentDate}`);
	} else {
		lines.push(`- Current date (UTC): ${new Date().toISOString().split("T")[0]}`);
	}

	if (ctx.timezone) {
		lines.push(`- User timezone: ${ctx.timezone}`);
	}
	if (ctx.locale) {
		lines.push(`- User locale: ${ctx.locale}`);
	}

	lines.push(`- Authentication status: ${ctx.authenticated ? "authenticated" : "guest"}`);

	if (ctx.userPlan) {
		lines.push(`- Tier: ${ctx.userPlan}`);
	}

	if (ctx.selectedModel) {
		lines.push(`- Active model: ${ctx.selectedModel}`);
	}
	if (ctx.routingPreset) {
		lines.push(`- Routing preset: ${ctx.routingPreset}`);
	}

	if (ctx.authorizedTools && ctx.authorizedTools.length > 0) {
		// Clean and filter tool names
		const safeTools = ctx.authorizedTools.filter((t) => typeof t === "string" && /^[a-zA-Z0-9_-]+$/.test(t));
		lines.push(`- Authorized tools: [${safeTools.join(", ")}]`);
	}

	if (ctx.runId && ctx.taskId) {
		lines.push(`- Mission context: Run ${ctx.runId}, Task ${ctx.taskId}`);
	}

	return lines.join("\n");
}

/**
 * Validates that an arbitrary runtime context object contains zero secret material.
 */
export function assertNoSecretMaterial(obj: unknown, path = ""): void {
	if (!obj || typeof obj !== "object") return;

	for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
		const lowerKey = key.toLowerCase();
		if (FORBIDDEN_SECRET_KEYS.some((f) => lowerKey.includes(f))) {
			throw new Error(`SECURITY VIOLATION: Secret field '${path ? `${path}.${key}` : key}' detected in prompt runtime context.`);
		}
		if (typeof val === "string" && (val.startsWith("sk-") || val.startsWith("eyJ") || val.length > 256)) {
			// Suspicious token/secret pattern
			if (val.startsWith("sk-") || val.startsWith("eyJ")) {
				throw new Error(`SECURITY VIOLATION: Suspicious credential token detected in prompt context field '${key}'.`);
			}
		}
		if (val && typeof val === "object") {
			assertNoSecretMaterial(val, path ? `${path}.${key}` : key);
		}
	}
}
