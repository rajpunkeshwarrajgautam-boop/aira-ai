import type { RiskClass } from "@/lib/agent-platform/types";

import type { AiraToolId } from "./types";

const RISK_ORDER: Record<RiskClass, number> = {
	LOW: 0,
	MEDIUM: 1,
	HIGH: 2,
	PROTECTED: 3,
};

const POLICY: Partial<Record<AiraToolId, Record<string, RiskClass>>> = {
	browser: {
		inspect: "LOW",
		screenshot: "LOW",
		navigate: "LOW",
		scroll: "LOW",
		wait: "LOW",
		hover: "LOW",
		click: "MEDIUM",
		double_click: "MEDIUM",
		click_at: "MEDIUM",
		fill: "MEDIUM",
		press: "MEDIUM",
		select: "MEDIUM",
		upload: "HIGH",
		download: "HIGH",
		submit: "HIGH",
	},
	terminal: {
		status: "LOW",
		// exec_readonly currently shares the generic argv executor. Until a
		// separately enforced read-only sandbox exists it must not receive a
		// lower risk classification than exec.
		exec_readonly: "MEDIUM",
		exec: "MEDIUM",
		install: "HIGH",
	},
	git: {
		status: "LOW",
		diff: "LOW",
		log: "LOW",
		create_worktree: "MEDIUM",
		cleanup_worktree: "MEDIUM",
		commit: "MEDIUM",
		merge_local: "MEDIUM",
		push: "HIGH",
		create_pr: "HIGH",
		merge_remote: "PROTECTED",
		force_push: "PROTECTED",
	},
	files: {
		read: "LOW",
		search: "LOW",
		write: "MEDIUM",
		move: "MEDIUM",
		delete: "HIGH",
	},
	memory: {
		read: "LOW",
		search: "LOW",
		write: "MEDIUM",
		delete: "HIGH",
	},
	web: {
		search: "LOW",
		retrieve: "LOW",
		open: "LOW",
	},
	github: {
		read: "LOW",
		create_branch: "MEDIUM",
		create_commit: "HIGH",
		create_pr: "HIGH",
		comment: "HIGH",
		merge: "PROTECTED",
		force_push: "PROTECTED",
		delete_branch: "HIGH",
		modify_branch_protection: "PROTECTED",
	},
	vercel: {
		read: "LOW",
		preview_deploy: "HIGH",
		promote_production: "PROTECTED",
		update_env: "PROTECTED",
		delete_deployment: "PROTECTED",
		change_domain: "PROTECTED",
	},
	supabase: {
		read: "LOW",
		inspect_schema: "LOW",
		read_migrations: "LOW",
		query_readonly: "LOW",
		write_non_destructive: "HIGH",
		apply_migration: "PROTECTED",
		destructive_sql: "PROTECTED",
		drop_project: "PROTECTED",
	},
	mcp: {
		call: "HIGH",
	},
	gmail: {
		list_messages: "LOW",
		get_message: "LOW",
		search: "LOW",
		draft: "MEDIUM",
		send: "HIGH",
		delete: "HIGH",
		batch_delete: "PROTECTED",
		modify_filters: "PROTECTED",
	},
	slack: {
		list_channels: "LOW",
		get_channel_history: "LOW",
		get_thread: "LOW",
		search: "LOW",
		post_ephemeral: "MEDIUM",
		post_message: "HIGH",
		upload_file: "HIGH",
		delete_message: "HIGH",
		admin_manage_workspace: "PROTECTED",
	},
	google_drive: {
		list_files: "LOW",
		get_file_metadata: "LOW",
		download_file: "LOW",
		search: "LOW",
		create_file: "HIGH",
		update_file: "HIGH",
		share_file: "HIGH",
		delete_file: "HIGH",
		modify_permissions_public: "PROTECTED",
		delete_shared_drive: "PROTECTED",
	},
};

// Protected actions are deliberately denied at the central authorization
// boundary even when today's adapter does not expose them. This prevents a
// future adapter expansion from turning production/destructive capabilities
// executable merely because an approval was supplied.
const ALWAYS_DENIED = new Set([
	"git.merge_remote",
	"git.force_push",
	"github.force_push",
	"github.merge",
	"github.modify_branch_protection",
	"vercel.promote_production",
	"vercel.update_env",
	"vercel.delete_deployment",
	"vercel.change_domain",
	"vercel.change_billing",
	"vercel.change_account_security",
	"supabase.apply_migration",
	"supabase.destructive_sql",
	"supabase.drop_project",
	"browser.change_mfa",
	"gmail.batch_delete",
	"gmail.modify_filters",
	"slack.admin_manage_workspace",
	"google_drive.modify_permissions_public",
	"google_drive.delete_shared_drive",
]);

export function classifyToolRisk(tool: AiraToolId, action: string): RiskClass {
	return POLICY[tool]?.[action] ?? "HIGH";
}

export function isAlwaysDeniedToolAction(tool: AiraToolId, action: string): boolean {
	return ALWAYS_DENIED.has(`${tool}.${action}`);
}

export function requiresApproval(risk: RiskClass): boolean {
	return RISK_ORDER[risk] >= RISK_ORDER.HIGH;
}

export function isProtected(risk: RiskClass): boolean {
	return risk === "PROTECTED";
}
