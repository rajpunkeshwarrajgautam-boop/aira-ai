import assert from "node:assert/strict";
import test from "node:test";

import { globalEnterpriseOrgManager } from "../lib/enterprise/organization-manager";

test("Enterprise Organization & Multi-Tenant Workspace Hierarchy (Gate 112)", () => {
	const ownerUserId = "user_owner_enterprise_1";

	const org = globalEnterpriseOrgManager.createOrganization({
		name: "Acme Autonomous Corp",
		slug: "acme-corp",
		ownerUserId,
		ssoConfig: {
			enabled: true,
			provider: "OIDC",
			domainHint: "acme.com",
		},
		securityPolicy: {
			enforceMfa: true,
			sessionTimeoutMinutes: 480,
		},
	});

	assert.ok(org.id.startsWith("org-"));
	assert.equal(org.name, "Acme Autonomous Corp");
	assert.equal(org.ssoConfig.enabled, true);

	// Verify Owner permission check
	assert.equal(globalEnterpriseOrgManager.canPerformAction(org.id, ownerUserId, "OWNER"), true);
	assert.equal(globalEnterpriseOrgManager.canPerformAction(org.id, ownerUserId, "ADMIN"), true);
	assert.equal(globalEnterpriseOrgManager.canPerformAction(org.id, "unauthorized_user", "VIEWER"), false);

	// Create workspace under organization
	const ws = globalEnterpriseOrgManager.createWorkspace({
		orgId: org.id,
		name: "Core Research Pod",
		budgetLimitUsd: 250.0,
		allowedToolIds: ["web", "files", "analytics"],
	});

	assert.ok(ws.id.startsWith("ws-"));
	assert.equal(ws.orgId, org.id);
	assert.equal(ws.budgetLimitUsd, 250.0);
});

test("Team Agents Sharing & Workspace Tenancy (Gate 111)", () => {
	const share = {
		agentId: "agent-growth-hacker",
		workspaceId: "ws-growth-lab",
		permission: "USE" as const,
		sharedByUserId: "user_lead_growth",
		sharedAt: new Date().toISOString(),
	};

	globalEnterpriseOrgManager.shareAgentWithWorkspace(share);
	const sharedList = globalEnterpriseOrgManager.listWorkspaceAgents("ws-growth-lab");

	assert.equal(sharedList.length, 1);
	assert.equal(sharedList[0]?.agentId, "agent-growth-hacker");
	assert.equal(sharedList[0]?.permission, "USE");
});

test("Enterprise Identity: SAML/OIDC Contract & Invariants (Gate 113)", () => {
	// Verify that unconfigured SSO fails closed
	const basicOrg = globalEnterpriseOrgManager.createOrganization({
		name: "Staging Sandbox Org",
		slug: "staging-sandbox",
		ownerUserId: "user_dev_sandbox",
	});

	assert.equal(basicOrg.ssoConfig.enabled, false);
	assert.equal(basicOrg.securityPolicy.enforceMfa, false);
});

test("Enterprise Organization Durability: Survives Process Restart (Gate 112 & Phase 12)", () => {
	const org = globalEnterpriseOrgManager.createOrganization({
		name: "Durable Global Enterprise",
		slug: "durable-global-ent",
		ownerUserId: "user_ent_owner_1",
		ssoConfig: { enabled: true, provider: "SAML", idpMetadataUrl: "https://idp.example.com/metadata" },
	});

	const ws = globalEnterpriseOrgManager.createWorkspace({
		orgId: org.id,
		name: "Security Engineering Workspace",
	});

	// Simulate restart
	globalEnterpriseOrgManager.reloadFromDisk();

	const role = globalEnterpriseOrgManager.getMemberRole(org.id, "user_ent_owner_1");
	assert.equal(role, "OWNER");

	const canAdmin = globalEnterpriseOrgManager.canPerformAction(org.id, "user_ent_owner_1", "ADMIN");
	assert.equal(canAdmin, true);
});

