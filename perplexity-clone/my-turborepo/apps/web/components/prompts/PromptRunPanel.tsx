"use client";

import { Play, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	readApiError,
	type ProviderDescriptor,
	type PromptDetailResponse,
	type PromptSummary,
	type RunTargetView,
} from "./types";

interface TargetDraft {
	readonly key: string;
	promptId: string;
	versionId: string;
	provider: "openai" | "nvidia" | "omniroute";
	model: string;
}

function makeKey(): string {
	return `t${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Test Playground and Prompt Compare.
 *
 * One target is a playground run; two or three is a comparison. Each target
 * keeps its own state, so a failing or unconfigured provider shows an error in
 * its own pane while the others continue.
 */
export function PromptRunPanel({
	detail,
	prompts,
	providers,
}: {
	readonly detail: PromptDetailResponse;
	readonly prompts: readonly PromptSummary[];
	readonly providers: readonly ProviderDescriptor[];
}) {
	const configured = useMemo(() => providers.filter((provider) => provider.configured), [providers]);
	const defaultProvider = configured[0]?.id ?? "omniroute";

	const [message, setMessage] = useState("Summarize the key risks in one short paragraph.");
	const [variableValues, setVariableValues] = useState<Record<string, string>>({});
	const [targets, setTargets] = useState<TargetDraft[]>(() => [
		{
			key: makeKey(),
			promptId: detail.prompt.id,
			versionId: detail.prompt.publishedVersionId ?? detail.versions[0]?.id ?? "",
			provider: defaultProvider,
			model: "",
		},
	]);
	const [results, setResults] = useState<RunTargetView[]>([]);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setTargets([
			{
				key: makeKey(),
				promptId: detail.prompt.id,
				versionId: detail.prompt.publishedVersionId ?? detail.versions[0]?.id ?? "",
				provider: defaultProvider,
				model: "",
			},
		]);
		setResults([]);
		setError(null);
	}, [detail.prompt.id, detail.prompt.publishedVersionId, detail.versions, defaultProvider]);

	const declaredVariables = useMemo(() => {
		const names = new Map<string, { required: boolean; defaultValue?: string }>();
		for (const version of detail.versions) {
			for (const variable of version.variables) {
				if (!names.has(variable.name)) {
					names.set(variable.name, {
						required: variable.required === true,
						defaultValue: variable.defaultValue,
					});
				}
			}
		}
		return [...names.entries()];
	}, [detail.versions]);

	const versionLabel = useCallback(
		(promptId: string, versionId: string): string => {
			if (promptId === detail.prompt.id) {
				const version = detail.versions.find((entry) => entry.id === versionId);
				return version ? `${detail.prompt.name} v${version.version}` : detail.prompt.name;
			}
			const prompt = prompts.find((entry) => entry.id === promptId);
			return prompt ? `${prompt.name} (published)` : "Prompt";
		},
		[detail, prompts],
	);

	const run = useCallback(async () => {
		if (!message.trim()) {
			setError("Enter a message to send.");
			return;
		}
		const runnable = targets.filter((target) => target.versionId);
		if (runnable.length === 0) {
			setError("Select at least one prompt version to run.");
			return;
		}

		setRunning(true);
		setError(null);
		const initial: RunTargetView[] = runnable.map((target) => ({
			key: target.key,
			versionId: target.versionId,
			versionLabel: versionLabel(target.promptId, target.versionId),
			provider: target.provider,
			model: target.model,
			state: "loading",
			text: "",
			latencyMs: null,
			characters: null,
			resolvedModel: null,
			error: null,
		}));
		setResults(initial);

		try {
			const response = await fetch("/api/prompts/run", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					message,
					variables: variableValues,
					targets: runnable.map((target) => ({
						promptId: target.promptId,
						versionId: target.versionId,
						provider: target.provider,
						...(target.model.trim() ? { model: target.model.trim() } : {}),
					})),
				}),
			});

			if (!response.ok || !response.body) {
				setError(await readApiError(response, "The run could not be started."));
				setResults((current) => current.map((entry) => ({ ...entry, state: "error", error: "Run not started." })));
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			// Targets are matched by index order in the request, which the server
			// preserves in its targetId ordering.
			const idByIndex = new Map<string, string>();

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					let event: {
						type: string;
						targetId: string;
						providerId?: string;
						model?: string;
						promptVersionId?: string;
						delta?: string;
						text?: string;
						latencyMs?: number;
						characters?: number;
						error?: string;
					};
					try {
						event = JSON.parse(line);
					} catch {
						continue;
					}

					if (event.type === "start" && event.promptVersionId) {
						const match = initial.find(
							(entry) => entry.versionId === event.promptVersionId && !idByIndex.has(entry.key),
						);
						if (match) idByIndex.set(match.key, event.targetId);
					}

					const key = [...idByIndex.entries()].find(([, id]) => id === event.targetId)?.[0];
					if (!key) continue;

					setResults((current) =>
						current.map((entry) => {
							if (entry.key !== key) return entry;
							if (event.type === "start") {
								return { ...entry, state: "streaming", resolvedModel: event.model ?? null };
							}
							if (event.type === "delta") {
								return { ...entry, state: "streaming", text: entry.text + (event.delta ?? "") };
							}
							if (event.type === "complete") {
								return {
									...entry,
									state: "success",
									text: event.text ?? entry.text,
									latencyMs: event.latencyMs ?? null,
									characters: event.characters ?? null,
									resolvedModel: event.model ?? entry.resolvedModel,
								};
							}
							if (event.type === "error") {
								return {
									...entry,
									state: "error",
									error: event.error ?? "Provider request failed.",
									resolvedModel: event.model ?? entry.resolvedModel,
								};
							}
							return entry;
						}),
					);
				}
			}

			setResults((current) =>
				current.map((entry) =>
					entry.state === "loading" || entry.state === "streaming"
						? { ...entry, state: "error", error: "The stream ended before this target completed." }
						: entry,
				),
			);
		} catch {
			setError("The run could not be completed.");
			setResults((current) =>
				current.map((entry) =>
					entry.state === "success" ? entry : { ...entry, state: "error", error: "Connection lost." },
				),
			);
		} finally {
			setRunning(false);
		}
	}, [message, targets, variableValues, versionLabel]);

	const publishedPrompts = prompts.filter((prompt) => prompt.publishedVersion);

	return (
		<div className="ps-panel-body ps-stack">
			{configured.length === 0 ? (
				<p className="ps-notice" data-tone="error">
					No provider is configured in this deployment, so prompts cannot be executed here. Provider
					status is read from the same configuration Compare uses.
				</p>
			) : null}

			<label className="ps-field">
				<span className="ps-label">Message to send</span>
				<textarea
					className="ps-textarea ps-textarea-sm"
					value={message}
					onChange={(event) => setMessage(event.target.value)}
				/>
			</label>

			{declaredVariables.length > 0 ? (
				<div className="ps-stack">
					<span className="ps-label">Variable values</span>
					<div className="ps-grid ps-grid-2">
						{declaredVariables.map(([name, meta]) => (
							<label className="ps-field" key={name}>
								<span className="ps-label">
									{name}
									{meta.required ? " (required)" : ""}
								</span>
								<input
									className="ps-input"
									value={variableValues[name] ?? ""}
									placeholder={meta.defaultValue ?? ""}
									onChange={(event) =>
										setVariableValues((current) => ({ ...current, [name]: event.target.value }))
									}
								/>
							</label>
						))}
					</div>
				</div>
			) : null}

			<div className="ps-stack">
				<div className="ps-panel-header" style={{ padding: 0, border: 0 }}>
					<span className="ps-label">Targets ({targets.length} of 3)</span>
					<button
						type="button"
						className="ps-button"
						disabled={targets.length >= 3}
						onClick={() =>
							setTargets((current) => [
								...current,
								{
									key: makeKey(),
									promptId: detail.prompt.id,
									versionId: detail.prompt.publishedVersionId ?? detail.versions[0]?.id ?? "",
									provider: defaultProvider,
									model: "",
								},
							])
						}
					>
						<Plus className="size-3.5" aria-hidden />
						Add target
					</button>
				</div>

				{targets.map((target, index) => {
					const omniRoute = providers.find((provider) => provider.id === "omniroute");
					const versionOptions =
						target.promptId === detail.prompt.id
							? detail.versions.map((version) => ({
									id: version.id,
									label: `v${version.version}${version.isPublished ? " (published)" : " (draft)"}`,
								}))
							: (() => {
									const prompt = publishedPrompts.find((entry) => entry.id === target.promptId);
									return prompt?.publishedVersion
										? [{ id: prompt.publishedVersion.id, label: `v${prompt.publishedVersion.version} (published)` }]
										: [];
								})();

					return (
						<div className="ps-variable-row" key={target.key}>
							<label className="ps-field">
								<span className="ps-label">Prompt</span>
								<select
									className="ps-select"
									value={target.promptId}
									onChange={(event) => {
										const nextPromptId = event.target.value;
										const nextVersion =
											nextPromptId === detail.prompt.id
												? (detail.prompt.publishedVersionId ?? detail.versions[0]?.id ?? "")
												: (publishedPrompts.find((entry) => entry.id === nextPromptId)?.publishedVersion?.id ?? "");
										setTargets((current) =>
											current.map((entry, position) =>
												position === index
													? { ...entry, promptId: nextPromptId, versionId: nextVersion }
													: entry,
											),
										);
									}}
								>
									<option value={detail.prompt.id}>{detail.prompt.name} (this prompt)</option>
									{publishedPrompts
										.filter((prompt) => prompt.id !== detail.prompt.id)
										.map((prompt) => (
											<option key={prompt.id} value={prompt.id}>
												{prompt.name}
											</option>
										))}
								</select>
							</label>

							<label className="ps-field">
								<span className="ps-label">Version</span>
								<select
									className="ps-select"
									value={target.versionId}
									onChange={(event) =>
										setTargets((current) =>
											current.map((entry, position) =>
												position === index ? { ...entry, versionId: event.target.value } : entry,
											),
										)
									}
								>
									{versionOptions.length === 0 ? <option value="">No version available</option> : null}
									{versionOptions.map((option) => (
										<option key={option.id} value={option.id}>
											{option.label}
										</option>
									))}
								</select>
							</label>

							<label className="ps-field">
								<span className="ps-label">Provider / model</span>
								<select
									className="ps-select"
									value={`${target.provider}::${target.model}`}
									onChange={(event) => {
										const [provider, model] = event.target.value.split("::");
										setTargets((current) =>
											current.map((entry, position) =>
												position === index
													? {
															...entry,
															provider: (provider ?? defaultProvider) as TargetDraft["provider"],
															model: model ?? "",
														}
													: entry,
											),
										);
									}}
								>
									{providers.map((provider) => (
										<optgroup key={provider.id} label={`${provider.label}${provider.configured ? "" : " (not configured)"}`}>
											<option value={`${provider.id}::`} disabled={!provider.configured}>
												{provider.label} — default ({provider.model})
											</option>
											{provider.id === "omniroute" && omniRoute?.routingModes
												? omniRoute.routingModes.map((mode) => (
														<option key={mode} value={`omniroute::${mode}`} disabled={!provider.configured}>
															OmniRoute — {mode}
														</option>
													))
												: null}
										</optgroup>
									))}
								</select>
							</label>

							{targets.length > 1 ? (
								<button
									type="button"
									className="ps-button"
									data-variant="danger"
									aria-label={`Remove target ${index + 1}`}
									onClick={() =>
										setTargets((current) => current.filter((_, position) => position !== index))
									}
								>
									<X className="size-3.5" aria-hidden />
									Remove
								</button>
							) : (
								<span aria-hidden />
							)}
						</div>
					);
				})}
			</div>

			{error ? (
				<p className="ps-notice" data-tone="error" role="alert">
					{error}
				</p>
			) : null}

			<div className="ps-actions">
				<button
					type="button"
					className="ps-button"
					data-variant="primary"
					onClick={run}
					disabled={running || configured.length === 0}
				>
					<Play className="size-3.5" aria-hidden />
					{running ? "Running…" : targets.length > 1 ? "Run comparison" : "Run test"}
				</button>
			</div>

			{results.length > 0 ? (
				<div className="ps-targets" data-count={String(results.length)} aria-live="polite">
					{results.map((result) => (
						<article key={result.key} className="ps-panel" style={{ padding: "0.85rem" }}>
							<div className="ps-target-head">
								<span className="ps-panel-title">{result.versionLabel}</span>
								<span className="ps-badge" data-tone={result.state === "error" ? "high" : "accent"}>
									{result.state}
								</span>
							</div>
							<p className="ps-measured">
								{result.provider}
								{result.resolvedModel ? ` · ${result.resolvedModel}` : ""}
								{result.latencyMs !== null ? ` · ${result.latencyMs} ms measured` : ""}
								{result.characters !== null ? ` · ${result.characters.toLocaleString("en-US")} chars` : ""}
							</p>
							{result.state === "error" ? (
								<p className="ps-notice" data-tone="error">
									{result.error}
								</p>
							) : (
								<pre className="ps-output">{result.text || "Waiting for output…"}</pre>
							)}
						</article>
					))}
				</div>
			) : null}
		</div>
	);
}
