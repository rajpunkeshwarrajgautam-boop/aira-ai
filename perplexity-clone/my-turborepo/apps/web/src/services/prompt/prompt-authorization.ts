/**
 * Pure ownership and lifecycle policy for prompt resources.
 *
 * Kept free of Prisma and Next so the rules can be unit tested directly. Every
 * API route runs the relevant decision here *after* resolving the session, and
 * every database read is additionally scoped by `userId` — this module is the
 * statement of intent, the query scoping is the enforcement.
 */

export type PromptAction =
	| "view"
	| "edit"
	| "publish"
	| "archive"
	| "delete"
	| "run"
	| "assign"
	| "evaluate";

export type PromptStatusValue = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type PromptVisibilityValue = "PRIVATE" | "WORKSPACE";

export interface PromptResourceRef {
	readonly ownerUserId: string;
	readonly status: PromptStatusValue;
	readonly visibility: PromptVisibilityValue;
}

export interface PromptRequester {
	/** Null for an unauthenticated request. */
	readonly userId: string | null;
}

export type PromptAuthorizationDecision =
	| { readonly allowed: true }
	| {
			readonly allowed: false;
			readonly code: "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE";
			readonly status: 401 | 403 | 404 | 409;
			readonly message: string;
		};

const DENY_UNAUTHENTICATED = {
	allowed: false,
	code: "UNAUTHENTICATED",
	status: 401,
	message: "Sign in required.",
} as const;

/**
 * Cross-user access is reported as 404, not 403: a caller must not be able to
 * probe another user's prompt ids by watching the status code change.
 */
const DENY_NOT_FOUND = {
	allowed: false,
	code: "NOT_FOUND",
	status: 404,
	message: "Prompt not found.",
} as const;

export function authorizePromptAction(
	requester: PromptRequester,
	resource: PromptResourceRef,
	action: PromptAction,
): PromptAuthorizationDecision {
	if (!requester.userId) return DENY_UNAUTHENTICATED;

	const isOwner = requester.userId === resource.ownerUserId;
	if (!isOwner) {
		// WORKSPACE visibility is a read-only share within the owner's workspace.
		// Every mutating or executing action stays with the owner.
		if (action === "view" && resource.visibility === "WORKSPACE") {
			return { allowed: true };
		}
		return DENY_NOT_FOUND;
	}

	if (resource.status === "ARCHIVED" && (action === "publish" || action === "run")) {
		return {
			allowed: false,
			code: "INVALID_STATE",
			status: 409,
			message: "Restore this prompt from the archive before publishing or running it.",
		};
	}

	return { allowed: true };
}

/** A prompt may only execute in a runtime surface from a published version. */
export function canExecutePromptVersion(input: {
	readonly status: PromptStatusValue;
	readonly publishedVersionId: string | null;
	readonly requestedVersionId: string;
}): PromptAuthorizationDecision {
	if (input.status !== "PUBLISHED" || !input.publishedVersionId) {
		return {
			allowed: false,
			code: "INVALID_STATE",
			status: 409,
			message: "Publish a version before using this prompt in chat, agents or evaluations.",
		};
	}
	if (input.publishedVersionId !== input.requestedVersionId) {
		return {
			allowed: false,
			code: "INVALID_STATE",
			status: 409,
			message: "Only the published version of a prompt can run in a runtime surface.",
		};
	}
	return { allowed: true };
}

/**
 * Version history is immutable. The only legal writes are creating a new
 * version and moving the published pointer.
 */
export function assertVersionMutationAllowed(operation: string): void {
	const allowed = new Set(["create", "publish", "unpublish"]);
	if (!allowed.has(operation)) {
		throw new Error(
			`Prompt versions are immutable; "${operation}" is not a permitted version operation. Create a new version instead.`,
		);
	}
}

/** Draft playground runs are allowed; every other surface requires publication. */
export function canTestPromptVersion(
	requester: PromptRequester,
	resource: PromptResourceRef,
): PromptAuthorizationDecision {
	if (!requester.userId) return DENY_UNAUTHENTICATED;
	if (requester.userId !== resource.ownerUserId) return DENY_NOT_FOUND;
	return { allowed: true };
}
