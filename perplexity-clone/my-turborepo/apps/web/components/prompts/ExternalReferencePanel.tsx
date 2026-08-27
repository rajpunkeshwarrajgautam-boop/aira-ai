"use client";

import { useCallback, useEffect, useState } from "react";

import { readApiError, type ExternalSourceView } from "./types";

interface CorpusInfo {
	readonly repository: string;
	readonly url: string;
	readonly allowedPaths: readonly string[];
	readonly licenseNotice: string;
	readonly maxBytes: number;
}

/**
 * External reference catalog.
 *
 * Material is pasted in explicitly with its repository path and commit SHA, so
 * every stored row can be traced to an exact revision. Nothing here is fetched
 * on a chat request, and a reference is never usable as a prompt — the only
 * path forward is an AIRA-native draft that does not copy the reference text.
 */
export function ExternalReferencePanel({ onDerived }: { readonly onDerived: () => void }) {
	const [corpus, setCorpus] = useState<CorpusInfo | null>(null);
	const [sources, setSources] = useState<readonly ExternalSourceView[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
	const [path, setPath] = useState("prompts/gpts/");
	const [commitSha, setCommitSha] = useState("");
	const [body, setBody] = useState("");

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await fetch("/api/prompts/external", { credentials: "include", cache: "no-store" });
			if (!response.ok) return;
			const data = (await response.json()) as {
				corpus: CorpusInfo;
				sources: readonly ExternalSourceView[];
			};
			setCorpus(data.corpus);
			setSources(data.sources);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const ingest = useCallback(async () => {
		if (!corpus) return;
		setBusy(true);
		setMessage(null);
		try {
			const response = await fetch("/api/prompts/external", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ repository: corpus.repository, path, commitSha, body }),
			});
			if (!response.ok) {
				setMessage({ tone: "error", text: await readApiError(response, "Ingestion failed.") });
				return;
			}
			setMessage({
				tone: "ok",
				text: "Stored as untrusted reference data with provenance. It is not runnable as a prompt.",
			});
			setBody("");
			await load();
		} catch {
			setMessage({ tone: "error", text: "Ingestion could not be completed." });
		} finally {
			setBusy(false);
		}
	}, [corpus, path, commitSha, body, load]);

	const derive = useCallback(
		async (sourceId: string) => {
			setBusy(true);
			setMessage(null);
			try {
				const response = await fetch("/api/prompts/external", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({ sourceId, action: "derive-template" }),
				});
				if (!response.ok) {
					setMessage({ tone: "error", text: await readApiError(response, "Could not create a draft.") });
					return;
				}
				setMessage({
					tone: "ok",
					text: "Created an AIRA-native draft with an authoring scaffold. The reference text was not copied.",
				});
				await load();
				onDerived();
			} catch {
				setMessage({ tone: "error", text: "Draft could not be created." });
			} finally {
				setBusy(false);
			}
		},
		[load, onDerived],
	);

	const remove = useCallback(
		async (sourceId: string) => {
			setBusy(true);
			try {
				await fetch("/api/prompts/external", {
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({ sourceId }),
				});
				await load();
			} finally {
				setBusy(false);
			}
		},
		[load],
	);

	return (
		<div className="ps-panel-body ps-stack">
			<p className="ps-hint">
				Reference material is research input, never runtime instruction. Ingestion parses metadata
				only — nothing in a reference body is executed, and no chat request ever fetches from an
				external corpus.
			</p>

			{corpus ? (
				<p className="ps-notice">
					Approved corpus:{" "}
					<a href={corpus.url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--ps-accent)" }}>
						{corpus.repository}
					</a>
					. Accepted paths: {corpus.allowedPaths.join(", ")}. {corpus.licenseNotice}
				</p>
			) : null}

			{message ? (
				<p className="ps-notice" data-tone={message.tone} role="status">
					{message.text}
				</p>
			) : null}

			<div className="ps-grid ps-grid-2">
				<label className="ps-field">
					<span className="ps-label">Path in repository</span>
					<input className="ps-input" value={path} onChange={(event) => setPath(event.target.value)} />
				</label>
				<label className="ps-field">
					<span className="ps-label">Commit SHA</span>
					<input
						className="ps-input"
						value={commitSha}
						placeholder="40-character commit hash"
						onChange={(event) => setCommitSha(event.target.value)}
					/>
				</label>
			</div>

			<label className="ps-field">
				<span className="ps-label">File contents</span>
				<textarea
					className="ps-textarea ps-textarea-sm"
					value={body}
					spellCheck={false}
					onChange={(event) => setBody(event.target.value)}
				/>
				<span className="ps-hint">
					Paste the file at that revision. It is hashed and stored with provenance so the reference
					can always be traced back.
				</span>
			</label>

			<div className="ps-actions">
				<button
					type="button"
					className="ps-button"
					data-variant="primary"
					onClick={ingest}
					disabled={busy || !path.trim() || !commitSha.trim() || !body.trim()}
				>
					{busy ? "Working…" : "Add reference"}
				</button>
			</div>

			<h3 className="ps-panel-title">Catalog</h3>
			{loading ? (
				<p className="ps-empty">Loading references…</p>
			) : sources.length === 0 ? (
				<p className="ps-empty">No external references stored.</p>
			) : (
				<div className="ps-table-wrap">
					<table className="ps-table">
						<thead>
							<tr>
								<th scope="col">Title</th>
								<th scope="col">Provenance</th>
								<th scope="col">Findings</th>
								<th scope="col">Status</th>
								<th scope="col">Actions</th>
							</tr>
						</thead>
						<tbody>
							{sources.map((source) => (
								<tr key={source.id}>
									<th scope="row" style={{ color: "var(--ps-text)" }}>
										{source.title}
									</th>
									<td>
										<a href={source.url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--ps-accent)" }}>
											{source.path}
										</a>
										<br />@ {source.commitSha.slice(0, 12)}
										<br />
										sha256 {source.contentHash.slice(0, 12)}
									</td>
									<td>
										{source.analysis?.counts
											? `${source.analysis.counts.high} high / ${source.analysis.counts.warning} warn`
											: "—"}
									</td>
									<td>
										<span className="ps-badge">{source.transformationStatus.toLowerCase()}</span>
									</td>
									<td>
										<div className="ps-actions">
											<button
												type="button"
												className="ps-button"
												disabled={busy}
												onClick={() => derive(source.id)}
											>
												Draft AIRA template
											</button>
											<button
												type="button"
												className="ps-button"
												data-variant="danger"
												disabled={busy}
												onClick={() => remove(source.id)}
											>
												Delete
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
