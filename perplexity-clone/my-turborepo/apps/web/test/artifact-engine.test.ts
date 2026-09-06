import assert from "node:assert/strict";
import test from "node:test";

import { ArtifactEngine, ArtifactValidator } from "../lib/artifacts/engine";

test("Artifact Validator: Format Integrity & Validation (Gate 65)", () => {
	const validator = new ArtifactValidator();

	// Valid Markdown
	const validMd = validator.validate("MARKDOWN", "# Title\n\nSome body text with metrics.");
	assert.equal(validMd.isValid, true);
	assert.equal(validMd.score, 100);
	assert.ok((validMd.metrics.wordCount ?? 0) > 0);

	// Invalid JSON
	const badJson = validator.validate("JSON", "{ broken: json, ");
	assert.equal(badJson.isValid, false);
	assert.equal(badJson.score, 0);
	assert.ok(badJson.errors.length > 0);

	// Valid JSON with depth metric
	const goodJson = validator.validate("JSON", JSON.stringify({ a: { b: { c: 123 } } }));
	assert.equal(goodJson.isValid, true);
	assert.equal(goodJson.metrics.structureDepth, 4);

	// Empty content fails
	const empty = validator.validate("TXT", "");
	assert.equal(empty.isValid, false);
});

test("Artifact Engine: Multi-Format Creation, Versioning & Checksums (Gate 65)", () => {
	const engine = new ArtifactEngine();
	const userId = "user_art_1";

	const created = engine.createArtifact({
		userId,
		name: "Financial Projections.csv",
		format: "CSV",
		content: "Year,Revenue,Cost\n2025,100,50\n2026,180,80\n2027,300,120",
		provenance: {
			runId: "run_fin_1",
			agentRole: "ANALYST",
			inputChecksum: "sha_input_1",
			generator: "Financial Modeling Engine",
		},
		tags: ["finance", "forecast"],
	});

	assert.equal(created.currentVersion, 1);
	assert.equal(created.versions.length, 1);
	assert.match(created.versions[0]!.checksum, /^[a-f0-9]{64}$/);

	// Update to Version 2
	const updated = engine.updateArtifactVersion({
		userId,
		artifactId: created.id,
		content: "Year,Revenue,Cost\n2025,100,50\n2026,200,85\n2027,350,130",
		provenance: {
			runId: "run_fin_2",
			parentArtifactId: created.id,
			agentRole: "ANALYST",
			inputChecksum: "sha_input_2",
			generator: "Financial Modeling Engine v2",
		},
	});

	assert.notEqual(updated, null);
	assert.equal(updated?.currentVersion, 2);
	assert.equal(updated?.versions.length, 2);
	assert.notEqual(updated?.versions[0]?.checksum, updated?.versions[1]?.checksum);
});

test("Spreadsheet / Tabular Data Statistics (Gate 73)", () => {
	const engine = new ArtifactEngine();
	const csvContent = "Metric,Value,Score\nAlpha,10,85\nBeta,20,95\nGamma,30,75";

	const stats = engine.computeTableStats(csvContent);

	assert.equal(stats.rowCount, 3);
	assert.deepEqual(stats.columns, ["Metric", "Value", "Score"]);

	// Metric is categorical
	assert.equal(stats.stats["Metric"]?.isNumeric, false);
	assert.equal(stats.stats["Metric"]?.distinct, 3);

	// Value is numeric with accurate sum and mean
	assert.equal(stats.stats["Value"]?.isNumeric, true);
	assert.equal(stats.stats["Value"]?.sum, 60);
	assert.equal(stats.stats["Value"]?.avg, 20);

	// Score is numeric
	assert.equal(stats.stats["Score"]?.isNumeric, true);
	assert.equal(stats.stats["Score"]?.sum, 255);
	assert.equal(stats.stats["Score"]?.avg, 85);
});

test("Office Document Outlines: PPTX Deck & DOCX (Gate 74)", () => {
	const validator = new ArtifactValidator();

	const deckPayload = JSON.stringify({
		title: "Quarterly Strategy",
		slides: [
			{ title: "Executive Summary", bullets: ["Revenue grew 40%", "CAC reduced 18%"] },
			{ title: "Key Milestones", bullets: ["Launched multi-agent swarms", "Certified Tool Gateway"] },
		],
	});

	const res = validator.validate("PPTX_DECK", deckPayload);
	assert.equal(res.isValid, true);
	assert.equal(res.metrics.slideCount, 2);
});

