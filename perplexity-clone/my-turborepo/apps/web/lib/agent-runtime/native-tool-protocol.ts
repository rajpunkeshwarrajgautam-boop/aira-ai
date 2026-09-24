import type OpenAI from "openai";
import type { AiraToolId } from "@/lib/tool-gateway/types";

export interface ParsedNativeToolCall {
	readonly toolCallId: string;
	readonly tool: AiraToolId;
	readonly action: string;
	readonly input: Record<string, unknown>;
	readonly parseError?: string;
}

export function isNativeToolCallingEnabled(): boolean {
	return process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED === "true";
}

/**
 * Known schema definitions for native provider tool calling.
 * Mapped to Aira's existing ToolGateway adapters.
 */
export const NATIVE_TOOL_DEFINITIONS: Record<string, OpenAI.ChatCompletionTool> = {
	web_search: {
		type: "function",
		function: {
			name: "web_search",
			description: "Search the web for up-to-date information, documentation, and external facts.",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "The search query to execute.",
					},
					numResults: {
						type: "number",
						description: "Number of search results to return (1-10). Default is 6.",
					},
				},
				required: ["query"],
			},
		},
	},
	web_open: {
		type: "function",
		function: {
			name: "web_open",
			description: "Fetch and extract readable text content from an authorized public URL.",
			parameters: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "The public HTTP/HTTPS URL to fetch.",
					},
				},
				required: ["url"],
			},
		},
	},
	files_read: {
		type: "function",
		function: {
			name: "files_read",
			description: "Read the text contents of a file within an authorized workspace.",
			parameters: {
				type: "object",
				properties: {
					workspaceId: {
						type: "string",
						description: "The workspace ID containing the target file.",
					},
					path: {
						type: "string",
						description: "The relative path to the file to read.",
					},
				},
				required: ["workspaceId", "path"],
			},
		},
	},
	files_write: {
		type: "function",
		function: {
			name: "files_write",
			description: "Write or update text content in a file within an authorized workspace.",
			parameters: {
				type: "object",
				properties: {
					workspaceId: {
						type: "string",
						description: "The workspace ID containing the target file.",
					},
					path: {
						type: "string",
						description: "The relative path to the file to write.",
					},
					content: {
						type: "string",
						description: "The UTF-8 text content to write.",
					},
				},
				required: ["workspaceId", "path", "content"],
			},
		},
	},
	files_list: {
		type: "function",
		function: {
			name: "files_list",
			description: "List files and directories in a workspace directory.",
			parameters: {
				type: "object",
				properties: {
					workspaceId: {
						type: "string",
						description: "The workspace ID.",
					},
					path: {
						type: "string",
						description: "The relative directory path to list. Default is root.",
					},
				},
				required: ["workspaceId"],
			},
		},
	},
	files_search: {
		type: "function",
		function: {
			name: "files_search",
			description: "Search file names and paths in a workspace.",
			parameters: {
				type: "object",
				properties: {
					workspaceId: {
						type: "string",
						description: "The workspace ID.",
					},
					query: {
						type: "string",
						description: "Search term to match against file paths.",
					},
				},
				required: ["workspaceId", "query"],
			},
		},
	},
	memory_remember: {
		type: "function",
		function: {
			name: "memory_remember",
			description: "Persist an important fact, architectural decision, or constraint into project memory.",
			parameters: {
				type: "object",
				properties: {
					memoryKey: {
						type: "string",
						description: "Unique identifier for this memory item.",
					},
					content: {
						type: "string",
						description: "The factual content or decision to persist.",
					},
					kind: {
						type: "string",
						enum: ["GOAL", "ARCHITECTURE", "TECH_STACK", "CONSTRAINT", "ARTIFACT", "DECISION", "OTHER"],
						description: "Category of the memory.",
					},
				},
				required: ["memoryKey", "content"],
			},
		},
	},
	memory_search: {
		type: "function",
		function: {
			name: "memory_search",
			description: "Search stored project memories and prior decisions.",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "The semantic search query for memory lookup.",
					},
				},
				required: ["query"],
			},
		},
	},
	browser_open: {
		type: "function",
		function: {
			name: "browser_open",
			description: "Navigate an isolated browser session to an authorized public URL.",
			parameters: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "Target URL to navigate to.",
					},
					sessionId: {
						type: "string",
						description: "Optional existing browser session ID.",
					},
				},
				required: ["url"],
			},
		},
	},
	browser_screenshot: {
		type: "function",
		function: {
			name: "browser_screenshot",
			description: "Capture a visual screenshot of the current page in an active browser session.",
			parameters: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "Active browser session ID.",
					},
				},
				required: ["sessionId"],
			},
		},
	},
	terminal_run: {
		type: "function",
		function: {
			name: "terminal_run",
			description: "Run an approved command in an isolated workspace terminal runner.",
			parameters: {
				type: "object",
				properties: {
					workspaceId: {
						type: "string",
						description: "Target workspace ID.",
					},
					argv: {
						type: "array",
						items: { type: "string" },
						description: "Command and arguments array (e.g. ['npm', 'test']).",
					},
				},
				required: ["workspaceId", "argv"],
			},
		},
	},
	git_status: {
		type: "function",
		function: {
			name: "git_status",
			description: "Inspect the git status and pending changes in a workspace worktree.",
			parameters: {
				type: "object",
				properties: {
					workspaceId: {
						type: "string",
						description: "Target workspace ID.",
					},
				},
				required: ["workspaceId"],
			},
		},
	},
	git_commit: {
		type: "function",
		function: {
			name: "git_commit",
			description: "Create a signed git commit in a scoped workspace worktree.",
			parameters: {
				type: "object",
				properties: {
					workspaceId: {
						type: "string",
						description: "Target workspace ID.",
					},
					message: {
						type: "string",
						description: "Descriptive commit message.",
					},
				},
				required: ["workspaceId", "message"],
			},
		},
	},
};

