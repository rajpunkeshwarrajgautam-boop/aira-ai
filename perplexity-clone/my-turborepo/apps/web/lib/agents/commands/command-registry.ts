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
				message: `Command ${commandName} not found. Try /new, /history, /deep <query>, or /share.`,
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
	execute: () => {
		return { type: "redirect", payload: "/", message: "Starting new conversation..." };
	},
});

globalCommandRegistry.registerCommand({
	name: "/history",
	description: "Open searchable conversation and memory history",
	aliases: ["/h"],
	execute: () => {
		return {
			type: "redirect",
			payload: "/workspace-search",
			message: "Opening workspace history.",
		};
	},
});

globalCommandRegistry.registerCommand({
	name: "/deep",
	description: "Force Deep Research mode for the current query",
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
