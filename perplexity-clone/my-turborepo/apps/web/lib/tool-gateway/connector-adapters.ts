import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { ToolAdapter, ToolContext } from "./types";
import { ToolGatewayError } from "./types";

export const UNTRUSTED_EXTERNAL_CONTENT = "UNTRUSTED_EXTERNAL_CONTENT" as const;

function enabled(name: string): boolean {
	return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

/** Sanitize untrusted text: strip ASCII control codes, BiDi overrides, and zero-width characters */
export function sanitizeUntrustedText(value: string, maxLength = 50_000): string {
	const bounded = value.length > maxLength ? value.slice(0, maxLength) : value;
	let result = "";
	for (let i = 0; i < bounded.length; i++) {
		const code = bounded.charCodeAt(i);
		// Strip zero-width non-printing chars (8203-8205: \u200B-\u200D, 65279: \uFEFF)
		// and bidirectional override/embedding controls (8234-8238: \u202A-\u202E, 8206: \u200E, 8207: \u200F)
		if (
			(code >= 8203 && code <= 8205) ||
			(code >= 8234 && code <= 8238) ||
			code === 8206 ||
			code === 8207 ||
			code === 65279
		) {
			continue;
		}
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
// Connector Transport Contracts & Deterministic Default Transports
// ---------------------------------------------------------------------------

export interface GmailTransport {
	listMessages(query?: string, maxResults?: number): Promise<unknown[]>;
	getMessage(id: string): Promise<Record<string, unknown> | null>;
	createDraft(draft: { to: string[]; cc?: string[]; subject: string; bodyText: string; bodyHtml?: string }): Promise<{ draftId: string }>;
	sendMessage(message: { to: string[]; cc?: string[]; subject: string; bodyText: string; bodyHtml?: string }): Promise<{ sent: boolean }>;
	deleteMessage(id: string): Promise<{ deleted: boolean }>;
}

export const deterministicGmailTransport: GmailTransport = {
	async listMessages() { return []; },
	async getMessage(id: string) { return { id, snippet: "Deterministic message stub" }; },
	async createDraft() { return { draftId: `draft-${Date.now()}` }; },
	async sendMessage() { return { sent: true }; },
	async deleteMessage() { return { deleted: true }; },
};

export interface SlackTransport {
	listChannels(types?: string, limit?: number): Promise<unknown[]>;
	getChannelHistory(channelId: string, limit?: number): Promise<unknown[]>;
	getThread(channelId: string, threadTs: string): Promise<unknown[]>;
	postMessage(channelId: string, text: string, threadTs?: string): Promise<{ ok: boolean; ts: string }>;
	uploadFile(channels: string[], filename: string, content: string, title?: string): Promise<{ ok: boolean; fileId: string }>;
	deleteMessage(channelId: string, ts: string): Promise<{ ok: boolean; deleted: boolean }>;
}

export const deterministicSlackTransport: SlackTransport = {
	async listChannels() { return []; },
	async getChannelHistory() { return []; },
	async getThread() { return []; },
	async postMessage() { return { ok: true, ts: `${Date.now() / 1000}` }; },
	async uploadFile() { return { ok: true, fileId: `F${Date.now()}` }; },
	async deleteMessage() { return { ok: true, deleted: true }; },
};

export interface GoogleDriveTransport {
	listFiles(query?: string, pageSize?: number): Promise<unknown[]>;
	getFileMetadata(fileId: string): Promise<Record<string, unknown> | null>;
	downloadFile(fileId: string): Promise<{ content: string; mimeType: string }>;
	createFile(name: string, mimeType: string, content: string): Promise<{ fileId: string; created: boolean }>;
	shareFile(fileId: string, role: string, emailAddress: string): Promise<{ shared: boolean }>;
	deleteFile(fileId: string): Promise<{ deleted: boolean }>;
}

export const deterministicGoogleDriveTransport: GoogleDriveTransport = {
	async listFiles() { return []; },
	async getFileMetadata(fileId: string) { return { id: fileId, name: "stub.txt", mimeType: "text/plain" }; },
	async downloadFile() { return { content: "deterministic-file-content", mimeType: "text/plain" }; },
	async createFile() { return { fileId: `drive-${Date.now()}`, created: true }; },
	async shareFile() { return { shared: true }; },
	async deleteFile() { return { deleted: true }; },
};

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

export function createGmailToolAdapter(transport: GmailTransport = deterministicGmailTransport): ToolAdapter {
	return {
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
				const messages = await transport.listMessages(parsed.data.q, parsed.data.maxResults);
				return {
					result: {
						messages,
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
				const message = await transport.getMessage(parsed.data.id);
				return {
					result: {
						id: parsed.data.id,
						message,
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
				const draftRes = await transport.createDraft({
					to: parsed.data.to,
					cc: parsed.data.cc,
					subject: sanitizeUntrustedText(parsed.data.subject, 200),
					bodyText: sanitizeUntrustedText(parsed.data.bodyText, 50_000),
					bodyHtml: parsed.data.bodyHtml,
				});
				return {
					result: {
						draftId: draftRes.draftId,
						to: parsed.data.to,
						subject: sanitizeUntrustedText(parsed.data.subject, 200),
						created: true,
					},
				};
			}

			if (action === "send") {
				const parsed = GmailSendSchema.safeParse(input);
				if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Gmail send input invalid.", status: 400 });
				const sendRes = await transport.sendMessage({
					to: parsed.data.to,
					cc: parsed.data.cc,
					subject: sanitizeUntrustedText(parsed.data.subject, 200),
					bodyText: sanitizeUntrustedText(parsed.data.bodyText, 50_000),
					bodyHtml: parsed.data.bodyHtml,
				});
				return {
					result: {
						sent: sendRes.sent,
						to: parsed.data.to,
						subject: sanitizeUntrustedText(parsed.data.subject, 200),
					},
				};
			}

			if (action === "delete") {
				const parsed = GmailGetSchema.safeParse(input);
				if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Gmail delete message ID invalid.", status: 400 });
				const delRes = await transport.deleteMessage(parsed.data.id);
				return {
					result: {
						deleted: delRes.deleted,
						id: parsed.data.id,
					},
				};
			}

			throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Gmail action ${action} is not supported.`, status: 409 });
		},
	};
}

export const gmailToolAdapter: ToolAdapter = createGmailToolAdapter();

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

export function createSlackToolAdapter(transport: SlackTransport = deterministicSlackTransport): ToolAdapter {
	return {
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
				const channels = await transport.listChannels(parsed.data.types, parsed.data.limit);
				return {
					result: {
						channels,
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
				const messages = await transport.getChannelHistory(parsed.data.channelId, parsed.data.limit);
				return {
					result: {
						messages,
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
				const messages = await transport.getThread(parsed.data.channelId, parsed.data.threadTs);
				return {
					result: {
						messages,
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
				const postRes = await transport.postMessage(parsed.data.channelId, sanitizeUntrustedText(parsed.data.text, 40_000), parsed.data.threadTs);
				return {
					result: {
						posted: postRes.ok,
						channelId: parsed.data.channelId,
						ts: postRes.ts,
					},
				};
			}

			if (action === "upload_file") {
				const parsed = SlackUploadFileSchema.safeParse(input);
				if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Slack upload file input invalid.", status: 400 });
				const safeFilename = sanitizeUntrustedFilename(parsed.data.filename);
				const uploadRes = await transport.uploadFile(parsed.data.channels, safeFilename, parsed.data.content, parsed.data.title);
				return {
					result: {
						fileId: uploadRes.fileId,
						filename: safeFilename,
						uploaded: uploadRes.ok,
					},
				};
			}

			if (action === "delete_message") {
				const parsed = SlackDeleteMessageSchema.safeParse(input);
				if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Slack delete message input invalid.", status: 400 });
				const delRes = await transport.deleteMessage(parsed.data.channelId, parsed.data.ts);
				return {
					result: {
						deleted: delRes.deleted,
						channelId: parsed.data.channelId,
						ts: parsed.data.ts,
					},
				};
			}

			throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Slack action ${action} is not supported.`, status: 409 });
		},
	};
}

export const slackToolAdapter: ToolAdapter = createSlackToolAdapter();

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

export function createGoogleDriveToolAdapter(transport: GoogleDriveTransport = deterministicGoogleDriveTransport): ToolAdapter {
	return {
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
				const files = await transport.listFiles(parsed.data.q, parsed.data.pageSize);
				return {
					result: {
						files,
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

			if (action === "get_file_metadata") {
				const parsed = DriveGetSchema.safeParse(input);
				if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Google Drive file ID invalid.", status: 400 });
				const metadata = await transport.getFileMetadata(parsed.data.fileId);
				return {
					result: {
						fileId: parsed.data.fileId,
						metadata,
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

			if (action === "download_file") {
				const parsed = DriveGetSchema.safeParse(input);
				if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Google Drive download file ID invalid.", status: 400 });
				const downloaded = await transport.downloadFile(parsed.data.fileId);
				return {
					result: {
						fileId: parsed.data.fileId,
						content: downloaded.content,
						mimeType: downloaded.mimeType,
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
				const createRes = await transport.createFile(safeFilename, parsed.data.mimeType, parsed.data.content ?? "");
				return {
					result: {
						fileId: createRes.fileId,
						name: safeFilename,
						mimeType: parsed.data.mimeType,
						created: createRes.created,
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
				const shareRes = await transport.shareFile(parsed.data.fileId, parsed.data.role, parsed.data.emailAddress);
				return {
					result: {
						fileId: parsed.data.fileId,
						sharedWith: parsed.data.emailAddress,
						role: parsed.data.role,
						shared: shareRes.shared,
					},
				};
			}

			if (action === "delete_file") {
				const parsed = DriveGetSchema.safeParse(input);
				if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Google Drive delete file ID invalid.", status: 400 });
				const delRes = await transport.deleteFile(parsed.data.fileId);
				return {
					result: {
						deleted: delRes.deleted,
						fileId: parsed.data.fileId,
					},
				};
			}

			throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Google Drive action ${action} is not supported.`, status: 409 });
		},
	};
}

export const googleDriveToolAdapter: ToolAdapter = createGoogleDriveToolAdapter();