test("Cryptographic Provenance Lineage Graph Traversal (Gate 123)", () => {
	const engine = new ArtifactEngine();
	const userId = "user_lineage_test";

	// Root artifact
	const root = engine.createArtifact({
		userId,
		name: "Market Signals.txt",
		format: "TXT",
		content: "Raw intelligence text from web citations",
		provenance: {
			runId: "run_step_1",
			generator: "Web Crawler",
			inputChecksum: "sha_root",
		},
	});

	// Derived artifact 1
	const derived1 = engine.createArtifact({
		userId,
		name: "Synthesized Brief.md",
		format: "MARKDOWN",
		content: "# Brief\n\nStructured synthesis",
		provenance: {
			runId: "run_step_2",
			parentArtifactId: root.id,
			generator: "Synthesis Agent",
			inputChecksum: "sha_derived1",
		},
	});

	// Derived artifact 2
	const derived2 = engine.createArtifact({
		userId,
		name: "Final Executive Deck.pptx",
		format: "PPTX_DECK",
		content: JSON.stringify({ slides: [{ title: "Exec", bullets: ["A", "B"] }] }),
		provenance: {
			runId: "run_step_3",
			parentArtifactId: derived1.id,
			generator: "Presentation Agent",
			inputChecksum: "sha_derived2",
		},
	});

	// Retrieve lineage for derived2
	const lineage = engine.getProvenanceLineage(userId, derived2.id);

	assert.equal(lineage.length, 3);
	assert.equal(lineage[0]?.artifactId, derived2.id);
	assert.equal(lineage[1]?.artifactId, derived1.id);
	assert.equal(lineage[2]?.artifactId, root.id);
	assert.equal(lineage[2]?.generator, "Web Crawler");
});

test("Native Deliverables: PDF, DOCX, XLSX, PPTX, and ZIP Generation & Validation (Gates 65, 66, 73, 74)", () => {
	const engine = new ArtifactEngine();
	const validator = new ArtifactValidator();

	// 1. Native PDF
	const pdfBuf = engine.generatePdf({
		title: "Quarterly Financial Analysis",
		bodyLines: ["Revenue grew 45% YoY.", "Gross margin reached 82%."],
	});
	const pdfValidation = validator.validate("PDF", pdfBuf);
	assert.equal(pdfValidation.isValid, true);
	assert.ok((pdfValidation.metrics.pageCount ?? 0) >= 1);

	// 2. Native DOCX (Open XML ZIP)
	const docxBuf = engine.generateDocx({
		title: "AIRA Architecture Brief",
		headings: ["System Invariants", "Tool Gateway"],
		paragraphs: ["The system guarantees fail-closed isolation.", "Privileged tools require persisted approval."],
		tables: [{ headers: ["Component", "Status"], rows: [["AgentRuntime", "Certified"], ["ToolGateway", "Active"]] }],
	});
	const docxValidation = validator.validate("DOCX", docxBuf);
	assert.equal(docxValidation.isValid, true);
	assert.ok((docxValidation.metrics.wordCount ?? 0) > 0);

	// 3. Native XLSX (Open XML ZIP)
	const xlsxBuf = engine.generateXlsx([{
		name: "Financials",
		headers: ["Item", "Q1", "Q2"],
		rows: [["Revenue", 1000, 1500], ["Expenses", 400, 600]],
		formulas: { "B3": "=SUM(B1:B2)" },
	}]);
	const xlsxValidation = validator.validate("XLSX", xlsxBuf);
	assert.equal(xlsxValidation.isValid, true);
	assert.equal(xlsxValidation.metrics.rowCount, 3);

	// 4. Native PPTX (Open XML ZIP)
	const pptxBuf = engine.generatePptx({
		title: "AIRA Platform Strategy",
		slides: [
			{ title: "Vision", bullets: ["128 Gates Complete", "Truthmode Architecture"] },
			{ title: "Execution", bullets: ["Real node dispatch", "Durable state"] },
		],
	});
	const pptxValidation = validator.validate("PPTX", pptxBuf);
	assert.equal(pptxValidation.isValid, true);
	assert.ok((pptxValidation.metrics.slideCount ?? 0) >= 1);

	// 5. Native ZIP Archive
	const zipBuf = engine.generateZip([
		{ path: "summary.txt", data: "Executive summary text" },
		{ path: "data.csv", data: "a,b\n1,2" },
	]);
	const zipValidation = validator.validate("ZIP", zipBuf);
	assert.equal(zipValidation.isValid, true);
	assert.equal(zipValidation.metrics.archiveFilesCount, 2);
});

test("Artifact Durability: Survives Process Restart & Reload (Gate 65 & Phase 12)", () => {
	const engine1 = new ArtifactEngine();
	const userId = "user_restart_test";

	const art = engine1.createArtifact({
		userId,
		name: "Durable Report.pdf",
		format: "PDF",
		content: engine1.generatePdf({ title: "Durable PDF", bodyLines: ["Persistent across process restarts."] }),
		provenance: {
			runId: "run_durability_1",
			generator: "PDF Engine",
			inputChecksum: "sha_durability",
		},
	});

	// Simulate complete process restart: instantiate new engine reading from disk
	const engine2 = new ArtifactEngine();
	const restored = engine2.getArtifact(userId, art.id);
	assert.notEqual(restored, null);
	assert.equal(restored?.name, "Durable Report.pdf");
	assert.equal(restored?.currentVersion, 1);
	assert.equal(restored?.versions[0]?.checksum, art.versions[0]?.checksum);
});

