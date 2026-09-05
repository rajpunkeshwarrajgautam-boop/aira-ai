export interface ReticleSession {
	readonly sessionId: string;
	readonly url: string;
	readonly title: string;
	readonly attachedAt: number;
	readonly isLiveTab: boolean;
	readonly origin: string;
}

export interface ReticlePredicate {
	readonly kind: "element" | "net" | "console" | "state";
	readonly testid?: string;
	readonly selector?: string;
	readonly expectedText?: string;
	readonly method?: string;
	readonly status?: number;
	readonly urlContains?: string;
	readonly predicateFn?: (state: Record<string, unknown>) => boolean;
}

export interface ReticleEvaluationOptions {
	readonly targetUrl: string;
	readonly allowedOrigins: readonly string[];
	readonly flowName: string;
	readonly timeoutMs?: number;
}

export interface ReticleEvaluationVerdict {
	readonly verified: "yes" | "no" | "unknown";
	readonly flowName: string;
	readonly sessionId?: string;
	readonly durationMs: number;
	readonly assertions: readonly {
		readonly kind: string;
		readonly passed: boolean;
		readonly details?: string;
	}[];
	readonly error?: string;
	readonly userActionRequired?: string;
}

/** Verify that a target tab URL strictly matches an authorized application origin */
export function verifyTabOrigin(url: string, allowedOrigins: readonly string[]): boolean {
	try {
		const parsed = new URL(url);
		return allowedOrigins.some((allowed) => {
			const allowedParsed = new URL(allowed);
			return parsed.origin.toLowerCase() === allowedParsed.origin.toLowerCase();
		});
	} catch {
		return false;
	}
}

/** Verify that a session is isolated and cannot access cross-tenant sessions */
export function verifySessionIsolation(
	requestingSessionId: string,
	targetSessionId: string,
	activeSessions: readonly ReticleSession[],
): boolean {
	if (!requestingSessionId || !targetSessionId) return false;
	const session = activeSessions.find((s) => s.sessionId === targetSessionId);
	if (!session) return false;
	return session.sessionId === requestingSessionId;
}

/** Perform semantic evaluation against an attached browser session */
export function evaluateSemanticSession(
	session: ReticleSession,
	options: ReticleEvaluationOptions,
	predicates: readonly ReticlePredicate[],
	observedState?: Record<string, unknown>,
): ReticleEvaluationVerdict {
	const startTime = Date.now();

	if (!session.isLiveTab) {
		return {
			verified: "unknown",
			flowName: options.flowName,
			sessionId: session.sessionId,
			durationMs: Date.now() - startTime,
			assertions: [],
			error: "Session is not an active live browser tab.",
			userActionRequired: "Focus and keep the AIRA application tab visible in your headed browser.",
		};
	}

	if (!verifyTabOrigin(session.url, options.allowedOrigins)) {
		return {
			verified: "no",
			flowName: options.flowName,
			sessionId: session.sessionId,
			durationMs: Date.now() - startTime,
			assertions: [{ kind: "origin_check", passed: false, details: `Origin ${session.origin} is not in allowed origins.` }],
			error: `Security boundary violation: Session origin ${session.origin} is unauthorized.`,
		};
	}

	const assertionResults: Array<{ kind: string; passed: boolean; details?: string }> = [
		{ kind: "origin_check", passed: true, details: `Verified origin ${session.origin}` },
		{ kind: "tab_attachment", passed: true, details: `Attached to live session ${session.sessionId}` },
	];

	let hasMissingEvidence = false;

	for (const pred of predicates) {
		if (pred.predicateFn) {
			const passed = pred.predicateFn(observedState ?? {});
			assertionResults.push({ kind: pred.kind, passed, details: `Evaluated predicate ${pred.kind}` });
		} else if (observedState) {
			let passed = false;
			let details = "";
			if (pred.testid) {
				passed = observedState[pred.testid] !== undefined && observedState[pred.testid] !== null;
				details = `Observed testid "${pred.testid}": ${passed ? "present" : "absent"}`;
			} else if (pred.selector) {
				passed = observedState[pred.selector] !== undefined && observedState[pred.selector] !== null;
				details = `Observed selector "${pred.selector}": ${passed ? "present" : "absent"}`;
			} else if (pred.urlContains) {
				const currentUrl = String(observedState.url ?? session.url);
				passed = currentUrl.includes(pred.urlContains);
				details = `Observed URL "${currentUrl}" contains "${pred.urlContains}": ${passed}`;
			} else if (pred.status !== undefined) {
				passed = observedState.status === pred.status;
				details = `Observed status ${observedState.status} === expected ${pred.status}: ${passed}`;
			} else {
				passed = false;
				details = `Predicate ${pred.kind} specifies no verifiable property in observed state`;
			}
			assertionResults.push({ kind: pred.kind, passed, details });
		} else {
			// No custom evaluator and no observed state: MUST NOT PASS SILENTLY
			hasMissingEvidence = true;
			assertionResults.push({
				kind: pred.kind,
				passed: false,
				details: `No observed semantic state or evaluator provided for ${pred.kind} predicate (${pred.testid ?? pred.selector ?? "state"}). Cannot prove without evidence.`,
			});
		}
	}

	const allPassed = assertionResults.every((a) => a.passed);

	return {
		verified: allPassed ? "yes" : hasMissingEvidence ? "unknown" : "no",
		flowName: options.flowName,
		sessionId: session.sessionId,
		durationMs: Date.now() - startTime,
		assertions: assertionResults,
		...(hasMissingEvidence ? { error: "Semantic evaluation could not be completed: missing live observed state." } : {}),
	};
}
