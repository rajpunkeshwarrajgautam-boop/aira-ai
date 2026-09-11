import { z } from "zod";
import type { RiskClass } from "../agent-platform/types";

export type PermissionDecision = "ALLOW" | "ASK" | "DENY";

export interface ToolPermissionRule {
	readonly id: string;
	readonly userId: string;
	readonly projectId?: string;
	readonly toolId: string;
	readonly actionPattern: string; // e.g. "read", "write", "*"
	readonly decision: PermissionDecision;
	readonly justification?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export class ToolPermissionManager {
	private rules = new Map<string, ToolPermissionRule[]>();

	setRule(rule: ToolPermissionRule): void {
		const key = rule.userId;
		const userRules = this.rules.get(key) ?? [];
		const filtered = userRules.filter((r) => r.id !== rule.id);
		filtered.push(rule);
		this.rules.set(key, filtered);
	}

	evaluate(userId: string, toolId: string, action: string, defaultRisk: RiskClass): PermissionDecision {
		const userRules = this.rules.get(userId) ?? [];
		
		// Find matching specific rule first
		const exact = userRules.find((r) => r.toolId === toolId && (r.actionPattern === action || r.actionPattern === "*"));
		if (exact) {
			return exact.decision;
		}

		// Fallback to risk-based default
		if (defaultRisk === "HIGH" || defaultRisk === "PROTECTED") {
			return "ASK";
		}
		return "ALLOW";
	}

	getUserRules(userId: string): readonly ToolPermissionRule[] {
		return this.rules.get(userId) ?? [];
	}

	revokeRule(userId: string, ruleId: string): boolean {
		const userRules = this.rules.get(userId);
		if (!userRules) return false;
		const initialLength = userRules.length;
		const filtered = userRules.filter((r) => r.id !== ruleId);
		this.rules.set(userId, filtered);
		return filtered.length < initialLength;
	}
}

export const globalToolPermissionManager = new ToolPermissionManager();
