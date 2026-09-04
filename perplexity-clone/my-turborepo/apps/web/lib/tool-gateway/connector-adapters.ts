import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { ToolAdapter, ToolContext } from "./types";
import { ToolGatewayError } from "./types";

export const UNTRUSTED_EXTERNAL_CONTENT = "UNTRUSTED_EXTERNAL_CONTENT" as const;

function enabled(name: string): boolean {
	return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

/** Sanitize untrusted text: strip ASCII control codes except standard whitespace */
export function sanitizeUntrustedText(value: string, maxLength = 50_000): string {
	const bounded = value.length > maxLength ? value.slice(0, maxLength) : value;
	let result = "";
	for (let i = 0; i < bounded.length; i++) {
		const code = bounded.charCodeAt(i);
		// Allow tab (9), linefeed (10), carriage return (13), and printable characters >= 32 (excluding DEL 127)
		if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
			result += bounded[i];
		}
	}
	return result;
}

/** Sanitize untrusted filename: remove directory traversal and invalid characters */
export function sanitizeUntrustedFilename(value: string): string {
	const normalized = value.replaceAll("\\", "/");
	const basename = normalized.split("/").filter(Boolean).pop() ?? "untitled";
	return basename.replace(/[\0\r\n\t<>:"/\\|?*]/g, "_").trim().slice(0, 255) || "unnamed";
}

// ---------------------------------------------------------------------------
// Gmail Connector Schemas & Adapter
// ---------------------------------------------------------------------------

const GmailListSchema = z.object({
	maxResults: z.number().int().min(1).max(100).default(20),
	pageToken: z.string().max(256).optional(),
	q: z.string().max(1024).optional(),
});

const GmailGetSchema = z.object({
	id: z.string().trim().min(1).max(128),
});

const GmailDraftSchema = z.object({
	to: z.array(z.string().email().max(320)).min(1).max(50),
	cc: z.array(z.string().email().max(320)).max(50).optional(),
	subject: z.string().max(1000).default(""),
	bodyText: z.string().max(100_000).default(""),
	bodyHtml: z.string().max(200_000).optional(),
});

const GmailSendSchema = GmailDraftSchema;

export const gmailToolAdapter: ToolAdapter = {
	id: "gmail",
	async isAvailable() {
		return enabled("AIRA_GMAIL_CONNECTOR_ENABLED") && Boolean(process.env.GMAIL_OAUTH_CLIENT_ID?.trim() && process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim());
	},
	async execute(context: ToolContext, action: string, input: Record<string, unknown>) {
		if (action === "batch_delete" || action === "modify_filters") {
			throw new ToolGatewayError({ code: "TOOL_ACTION_DENIED", message: `Gmail action ${action} is always denied by security policy.`, status: 403 });
		}

		if (action === "list_messages" || action === "search") {
			const parsed = GmailListSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Gmail list input invalid.", status: 400 });
			return {
				result: {
					messages: [],
					trust: UNTRUSTED_EXTERNAL_CONTENT,
					provenance: {
						connector: "gmail",
						action,
						tenantId: context.projectId,
						user: context.userId,
						query: parsed.data.q ? sanitizeUntrustedText(parsed.data.q, 200) : null,
					},
				},
			};
		}

		if (action === "get_message") {
			const parsed = GmailGetSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Gmail message ID invalid.", status: 400 });
			return {
				result: {
					id: parsed.data.id,
					trust: UNTRUSTED_EXTERNAL_CONTENT,
					provenance: {
						connector: "gmail",
						externalId: parsed.data.id,
						tenantId: context.projectId,
						user: context.userId,
					},
				},
			};
		}

		if (action === "draft") {
			const parsed = GmailDraftSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Gmail draft input invalid.", status: 400 });
			return {
				result: {
					draftId: `draft-${Date.now()}`,
					to: parsed.data.to,
					subject: sanitizeUntrustedText(parsed.data.subject, 200),
					created: true,
				},
			};
		}

		if (action === "send") {
			const parsed = GmailSendSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Gmail send input invalid.", status: 400 });
			return {
				result: {
					sent: true,
					to: parsed.data.to,
					subject: sanitizeUntrustedText(parsed.data.subject, 200),
				},
			};
		}

		if (action === "delete") {
			const parsed = GmailGetSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Gmail delete message ID invalid.", status: 400 });
			return {
				result: {
					deleted: true,
					id: parsed.data.id,
				},
			};
		}

		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Gmail action ${action} is not supported.`, status: 409 });
	},
};

// ---------------------------------------------------------------------------
// Slack Connector Schemas & Adapter
// ---------------------------------------------------------------------------

const SlackListChannelsSchema = z.object({
	types: z.string().max(128).default("public_channel,private_channel"),
	limit: z.number().int().min(1).max(200).default(50),
});

const SlackHistorySchema = z.object({
	channelId: z.string().trim().min(1).max(64),
	limit: z.number().int().min(1).max(100).default(20),
});

const SlackThreadSchema = z.object({
	channelId: z.string().trim().min(1).max(64),
	threadTs: z.string().trim().min(1).max(32),
	limit: z.number().int().min(1).max(100).default(20),
});

const SlackPostMessageSchema = z.object({
	channelId: z.string().trim().min(1).max(64),
	text: z.string().trim().min(1).max(40_000),
	threadTs: z.string().trim().max(32).optional(),
});

const SlackUploadFileSchema = z.object({
	channels: z.array(z.string().trim().min(1).max(64)).min(1).max(10),
	filename: z.string().trim().min(1).max(255),
	content: z.string().max(1_000_000),
	title: z.string().max(255).optional(),
});

const SlackDeleteMessageSchema = z.object({
	channelId: z.string().trim().min(1).max(64),
	ts: z.string().trim().min(1).max(32),
});

/** Verify Slack webhook signatures using HMAC-SHA256 and replay resistance */
export function verifySlackSignature(options: {
	readonly signature: string;
	readonly timestamp: string | number;
	readonly body: string;
	readonly signingSecret: string;
	readonly nowSeconds?: number;
}): boolean {
	const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
	const ts = typeof options.timestamp === "number" ? options.timestamp : Number.parseInt(options.timestamp, 10);
	if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
		return false; // Replay attack or clock skew > 5 minutes
	}
	const sigBasestring = `v0:${ts}:${options.body}`;
	const computed = `v0=${createHmac("sha256", options.signingSecret).update(sigBasestring, "utf8").digest("hex")}`;
	if (computed.length !== options.signature.length) return false;
	try {
		return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(options.signature, "utf8"));
	} catch {
		return false;
	}
}

export const slackToolAdapter: ToolAdapter = {
	id: "slack",
	async isAvailable() {
		return enabled("AIRA_SLACK_CONNECTOR_ENABLED") && Boolean(process.env.SLACK_BOT_TOKEN?.trim() && process.env.SLACK_SIGNING_SECRET?.trim());
	},
	async execute(context: ToolContext, action: string, input: Record<string, unknown>) {
		if (action === "admin_manage_workspace") {
			throw new ToolGatewayError({ code: "TOOL_ACTION_DENIED", message: "Slack workspace administration is always denied by security policy.", status: 403 });
		}

		if (action === "list_channels") {
			const parsed = SlackListChannelsSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Slack list channels input invalid.", status: 400 });
			return {
				result: {
					channels: [],
					trust: UNTRUSTED_EXTERNAL_CONTENT,
					provenance: {
						connector: "slack",
						action,
						tenantId: context.projectId,
						user: context.userId,
					},
				},
			};
		}

		if (action === "get_channel_history") {
			const parsed = SlackHistorySchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Slack history input invalid.", status: 400 });
			return {
				result: {
					messages: [],
					channelId: parsed.data.channelId,
					trust: UNTRUSTED_EXTERNAL_CONTENT,
					provenance: {
						connector: "slack",
						channelId: parsed.data.channelId,
						tenantId: context.projectId,
						user: context.userId,
					},
				},
			};
		}

		if (action === "get_thread") {
			const parsed = SlackThreadSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Slack thread input invalid.", status: 400 });
			return {
				result: {
					messages: [],
					channelId: parsed.data.channelId,
					threadTs: parsed.data.threadTs,
					trust: UNTRUSTED_EXTERNAL_CONTENT,
					provenance: {
						connector: "slack",
						channelId: parsed.data.channelId,
						threadTs: parsed.data.threadTs,
						tenantId: context.projectId,
						user: context.userId,
					},
				},
			};
		}

		if (action === "post_message" || action === "post_ephemeral") {
			const parsed = SlackPostMessageSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Slack post message input invalid.", status: 400 });
			return {
				result: {
					posted: true,
					channelId: parsed.data.channelId,
					ts: `${Date.now()}.000100`,
				},
			};
		}

		if (action === "upload_file") {
			const parsed = SlackUploadFileSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Slack upload file input invalid.", status: 400 });
			const safeFilename = sanitizeUntrustedFilename(parsed.data.filename);
			return {
				result: {
					fileId: `F${Date.now()}`,
					filename: safeFilename,
					uploaded: true,
				},
			};
		}

		if (action === "delete_message") {
			const parsed = SlackDeleteMessageSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Slack delete message input invalid.", status: 400 });
			return {
				result: {
					deleted: true,
					channelId: parsed.data.channelId,
					ts: parsed.data.ts,
				},
			};
		}

		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Slack action ${action} is not supported.`, status: 409 });
	},
};

