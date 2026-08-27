"use client";

import { useState } from "react";

import { readApiError, type PromptDetailResponse, type PromptVersionView } from "./types";

function diffSummary(a: PromptVersionView, b: PromptVersionView): string {
	if (a.contentHash === b.contentHash) return "Bodies are identical.";
	const delta = b.body.length - a.body.length;
	const sign = delta > 0 ? "+" : "";
	return `Bodies differ. Length change: ${sign}${delta.toLocaleString("en-US")} characters.`;
}

export function PromptVersionsPanel({
	detail,
	onChanged,
	onOpenVersion,
}: {
	readonly detail: PromptDetailResponse;
	readonly onChanged: () => void;
	readonly onOpenVersion: (versionId: string) => void;
}) {
	const [busyId, setBusyId] = useState<string | null>(null);
	const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
	const [compareA, setCompareA] = useState<string>(detail.versions[1]?.id ?? "");
	const [compareB, setCompareB] = useState<string>(detail.versions[0]?.id ?? "");

	async function lifecycle(action: string, versionId?: string, id?: string) {
		setBusyId(id ?? action);
		setMessage(null);
		try {
			const response = await fetch(`/api/prompts/${detail.prompt.id}/lifecycle`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(versionId ? { action, versionId } : { action }),
			});
			if (!response.ok) {
				setMessage({ tone: "error", text: await readApiError(response, "Action failed.") });
				return;
			}
			setMessage({
				tone: "ok",
				text:
					action === "publish"
						? "Published. Unpinned assignments now follow this version."
						: action === "restore-version"
							? "Restored as a new version. History is unchanged."
							: "Done.",
			});
			onChanged();
		} catch {
			setMessage({ tone: "error", text: "Action could not be completed." });
		} finally {
			setBusyId(null);
		}
	}

	const left = detail.versions.find((version) => version.id === compareA);
	const right = detail.versions.find((version) => version.id === compareB);

	return (
		<div className="ps-panel-body ps-stack">
			{message ? (
				<p className="ps-notice" data-tone={message.tone} role="status">
					{message.text}
				</p>
			) : null}

			<p className="ps-hint">
				Versions are immutable. Saving an edit appends a new version, and restoring an old one writes
				its body forward as a new version rather than rewriting history.
			</p>

			<div className="ps-table-wrap">
				<table className="ps-table">
					<caption className="ps-hint" style={{ captionSide: "bottom", textAlign: "left", paddingTop: "0.5rem" }}>
						Version history for {detail.prompt.name}
					</caption>
					<thead>
						<tr>
							<th scope="col">Version</th>
							<th scope="col">Created</th>
							<th scope="col">Findings</th>
							<th scope="col">Note</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					<tbody>
						{detail.versions.map((version) => (
							<tr key={version.id}>
								<th scope="row" style={{ color: "var(--ps-text)" }}>
									v{version.version}{" "}
									{version.isPublished ? (
										<span className="ps-badge" data-tone="published">
											published
										</span>
									) : null}
								</th>
								<td>{new Date(version.createdAt).toLocaleString()}</td>
								<td>
									{version.securityMaxSeverity ? (
										<span className="ps-badge" data-tone={version.securityMaxSeverity}>
											{version.securityMaxSeverity}
										</span>
									) : (
										<span className="ps-badge">clean</span>
									)}
								</td>
								<td>{version.notes ?? "—"}</td>
								<td>
									<div className="ps-actions">
										<button
											type="button"
											className="ps-button"
											onClick={() => onOpenVersion(version.id)}
										>
											Open
										</button>
										{!version.isPublished ? (
											<button
												type="button"
												className="ps-button"
												data-variant="primary"
												disabled={busyId !== null}
												onClick={() => lifecycle("publish", version.id, version.id)}
											>
												Publish
											</button>
										) : null}
										{!version.isPublished ? (
											<button
												type="button"
												className="ps-button"
												disabled={busyId !== null}
												onClick={() => lifecycle("restore-version", version.id, `restore-${version.id}`)}
											>
												Restore forward
											</button>
										) : null}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{detail.versions.length > 1 ? (
				<section className="ps-stack" aria-labelledby="ps-version-compare">
					<h3 className="ps-panel-title" id="ps-version-compare">
						Compare versions
					</h3>
					<div className="ps-grid ps-grid-2">
						<label className="ps-field">
							<span className="ps-label">Base</span>
							<select
								className="ps-select"
								value={compareA}
								onChange={(event) => setCompareA(event.target.value)}
							>
								{detail.versions.map((version) => (
									<option key={version.id} value={version.id}>
										v{version.version}
									</option>
								))}
							</select>
						</label>
						<label className="ps-field">
							<span className="ps-label">Compare with</span>
							<select
								className="ps-select"
								value={compareB}
								onChange={(event) => setCompareB(event.target.value)}
							>
								{detail.versions.map((version) => (
									<option key={version.id} value={version.id}>
										v{version.version}
									</option>
								))}
							</select>
						</label>
					</div>
					{left && right ? (
						<>
							<p className="ps-notice">{diffSummary(left, right)}</p>
							<div className="ps-targets" data-count="2">
								<article>
									<div className="ps-target-head">
										<span className="ps-panel-title">v{left.version}</span>
										<span className="ps-measured">{left.contentHash.slice(0, 12)}</span>
									</div>
									<pre className="ps-output">{left.body}</pre>
								</article>
								<article>
									<div className="ps-target-head">
										<span className="ps-panel-title">v{right.version}</span>
										<span className="ps-measured">{right.contentHash.slice(0, 12)}</span>
									</div>
									<pre className="ps-output">{right.body}</pre>
								</article>
							</div>
						</>
					) : null}
				</section>
			) : null}
		</div>
	);
}
