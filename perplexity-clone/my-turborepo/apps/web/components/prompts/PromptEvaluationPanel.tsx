"use client";

import { useCallback, useEffect, useState } from "react";

import {
	readApiError,
	type EvaluationRunView,
	type EvaluationSuiteSummary,
	type ProviderDescriptor,
	type PromptDetailResponse,
} from "./types";

interface CaseDraft {
	name: string;
	input: string;
	checkType: string;
	checkValue: string;
}

const DEFAULT_CASE: CaseDraft = {
	name: "Returns a bounded answer",
	input: "Give me a two-sentence overview.",
	checkType: "max_length",
	checkValue: "1200",
};

/**
 * Evaluation suites.
 *
 * Every check is deterministic and applied to the text the provider actually
 * returned, so a stored result is a measurement rather than a score. Runs
 * require a published version: a result must describe something a runtime
 * surface could have produced.
 */
export function PromptEvaluationPanel({
	detail,
	providers,
}: {
	readonly detail: PromptDetailResponse;
	readonly providers: readonly ProviderDescriptor[];
}) {
	const [suites, setSuites] = useState<readonly EvaluationSuiteSummary[]>([]);
	const [checkTypes, setCheckTypes] = useState<readonly string[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
	const [suiteName, setSuiteName] = useState(`${detail.prompt.name} checks`);
	const [cases, setCases] = useState<CaseDraft[]>([{ ...DEFAULT_CASE }]);
	const [selectedSuite, setSelectedSuite] = useState("");
	const [provider, setProvider] = useState<string>(
		providers.find((entry) => entry.configured)?.id ?? "omniroute",
	);
	const [run, setRun] = useState<EvaluationRunView | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await fetch("/api/prompts/evaluations", { credentials: "include", cache: "no-store" });
			if (!response.ok) return;
			const data = (await response.json()) as {
				suites: readonly EvaluationSuiteSummary[];
				checkTypes: readonly string[];
			};
			setSuites(data.suites);
			setCheckTypes(data.checkTypes);
			if (!selectedSuite && data.suites[0]) setSelectedSuite(data.suites[0].id);
		} finally {
			setLoading(false);
		}
	}, [selectedSuite]);

	useEffect(() => {
		void load();
	}, [load]);

	const createSuite = useCallback(async () => {
		setBusy(true);
		setMessage(null);
		try {
			const response = await fetch("/api/prompts/evaluations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					name: suiteName,
					promptId: detail.prompt.id,
					cases: cases.map((entry) => ({
						name: entry.name,
						input: entry.input,
						checks: [{ type: entry.checkType, value: entry.checkValue || undefined }],
					})),
				}),
			});
			if (!response.ok) {
				setMessage({ tone: "error", text: await readApiError(response, "Could not create the suite.") });
				return;
			}
			setMessage({ tone: "ok", text: "Suite created." });
			await load();
		} catch {
			setMessage({ tone: "error", text: "Suite could not be created." });
		} finally {
			setBusy(false);
		}
	}, [suiteName, cases, detail.prompt.id, load]);

	const runSuite = useCallback(async () => {
		if (!selectedSuite) return;
		setBusy(true);
		setMessage(null);
		setRun(null);
		try {
			const response = await fetch("/api/prompts/evaluations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					action: "run",
					suiteId: selectedSuite,
					promptId: detail.prompt.id,
					provider,
				}),
			});
			if (!response.ok) {
				setMessage({ tone: "error", text: await readApiError(response, "The run could not complete.") });
				return;
			}
			const body = (await response.json()) as { run: EvaluationRunView };
			setRun(body.run);
			await load();
		} catch {
			setMessage({ tone: "error", text: "The run could not complete." });
		} finally {
			setBusy(false);
		}
	}, [selectedSuite, detail.prompt.id, provider, load]);

	return (
		<div className="ps-panel-body ps-stack">
			<p className="ps-hint">
				Checks are deterministic functions of the returned text — no model grades anything here. Runs
				require a published version and record the prompt, version, provider, model and duration so a
				result can be reproduced.
			</p>

			{detail.prompt.publishedVersionId === null ? (
				<p className="ps-notice">
					This prompt has no published version yet. Publish one from the Versions tab to evaluate it.
				</p>
			) : null}

			{message ? (
				<p className="ps-notice" data-tone={message.tone} role="status">
					{message.text}
				</p>
			) : null}

			<section className="ps-stack" aria-labelledby="ps-new-suite">
				<h3 className="ps-panel-title" id="ps-new-suite">
					New suite
				</h3>
				<label className="ps-field">
					<span className="ps-label">Suite name</span>
					<input
						className="ps-input"
						value={suiteName}
						onChange={(event) => setSuiteName(event.target.value)}
					/>
				</label>

				{cases.map((entry, index) => (
					<div className="ps-stack" key={`case-${index}`} style={{ border: "1px solid var(--ps-line)", borderRadius: 8, padding: "0.7rem" }}>
						<label className="ps-field">
							<span className="ps-label">Case name</span>
							<input
								className="ps-input"
								value={entry.name}
								onChange={(event) =>
									setCases((current) =>
										current.map((c, i) => (i === index ? { ...c, name: event.target.value } : c)),
									)
								}
							/>
						</label>
						<label className="ps-field">
							<span className="ps-label">Input</span>
							<textarea
								className="ps-textarea ps-textarea-sm"
								value={entry.input}
								onChange={(event) =>
									setCases((current) =>
										current.map((c, i) => (i === index ? { ...c, input: event.target.value } : c)),
									)
								}
							/>
						</label>
						<div className="ps-grid ps-grid-2">
							<label className="ps-field">
								<span className="ps-label">Check</span>
								<select
									className="ps-select"
									value={entry.checkType}
									onChange={(event) =>
										setCases((current) =>
											current.map((c, i) => (i === index ? { ...c, checkType: event.target.value } : c)),
										)
									}
								>
									{(checkTypes.length > 0 ? checkTypes : [entry.checkType]).map((type) => (
										<option key={type} value={type}>
											{type.replace(/_/g, " ")}
										</option>
									))}
								</select>
							</label>
							<label className="ps-field">
								<span className="ps-label">Value</span>
								<input
									className="ps-input"
									value={entry.checkValue}
									onChange={(event) =>
										setCases((current) =>
											current.map((c, i) => (i === index ? { ...c, checkValue: event.target.value } : c)),
										)
									}
								/>
							</label>
						</div>
						{cases.length > 1 ? (
							<div className="ps-actions">
								<button
									type="button"
									className="ps-button"
									data-variant="danger"
									onClick={() => setCases((current) => current.filter((_, i) => i !== index))}
								>
									Remove case
								</button>
							</div>
						) : null}
					</div>
				))}

				<div className="ps-actions">
					<button
						type="button"
						className="ps-button"
						disabled={cases.length >= 25}
						onClick={() => setCases((current) => [...current, { ...DEFAULT_CASE }])}
					>
						Add case
					</button>
					<button
						type="button"
						className="ps-button"
						data-variant="primary"
						onClick={createSuite}
						disabled={busy || !suiteName.trim()}
					>
						{busy ? "Working…" : "Create suite"}
					</button>
				</div>
			</section>

			<section className="ps-stack" aria-labelledby="ps-run-suite">
				<h3 className="ps-panel-title" id="ps-run-suite">
					Run a suite
				</h3>
				{loading ? (
					<p className="ps-empty">Loading suites…</p>
				) : suites.length === 0 ? (
					<p className="ps-empty">No suites yet.</p>
				) : (
					<div className="ps-grid ps-grid-2">
						<label className="ps-field">
							<span className="ps-label">Suite</span>
							<select
								className="ps-select"
								value={selectedSuite}
								onChange={(event) => setSelectedSuite(event.target.value)}
							>
								{suites.map((suite) => (
									<option key={suite.id} value={suite.id}>
										{suite.name} ({suite.caseCount} cases)
									</option>
								))}
							</select>
						</label>
						<label className="ps-field">
							<span className="ps-label">Provider</span>
							<select
								className="ps-select"
								value={provider}
								onChange={(event) => setProvider(event.target.value)}
							>
								{providers.map((entry) => (
									<option key={entry.id} value={entry.id} disabled={!entry.configured}>
										{entry.label}
										{entry.configured ? "" : " (not configured)"}
									</option>
								))}
							</select>
						</label>
					</div>
				)}

				<div className="ps-actions">
					<button
						type="button"
						className="ps-button"
						data-variant="primary"
						onClick={runSuite}
						disabled={busy || !selectedSuite || detail.prompt.publishedVersionId === null}
					>
						{busy ? "Running…" : "Run evaluation"}
					</button>
				</div>
			</section>

			{run ? (
				<section className="ps-stack" aria-labelledby="ps-run-results">
					<h3 className="ps-panel-title" id="ps-run-results">
						Results — {run.passCount} passed, {run.failCount} failed, {run.errorCount} errored
					</h3>
					<p className="ps-measured">
						{run.providerId} · {run.model}
						{run.routingMode ? ` · ${run.routingMode}` : ""} ·{" "}
						{run.durationMs !== null ? `${run.durationMs} ms measured` : "duration unavailable"}
					</p>
					<div className="ps-table-wrap">
						<table className="ps-table">
							<thead>
								<tr>
									<th scope="col">Case</th>
									<th scope="col">Result</th>
									<th scope="col">Checks</th>
									<th scope="col">Duration</th>
								</tr>
							</thead>
							<tbody>
								{run.results.map((result) => (
									<tr key={result.caseId}>
										<th scope="row" style={{ color: "var(--ps-text)" }}>
											{result.name}
										</th>
										<td>
											<span className="ps-badge" data-tone={result.passed ? "published" : "high"}>
												{result.error ? "error" : result.passed ? "pass" : "fail"}
											</span>
										</td>
										<td>
											{result.error
												? result.error
												: result.checks.map((check) => `${check.type}: ${check.detail}`).join(" · ")}
										</td>
										<td>{result.durationMs} ms</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			) : null}
		</div>
	);
}
