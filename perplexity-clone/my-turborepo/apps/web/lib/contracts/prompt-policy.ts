import { z } from "zod";
import crypto from "crypto";

export type VersionStatus = "ACTIVE" | "DEPRECATED" | "DRAFT" | "ROLLED_BACK";

export interface VersionedEntity<T> {
	readonly id: string;
	readonly name: string;
	readonly version: number;
	readonly status: VersionStatus;
	readonly content: T;
	readonly contentHash: string;
	readonly changelog: string;
	readonly author: string;
	readonly createdAt: string;
	readonly activatedAt?: string;
}

export interface PromptTemplate {
	readonly template: string;
	readonly inputVariables: readonly string[];
	readonly systemInstruction?: string;
	readonly temperature?: number;
	readonly stopSequences?: readonly string[];
}

export interface PolicyRule {
	readonly id: string;
	readonly description: string;
	readonly riskThreshold: "LOW" | "MEDIUM" | "HIGH" | "PROTECTED";
	readonly action: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
	readonly conditions: Record<string, unknown>;
}

export class VersionManager<T> {
	private registry = new Map<string, VersionedEntity<T>[]>();

	registerVersion(params: {
		id: string;
		name: string;
		version: number;
		content: T;
		changelog: string;
		author: string;
		makeActive?: boolean;
	}): VersionedEntity<T> {
		const rawString = JSON.stringify(params.content);
		const hash = crypto.createHash("sha256").update(rawString).digest("hex");

		const entity: VersionedEntity<T> = {
			id: params.id,
			name: params.name,
			version: params.version,
			status: params.makeActive ? "ACTIVE" : "DRAFT",
			content: params.content,
			contentHash: hash,
			changelog: params.changelog,
			author: params.author,
			createdAt: new Date().toISOString(),
			activatedAt: params.makeActive ? new Date().toISOString() : undefined,
		};

		const list = this.registry.get(params.name) ?? [];
		
		if (params.makeActive) {
			// Demote currently active to DEPRECATED
			for (let i = 0; i < list.length; i++) {
				if (list[i]!.status === "ACTIVE") {
					list[i] = { ...list[i]!, status: "DEPRECATED" };
				}
			}
		}

		list.push(entity);
		this.registry.set(params.name, list);
		return entity;
	}

	getActive(name: string): VersionedEntity<T> | undefined {
		const list = this.registry.get(name);
		return list?.find((item) => item.status === "ACTIVE");
	}

	getVersion(name: string, version: number): VersionedEntity<T> | undefined {
		const list = this.registry.get(name);
		return list?.find((item) => item.version === version);
	}

	rollback(name: string, targetVersion: number): VersionedEntity<T> | undefined {
		const list = this.registry.get(name);
		if (!list) return undefined;

		const target = list.find((item) => item.version === targetVersion);
		if (!target) return undefined;

		for (let i = 0; i < list.length; i++) {
			if (list[i]!.status === "ACTIVE") {
				list[i] = { ...list[i]!, status: "ROLLED_BACK" };
			}
			if (list[i]!.version === targetVersion) {
				list[i] = {
					...list[i]!,
					status: "ACTIVE",
					activatedAt: new Date().toISOString(),
				};
			}
		}

		return this.getActive(name);
	}

	listVersions(name: string): readonly VersionedEntity<T>[] {
		return this.registry.get(name) ?? [];
	}
}

export const promptVersionManager = new VersionManager<PromptTemplate>();
export const policyVersionManager = new VersionManager<PolicyRule[]>();
