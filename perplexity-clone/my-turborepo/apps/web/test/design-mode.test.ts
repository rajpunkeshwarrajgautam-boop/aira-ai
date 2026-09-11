import assert from "node:assert/strict";
import test from "node:test";

import { ArtifactValidator, ArtifactEngine } from "../lib/artifacts/engine";

test("Design Mode: SVG Generation & Token Ingestion Validation (Gates 67, 68)", () => {
	const validator = new ArtifactValidator();

	// Valid SVG design artifact
	const validSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#a98b43"/></svg>';
	const svgResult = validator.validate("DESIGN_SVG", validSvg);
	assert.equal(svgResult.isValid, true);
	assert.equal(svgResult.score, 100);

	// Invalid SVG design artifact
	const badSvg = '<div>Not an svg</div>';
	const badSvgResult = validator.validate("DESIGN_SVG", badSvg);
	assert.equal(badSvgResult.isValid, false);
	assert.ok(badSvgResult.errors.some((e) => e.includes("valid root <svg> tags")));

	// Valid Design System Tokens JSON
	const tokens = JSON.stringify({
		colors: {
			primary: "#a98b43",
			background: "#0a0c0f",
			surface: "#101318",
		},
		typography: {
			fontFamily: "Geist, sans-serif",
		},
	});
	const tokensResult = validator.validate("DESIGN_TOKENS", tokens);
	assert.equal(tokensResult.isValid, true);
	assert.equal(tokensResult.score, 100);
});

test("Design Mode: Artifact Creation & Immutable Versioning (Gate 67)", () => {
	const engine = new ArtifactEngine();
	const userId = "user_design_designer";

	const design = engine.createArtifact({
		userId,
		name: "Hero Component.svg",
		format: "DESIGN_SVG",
		content: '<svg viewBox="0 0 800 400"><rect width="800" height="400" fill="#101318"/></svg>',
		provenance: {
			runId: "run_design_1",
			generator: "Design Mode Agent",
			inputChecksum: "sha_design_input",
		},
		tags: ["vector", "hero", "ui"],
	});

	assert.equal(design.format, "DESIGN_SVG");
	assert.equal(design.currentVersion, 1);
	assert.match(design.versions[0]!.checksum, /^[a-f0-9]{64}$/);
});
