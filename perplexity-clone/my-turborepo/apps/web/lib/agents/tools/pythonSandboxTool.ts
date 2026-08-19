import { z } from "zod";

import type { AgentTool } from "./tool-registry";

const InputSchema = z.object({
	code: z.string().min(1).max(20_000),
});

type Input = z.infer<typeof InputSchema>;

interface SandboxResult {
	readonly ok: boolean;
	readonly exitCode?: number;
	readonly stdout?: string;
	readonly stderr?: string;
	readonly durationMs?: number;
	readonly truncated?: boolean;
	readonly error?: string;
}

export const pythonSandboxTool: AgentTool<Input, SandboxResult> = {
	name: "python_sandbox",
	description: "Execute bounded Python code in AIRA's isolated external sandbox. No application secrets or network access are provided to the sandbox.",
	category: "execution",
	requiresAuth: true,
	requiresPermission: true,
	inputSchema: InputSchema,
	async execute(input) {
		if (process.env.PYTHON_SANDBOX_ENABLED !== "true") {
			throw new Error("Python sandbox is disabled.");
		}
		const baseUrl = process.env.AIRA_SANDBOX_URL?.trim().replace(/\/$/, "");
		const token = process.env.AIRA_SANDBOX_TOKEN?.trim();
		if (!baseUrl || !token) throw new Error("Python sandbox is not configured.");
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 12_000);
		try {
			const response = await fetch(`${baseUrl}/v1/execute`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-AIRA-Sandbox-Token": token,
				},
				body: JSON.stringify({ language: "python", code: input.code }),
				signal: controller.signal,
				cache: "no-store",
			});
			const payload = (await response.json()) as SandboxResult;
			if (!response.ok) throw new Error(payload.error || `Sandbox returned HTTP ${response.status}.`);
			return payload;
		} finally {
			clearTimeout(timer);
		}
	},
};