/**
 * Converts a list of allowed tool family names (e.g. ["web", "files", "memory"])
 * into concrete OpenAI-compatible function calling schemas.
 */
export function toOpenAIToolDefinitions(
	allowedTools: readonly string[],
): OpenAI.ChatCompletionTool[] {
	const result: OpenAI.ChatCompletionTool[] = [];
	const allowedSet = new Set(allowedTools);

	for (const [key, definition] of Object.entries(NATIVE_TOOL_DEFINITIONS)) {
		const toolPrefix = key.split("_")[0];
		if ((toolPrefix && allowedSet.has(toolPrefix)) || allowedSet.has(key)) {
			result.push(definition);
		}
	}

	return result;
}

/**
 * Parses a native model tool call into a structured ToolGateway request.
 */
export function parseNativeToolCall(toolCall: {
	readonly id: string;
	readonly function: {
		readonly name: string;
		readonly arguments: string;
	};
}): ParsedNativeToolCall {
	const rawName = toolCall.function.name.trim();
	const underscoreIdx = rawName.indexOf("_");

	if (underscoreIdx <= 0 || underscoreIdx >= rawName.length - 1) {
		return {
			toolCallId: toolCall.id,
			tool: "files" as AiraToolId,
			action: "unknown",
			input: {},
			parseError: `Invalid tool function name format: "${rawName}". Expected "<tool>_<action>".`,
		};
	}

	const tool = rawName.slice(0, underscoreIdx) as AiraToolId;
	const action = rawName.slice(underscoreIdx + 1);

	let input: Record<string, unknown> = {};
	try {
		const rawArgs = toolCall.function.arguments?.trim();
		if (rawArgs) {
			const parsed = JSON.parse(rawArgs);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				input = parsed as Record<string, unknown>;
			} else {
				return {
					toolCallId: toolCall.id,
					tool,
					action,
					input: {},
					parseError: "Tool arguments must be a JSON object.",
				};
			}
		}
	} catch (err) {
		return {
			toolCallId: toolCall.id,
			tool,
			action,
			input: {},
			parseError: `Malformed JSON in tool arguments: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	return {
		toolCallId: toolCall.id,
		tool,
		action,
		input,
	};
}

/**
 * Formats a ToolGateway execution outcome into a valid OpenAI tool message response.
 */
export function formatToolResultMessage(
	toolCallId: string,
	result: unknown,
): OpenAI.ChatCompletionToolMessageParam {
	return {
		role: "tool",
		tool_call_id: toolCallId,
		content: typeof result === "string" ? result : JSON.stringify(result),
	};
}
