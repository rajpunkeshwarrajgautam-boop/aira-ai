type CommandActionPayload =
	| { readonly mode: "deep"; readonly query: string }
	| { readonly action: "create_share"; readonly conversationId: string };

export type CommandResult =
	| { readonly type: "redirect"; readonly payload: string; readonly message?: string }
	| { readonly type: "system_message"; readonly payload: null; readonly message?: string }
	| { readonly type: "action"; readonly payload: CommandActionPayload; readonly message?: string }
	| { readonly type: "error"; readonly payload: null; readonly message?: string };

export interface CommandContext {
	readonly conversationId?: string;
}

export interface AgentCommand {
	name: string;
	description: string;
	aliases?: string[];
	category?: "navigation" | "action" | "mission" | "utility";
	version?: number;
	permissions?: readonly string[];
	tags?: readonly string[];
	execute: (
		args: string[],
		context?: CommandContext,
	) => Promise<CommandResult> | CommandResult;
}

export class CommandRegistry {
	private commands = new Map<string, AgentCommand>();

	registerCommand(command: AgentCommand) {
		this.commands.set(command.name, command);
		if (command.aliases) {
			for (const alias of command.aliases) {
				this.commands.set(alias, command);
			}
		}
	}

	getCommand(name: string): AgentCommand | undefined {
		return this.commands.get(name);
	}

	getAllCommands(): AgentCommand[] {
		const uniqueCommands = new Set(this.commands.values());
		return Array.from(uniqueCommands);
	}

	getCommandsByCategory(category: "navigation" | "action" | "mission" | "utility"): AgentCommand[] {
		return this.getAllCommands().filter((c) => c.category === category);
	}

	isCommand(input: string): boolean {
		return input.trim().startsWith("/");
	}

	async parseAndExecute(
		input: string,
		context?: CommandContext,
	): Promise<CommandResult | null> {
		const trimmed = input.trim();
		if (!trimmed.startsWith("/")) {
			return null;
		}

		const parts = trimmed.split(/\s+/);
		const commandName = parts[0]?.toLowerCase() || "";
		const args = parts.slice(1);

		const command = this.getCommand(commandName);
		if (!command) {
			return {
				type: "error",
				payload: null,
				message: `Command ${commandName} not found. Try /research <query>, /plan <objective>, /agent <objective>, /work <objective>, /new, /history, or /share.`,
			};
		}

		try {
			return await command.execute(args, context);
		} catch (error) {
			console.error(`Error executing command ${commandName}:`, error);
			return {
				type: "error",
				payload: null,
				message: `Failed to execute command ${commandName}.`,
			};
		}
	}
}

export const globalCommandRegistry = new CommandRegistry();

globalCommandRegistry.registerCommand({
	name: "/new",
	description: "Start a new conversation",
	category: "navigation",
	version: 1,
	execute: () => {
		return { type: "redirect", payload: "/", message: "Starting new conversation..." };
	},
});

globalCommandRegistry.registerCommand({
	name: "/history",
	description: "Open searchable conversation and memory history",
	aliases: ["/h"],
	category: "navigation",
	version: 1,
	execute: () => {
		return {
			type: "redirect",
			payload: "/workspace-search",
			message: "Opening workspace history.",
		};
	},
});

globalCommandRegistry.registerCommand({
	name: "/research",
	description: "Run Deep Research for a query using AIRA's real research pipeline",
	aliases: ["/r"],
	category: "action",
	version: 1,
	execute: (args) => {
		const query = args.join(" ").trim();
		if (!query) {
			return { type: "error", payload: null, message: "Please provide a query after /research" };
		}
		return {
			type: "action",
			payload: { mode: "deep", query },
			message: `Starting Deep Research for: ${query}`,
		};
	},
});

globalCommandRegistry.registerCommand({
	name: "/deep",
	description: "Force Deep Research mode for the current query",
	category: "action",
	version: 1,
	execute: (args) => {
		const query = args.join(" ");
		if (!query) {
			return { type: "error", payload: null, message: "Please provide a query after /deep" };
		}
		return {
			type: "action",
			payload: { mode: "deep", query },
			message: `Starting deep research for: ${query}`,
		};
	},
});


globalCommandRegistry.registerCommand({
	name: "/share",
	description: "Share the current conversation",
	category: "action",
	version: 1,
	execute: (_args, context) => {
		if (!context?.conversationId) {
			return { type: "error", payload: null, message: "No active conversation to share." };
		}
		return {
			type: "action",
			payload: { action: "create_share", conversationId: context.conversationId },
			message: "Preparing share action...",
		};
	},
});

globalCommandRegistry.registerCommand({
	name: "/build",
	description: "Open autonomous mission control & builder",
	category: "mission",
	version: 1,
	execute: () => {
		return {
			type: "redirect",
			payload: "/build",
			message: "Opening mission control...",
		};
	},
});

globalCommandRegistry.registerCommand({
	name: "/plan",
	description: "Create a real server-side AIRA Work plan and review it before execution",
	category: "mission",
	version: 1,
	execute: (args) => {
		const objective = args.join(" ").trim();
		if (!objective) {
			return { type: "error", payload: null, message: "Please provide an objective after /plan" };
		}
		return {
			type: "redirect",
			payload: `/work?objective=${encodeURIComponent(objective)}&intent=plan`,
			message: "Generating a managed Work plan...",
		};
	},
});

globalCommandRegistry.registerCommand({
	name: "/agent",
	description: "Prepare an autonomous AIRA Work mission for explicit review and launch",
	category: "mission",
	version: 1,
	execute: (args) => {
		const objective = args.join(" ").trim();
		if (!objective) {
			return { type: "error", payload: null, message: "Please provide an objective after /agent" };
		}
		return {
			type: "redirect",
			payload: `/work?objective=${encodeURIComponent(objective)}&intent=agent`,
			message: "Preparing the autonomous mission for review...",
		};
	},
});

globalCommandRegistry.registerCommand({
	name: "/work",
	description: "Open AIRA Work Mode or prepare a managed mission objective",
	category: "mission",
	version: 2,
	execute: (args) => {
		const objective = args.join(" ").trim();
		return {
			type: "redirect",
			payload: objective ? `/work?objective=${encodeURIComponent(objective)}` : "/work",
			message: "Opening Work Mode...",
		};
	},
});