// ---------------------------------------------------------------------------
// Google Drive Connector Schemas & Adapter
// ---------------------------------------------------------------------------

const DriveListSchema = z.object({
	pageSize: z.number().int().min(1).max(100).default(20),
	pageToken: z.string().max(256).optional(),
	q: z.string().max(1024).optional(),
	spaces: z.string().max(128).default("drive"),
});

const DriveGetSchema = z.object({
	fileId: z.string().trim().min(1).max(128),
	fields: z.string().max(256).optional(),
});

const DriveCreateSchema = z.object({
	name: z.string().trim().min(1).max(255),
	mimeType: z.string().trim().max(128).default("text/plain"),
	content: z.string().max(5_000_000).optional(),
	parentId: z.string().trim().max(128).optional(),
});

const DriveUpdateSchema = z.object({
	fileId: z.string().trim().min(1).max(128),
	name: z.string().trim().max(255).optional(),
	content: z.string().max(5_000_000).optional(),
});

const DriveShareSchema = z.object({
	fileId: z.string().trim().min(1).max(128),
	role: z.enum(["reader", "commenter", "writer"]),
	emailAddress: z.string().email().max(320),
});

export const googleDriveToolAdapter: ToolAdapter = {
	id: "google_drive",
	async isAvailable() {
		return enabled("AIRA_GOOGLE_DRIVE_CONNECTOR_ENABLED") && Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() && process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim());
	},
	async execute(context: ToolContext, action: string, input: Record<string, unknown>) {
		if (action === "modify_permissions_public" || action === "delete_shared_drive") {
			throw new ToolGatewayError({ code: "TOOL_ACTION_DENIED", message: `Google Drive action ${action} is always denied by security policy.`, status: 403 });
		}

		if (action === "list_files" || action === "search") {
			const parsed = DriveListSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Google Drive list input invalid.", status: 400 });
			return {
				result: {
					files: [],
					trust: UNTRUSTED_EXTERNAL_CONTENT,
					provenance: {
						connector: "google_drive",
						action,
						tenantId: context.projectId,
						user: context.userId,
						query: parsed.data.q ? sanitizeUntrustedText(parsed.data.q, 200) : null,
					},
				},
			};
		}

		if (action === "get_file_metadata" || action === "download_file") {
			const parsed = DriveGetSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Google Drive file ID invalid.", status: 400 });
			return {
				result: {
					fileId: parsed.data.fileId,
					trust: UNTRUSTED_EXTERNAL_CONTENT,
					provenance: {
						connector: "google_drive",
						externalId: parsed.data.fileId,
						tenantId: context.projectId,
						user: context.userId,
					},
				},
			};
		}

		if (action === "create_file") {
			const parsed = DriveCreateSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Google Drive create input invalid.", status: 400 });
			const safeFilename = sanitizeUntrustedFilename(parsed.data.name);
			return {
				result: {
					fileId: `drive-${Date.now()}`,
					name: safeFilename,
					mimeType: parsed.data.mimeType,
					created: true,
				},
			};
		}

		if (action === "update_file") {
			const parsed = DriveUpdateSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Google Drive update input invalid.", status: 400 });
			return {
				result: {
					fileId: parsed.data.fileId,
					updated: true,
				},
			};
		}

		if (action === "share_file") {
			const parsed = DriveShareSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Google Drive share input invalid.", status: 400 });
			return {
				result: {
					fileId: parsed.data.fileId,
					sharedWith: parsed.data.emailAddress,
					role: parsed.data.role,
				},
			};
		}

		if (action === "delete_file") {
			const parsed = DriveGetSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Google Drive delete file ID invalid.", status: 400 });
			return {
				result: {
					deleted: true,
					fileId: parsed.data.fileId,
				},
			};
		}

		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Google Drive action ${action} is not supported.`, status: 409 });
	},
};
