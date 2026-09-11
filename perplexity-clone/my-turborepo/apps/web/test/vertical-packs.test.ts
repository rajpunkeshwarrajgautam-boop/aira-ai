import assert from "node:assert/strict";
import test from "node:test";

import { globalVerticalPackService } from "../lib/verticals/vertical-pack-service";

test("Vertical Specialist Packs Directory & Registration (Gates 79, 83, 84, 87, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99)", () => {
	const packs = globalVerticalPackService.listPacks();
	assert.ok(packs.length >= 14, "Expected at least 14 vertical packs");

	const legal = globalVerticalPackService.getPack("legal-pack");
	assert.ok(legal);
	assert.equal(legal?.gateNumber, 92);
	assert.equal(legal?.humanReviewRequired, true);

	const finance = globalVerticalPackService.getPack("finance-analysis");
	assert.ok(finance);
	assert.equal(finance?.gateNumber, 93);
	assert.ok(finance?.supportedDeliverables.includes("SPREADSHEET"));

	const transaction = globalVerticalPackService.getPack("transaction-risk");
	assert.ok(transaction);
	assert.equal(transaction?.defaultRisk, "PROTECTED");
});

test("Legal Research Guardrails & Mandatory Disclaimers (Gate 92)", () => {
	const res = globalVerticalPackService.executePackValidation("legal-pack", {
		query: "Draft mutual non-disclosure agreement for Delaware C-Corp",
	});

	assert.equal(res.allowed, true);
	assert.equal(res.requiresStepUpApproval, true);
	assert.ok(res.disclaimers.some((d) => d.includes("Automated legal research only")));
});

test("Sensitive Data Detection & PII Redaction Pipeline (Gate 96)", () => {
	const payload = {
		customerName: "Alice Smith",
		ssn: "123-45-6789",
		creditCard: "4111 2222 3333 4444",
		notes: "High value subscriber",
	};

	const res = globalVerticalPackService.executePackValidation("sensitive-data", payload);

	assert.equal(res.sanitizedPayload.ssn, "[REDACTED_SSN]");
	assert.equal(res.sanitizedPayload.creditCard, "[REDACTED_PAN]");
	assert.equal(res.sanitizedPayload.customerName, "Alice Smith");
});

test("Transaction Risk Fencing & Escrow Disclaimers (Gate 95)", () => {
	const res = globalVerticalPackService.executePackValidation("transaction-risk", {
		amountUsd: 500,
		recipient: "external_vendor",
	});

	assert.equal(res.requiresStepUpApproval, true);
	assert.ok(res.disclaimers.some((d) => d.includes("Dual-custody verification active")));
});
