"use client";

import { ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	readApiError,
	type AnalyzeResponse,
	type PromptDetailResponse,
	type PromptVariable,
} from "./types";

interface EditorState {
	name: string;
	description: string;
	category: string;
	tags: string;
	body: string;
	notes: string;
	variables: PromptVariable[];
	providerCompatibility: string;
	modelCompatibility: string;
}

function toEditorState(detail: PromptDetailResponse, versionId: string | null): EditorState {
	const version = detail.versions.find((entry) => entry.id === versionId) ?? detail.versions[0];
	return {
		name: detail.prompt.name,
		description: detail.prompt.description ?? "",
		category: detail.prompt.category,
		tags: detail.prompt.tags.join(", "),
		body: version?.body ?? "",
		notes: "",
		variables: version ? [...version.variables] : [],
		providerCompatibility: version?.providerCompatibility.join(", ") ?? "",
		modelCompatibility: version?.modelCompatibility.join(", ") ?? "",
	};
}

function splitList(value: string): string[] {
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function PromptEditorPanel({
	detail,
	baseVersionId,
	onChanged,
}: {
	readonly detail: PromptDetailResponse;
	readonly baseVersionId: string | null;
	readonly onChanged: () => void;
}) {
	const [state, setState] = useState<EditorState>(() => toEditorState(detail, baseVersionId));
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
	const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
	const [analyzing, setAnalyzing] = useState(false);

	useEffect(() => {
		setState(toEditorState(detail, baseVersionId));
		setAnalysis(null);
		setMessage(null);
	}, [detail, baseVersionId]);

	const runAnalysis = useCallback(async () => {
		if (!state.body.trim()) {
			setMessage({ tone: "error", text: "Write a prompt body before analyzing." });
			return;
		}
		setAnalyzing(true);
		try {
			const response = await fetch("/api/prompts/analyze", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ body: state.body, variables: state.variables }),
			});
			if (!response.ok) {
				setMessage({ tone: "error", text: await readApiError(response, "Analysis failed.") });
				return;
			}
			setAnalysis((await response.json()) as AnalyzeResponse);
			setMessage(null);
		} catch {
			setMessage({ tone: "error", text: "Analysis could not be reached." });
		} finally {
			setAnalyzing(false);
		}
	}, [state.body, state.variables]);

	const saveVersion = useCallback(async () => {
		if (!state.body.trim()) {
			setMessage({ tone: "error", text: "Write a prompt body before saving." });
			return;
		}
		setBusy(true);
		setMessage(null);
		try {
			const metadata = await fetch(`/api/prompts/${detail.prompt.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					name: state.name,
					description: state.description || null,
					category: state.category,
					tags: splitList(state.tags),
				}),
			});
			if (!metadata.ok) {
				setMessage({ tone: "error", text: await readApiError(metadata, "Could not save details.") });
				return;
			}

			const response = await fetch(`/api/prompts/${detail.prompt.id}/versions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					body: state.body,
					variables: state.variables,
					providerCompatibility: splitList(state.providerCompatibility),
					modelCompatibility: splitList(state.modelCompatibility),
					notes: state.notes || undefined,
				}),
			});
			if (!response.ok) {
				setMessage({ tone: "error", text: await readApiError(response, "Could not save version.") });
				return;
			}
			const body = (await response.json()) as { version: { version: number } };
			setMessage({
				tone: "ok",
				text: `Saved as version ${body.version.version}. Earlier versions are unchanged.`,
			});
			onChanged();
		} catch {
			setMessage({ tone: "error", text: "Save could not be completed." });
		} finally {
			setBusy(false);
		}
	}, [detail.prompt.id, state, onChanged]);

	const updateVariable = (index: number, patch: Partial<PromptVariable>) => {
		setState((current) => ({
			...current,
			variables: current.variables.map((variable, position) =>
				position === index ? { ...variable, ...patch } : variable,
			),
		}));
	};

	return (
		<div className="ps-panel-body ps-stack">
			{message ? (
				<p className="ps-notice" data-tone={message.tone} role="status">
					{message.text}
				</p>
			) : null}

			<div className="ps-grid ps-grid-2">
				<label className="ps-field">
					<span className="ps-label">Name</span>
					<input
						className="ps-input"
						value={state.name}
						maxLength={120}
						onChange={(event) => setState({ ...state, name: event.target.value })}
					/>
				</label>
				<label className="ps-field">
					<span className="ps-label">Category</span>
					<input
						className="ps-input"
						value={state.category}
						maxLength={48}
						onChange={(event) => setState({ ...state, category: event.target.value })}
					/>
				</label>
			</div>

			<label className="ps-field">
				<span className="ps-label">Description</span>
				<textarea
					className="ps-textarea ps-textarea-sm"
					value={state.description}
					maxLength={600}
					onChange={(event) => setState({ ...state, description: event.target.value })}
				/>
			</label>

			<label className="ps-field">
				<span className="ps-label">Tags (comma separated)</span>
				<input
					className="ps-input"
					value={state.tags}
					onChange={(event) => setState({ ...state, tags: event.target.value })}
				/>
			</label>

			<label className="ps-field">
				<span className="ps-label">Prompt body</span>
				<textarea
					className="ps-textarea"
					value={state.body}
					spellCheck={false}
					onChange={(event) => setState({ ...state, body: event.target.value })}
					aria-describedby="ps-body-hint"
				/>
				<span className="ps-hint" id="ps-body-hint">
					Use <code>{"{{variable_name}}"}</code> for substitution. Values are inserted literally —
					there is no expression language. This body compiles into the template layer, below AIRA&rsquo;s
					core policy, runtime invariants and mode policy.
				</span>
			</label>

			<div className="ps-stack">
				<div className="ps-panel-header" style={{ padding: 0, border: 0 }}>
					<span className="ps-label">Variables</span>
					<button
						type="button"
						className="ps-button"
						onClick={() =>
							setState((current) => ({
								...current,
								variables: [...current.variables, { name: "", required: false, defaultValue: "" }],
							}))
						}
					>
						Add variable
					</button>
				</div>
				{state.variables.length === 0 ? (
					<p className="ps-hint">No variables declared. Undeclared tokens stay in the prompt literally.</p>
				) : (
					state.variables.map((variable, index) => (
						<div className="ps-variable-row" key={`variable-${index}`}>
							<label className="ps-field">
								<span className="ps-label">Name</span>
								<input
									className="ps-input"
									value={variable.name}
									maxLength={48}
									onChange={(event) => updateVariable(index, { name: event.target.value })}
								/>
							</label>
							<label className="ps-field">
								<span className="ps-label">Default value</span>
								<input
									className="ps-input"
									value={variable.defaultValue ?? ""}
									onChange={(event) => updateVariable(index, { defaultValue: event.target.value })}
								/>
							</label>
							<label className="ps-checkbox">
								<input
									type="checkbox"
									checked={variable.required === true}
									onChange={(event) => updateVariable(index, { required: event.target.checked })}
								/>
								Required
							</label>
							<button
								type="button"
								className="ps-button"
								data-variant="danger"
								aria-label={`Remove variable ${variable.name || index + 1}`}
								onClick={() =>
									setState((current) => ({
										...current,
										variables: current.variables.filter((_, position) => position !== index),
									}))
								}
							>
								<Trash2 className="size-3.5" aria-hidden />
								Remove
							</button>
						</div>
					))
				)}
			</div>

			<div className="ps-grid ps-grid-2">
				<label className="ps-field">
					<span className="ps-label">Provider compatibility</span>
					<input
						className="ps-input"
						value={state.providerCompatibility}
						placeholder="omniroute, nvidia"
						onChange={(event) => setState({ ...state, providerCompatibility: event.target.value })}
					/>
				</label>
				<label className="ps-field">
					<span className="ps-label">Model compatibility</span>
					<input
						className="ps-input"
						value={state.modelCompatibility}
						placeholder="auto/smart, meta/llama-3.1-70b-instruct"
						onChange={(event) => setState({ ...state, modelCompatibility: event.target.value })}
					/>
				</label>
			</div>

			<label className="ps-field">
				<span className="ps-label">Version note</span>
				<input
					className="ps-input"
					value={state.notes}
					maxLength={500}
					placeholder="What changed in this version"
					onChange={(event) => setState({ ...state, notes: event.target.value })}
				/>
			</label>

			<div className="ps-actions">
				<button type="button" className="ps-button" onClick={runAnalysis} disabled={analyzing}>
					<ShieldCheck className="size-3.5" aria-hidden />
					{analyzing ? "Analyzing…" : "Analyze"}
				</button>
				<button
					type="button"
					className="ps-button"
					data-variant="primary"
					onClick={saveVersion}
					disabled={busy}
				>
					{busy ? "Saving…" : "Save as new version"}
				</button>
			</div>

			{analysis ? (
				<section className="ps-stack" aria-label="Analysis results">
					<h3 className="ps-panel-title">
						Security analysis — {analysis.analysis.counts.high} high,{" "}
						{analysis.analysis.counts.warning} warning, {analysis.analysis.counts.info} info
					</h3>
					<p className="ps-hint">
						Static analysis is a lint pass, not a guarantee. Protection comes from the layer
						hierarchy: this template compiles below AIRA&rsquo;s protected layers whether or not
						anything is flagged.
					</p>
					{analysis.analysis.findings.length === 0 ? (
						<p className="ps-notice" data-tone="ok">
							No findings.
						</p>
					) : (
						analysis.analysis.findings.map((finding, index) => (
							<div className="ps-finding" data-severity={finding.severity} key={`finding-${index}`}>
								<p className="ps-finding-message">
									<span className="ps-badge" data-tone={finding.severity}>
										{finding.severity}
									</span>{" "}
									{finding.message}
								</p>
								{finding.evidence ? <p className="ps-evidence">{finding.evidence}</p> : null}
							</div>
						))
					)}

					{analysis.variables.unresolved.length > 0 ? (
						<p className="ps-notice">
							Unresolved variables: {analysis.variables.unresolved.join(", ")}. These stay in the
							prompt literally until a value or default is supplied.
						</p>
					) : null}

					<h3 className="ps-panel-title">Composition preview</h3>
					<p className="ps-hint">
						Which layers would be active for a request using this template. Protected layer contents
						are never shown.
					</p>
					<div>
						{analysis.composition.layers.map((layer) => (
							<div className="ps-layer-row" key={layer.label}>
								<span className="ps-layer-name">
									{layer.label}
									{layer.protected ? (
										<>
											{" "}
											<span className="ps-badge" data-tone="accent">
												protected
											</span>
										</>
									) : null}
								</span>
								<span className="ps-layer-detail">
									{layer.status}
									{layer.characters > 0 ? ` · ${layer.characters.toLocaleString("en-US")} chars` : ""}
								</span>
							</div>
						))}
					</div>
					{analysis.composition.templateConstraints.length > 0 ? (
						<ul className="ps-hint" style={{ paddingLeft: "1.1rem" }}>
							{analysis.composition.templateConstraints.map((constraint) => (
								<li key={constraint}>{constraint}</li>
							))}
						</ul>
					) : null}
				</section>
			) : null}
		</div>
	);
}
