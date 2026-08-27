"use client";

import { useCallback, useEffect, useState } from "react";

import { ExternalReferencePanel } from "./ExternalReferencePanel";
import { PromptEditorPanel } from "./PromptEditorPanel";
import { PromptEvaluationPanel } from "./PromptEvaluationPanel";
import { PromptLibrary, type LibraryFilter } from "./PromptLibrary";
import { PromptRunPanel } from "./PromptRunPanel";
import { PromptVersionsPanel } from "./PromptVersionsPanel";
import {
	readApiError,
	type ProviderDescriptor,
	type PromptDetailResponse,
	type PromptSummary,
} from "./types";

type TabId = "editor" | "versions" | "run" | "assign" | "evaluate" | "references";

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
	{ id: "editor", label: "Editor" },
	{ id: "versions", label: "Versions" },
	{ id: "run", label: "Test & compare" },
	{ id: "assign", label: "Assignments" },
	{ id: "evaluate", label: "Evaluate" },
	{ id: "references", label: "External references" },
];

export function PromptStudio() {
	const [prompts, setPrompts] = useState<readonly PromptSummary[]>([]);
	const [providers, setProviders] = useState<readonly ProviderDescriptor[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<PromptDetailResponse | null>(null);
	const [openVersionId, setOpenVersionId] = useState<string | null>(null);
	const [tab, setTab] = useState<TabId>("editor");
	const [filter, setFilter] = useState<LibraryFilter>("ALL");
	const [search, setSearch] = useState("");
	const [loadingList, setLoadingList] = useState(true);
	const [loadingDetail, setLoadingDetail] = useState(false);
	const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
	const [busy, setBusy] = useState(false);

	const loadPrompts = useCallback(async () => {
		setLoadingList(true);
		try {
			const response = await fetch("/api/prompts", { credentials: "include", cache: "no-store" });
			if (!response.ok) {
				setBanner({ tone: "error", text: await readApiError(response, "Could not load prompts.") });
				return;
			}
			const body = (await response.json()) as { prompts: readonly PromptSummary[] };
			setPrompts(body.prompts);
			setSelectedId((current) => current ?? body.prompts[0]?.id ?? null);
		} catch {
			setBanner({ tone: "error", text: "Prompt library could not be reached." });
		} finally {
			setLoadingList(false);
		}
	}, []);

	useEffect(() => {
		void loadPrompts();
		void fetch("/api/prompts/run", { credentials: "include", cache: "no-store" })
			.then(async (response) => (response.ok ? await response.json() : { providers: [] }))
			.then((body: { providers?: readonly ProviderDescriptor[] }) => setProviders(body.providers ?? []))
			.catch(() => setProviders([]));
	}, [loadPrompts]);

	const loadDetail = useCallback(async (promptId: string) => {
		setLoadingDetail(true);
		try {
			const response = await fetch(`/api/prompts/${promptId}`, {
				credentials: "include",
				cache: "no-store",
			});
			if (!response.ok) {
				setBanner({ tone: "error", text: await readApiError(response, "Could not load this prompt.") });
				setDetail(null);
				return;
			}
			setDetail((await response.json()) as PromptDetailResponse);
		} catch {
			setBanner({ tone: "error", text: "Prompt could not be reached." });
		} finally {
			setLoadingDetail(false);
		}
	}, []);

	useEffect(() => {
		if (!selectedId) {
			setDetail(null);
			return;
		}
		void loadDetail(selectedId);
	}, [selectedId, loadDetail]);

	const refresh = useCallback(async () => {
		await loadPrompts();
		if (selectedId) await loadDetail(selectedId);
	}, [loadPrompts, loadDetail, selectedId]);

	const createPrompt = useCallback(async () => {
		setBusy(true);
		setBanner(null);
		try {
			const response = await fetch("/api/prompts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					name: "Untitled prompt",
					description: "",
					category: "general",
					body: "# Role\n\nWrite for {{audience}}.\n\n# Task\n\n# Output format\n",
					variables: [{ name: "audience", defaultValue: "an informed reader" }],
				}),
			});
			if (!response.ok) {
				setBanner({ tone: "error", text: await readApiError(response, "Could not create a prompt.") });
				return;
			}
			const body = (await response.json()) as { prompt: { id: string } };
			await loadPrompts();
			setSelectedId(body.prompt.id);
			setTab("editor");
		} catch {
			setBanner({ tone: "error", text: "Prompt could not be created." });
		} finally {
			setBusy(false);
		}
	}, [loadPrompts]);

	const installStarterPack = useCallback(async () => {
		setBusy(true);
		setBanner(null);
		try {
			const response = await fetch("/api/prompts/starter-pack", {
				method: "POST",
				credentials: "include",
			});
			if (!response.ok) {
				setBanner({ tone: "error", text: await readApiError(response, "Install failed.") });
				return;
			}
			const body = (await response.json()) as { installed: number; skipped: number };
			setBanner({
				tone: "ok",
				text: `Installed ${body.installed} AIRA template${body.installed === 1 ? "" : "s"}${
					body.skipped > 0 ? `, skipped ${body.skipped} already present` : ""
				}.`,
			});
			await loadPrompts();
		} catch {
			setBanner({ tone: "error", text: "Starter pack could not be installed." });
		} finally {
			setBusy(false);
		}
	}, [loadPrompts]);

	const lifecycle = useCallback(
		async (action: string) => {
			if (!selectedId) return;
			setBusy(true);
			setBanner(null);
			try {
				const response = await fetch(`/api/prompts/${selectedId}/lifecycle`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({ action }),
				});
				if (!response.ok) {
					setBanner({ tone: "error", text: await readApiError(response, "Action failed.") });
					return;
				}
				if (action === "duplicate") {
					const body = (await response.json()) as { prompt: { id: string } };
					await loadPrompts();
					setSelectedId(body.prompt.id);
				} else {
					await refresh();
				}
				setBanner({ tone: "ok", text: "Done." });
			} catch {
				setBanner({ tone: "error", text: "Action could not be completed." });
			} finally {
				setBusy(false);
			}
		},
		[selectedId, refresh, loadPrompts],
	);

	const assign = useCallback(
		async (scope: "WORKSPACE" | "CONVERSATION" | "AGENT", targetKey: string) => {
			if (!detail) return;
			setBusy(true);
			setBanner(null);
			try {
				const response = await fetch("/api/prompts/assignments", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({ scope, targetKey, promptId: detail.prompt.id }),
				});
				if (!response.ok) {
					setBanner({ tone: "error", text: await readApiError(response, "Assignment failed.") });
					return;
				}
				setBanner({
					tone: "ok",
					text:
						scope === "WORKSPACE"
							? "Set as the workspace default. Chat requests without an explicit choice now use it."
							: `Assigned to ${scope.toLowerCase()} ${targetKey}.`,
				});
			} catch {
				setBanner({ tone: "error", text: "Assignment could not be saved." });
			} finally {
				setBusy(false);
			}
		},
		[detail],
	);

	return (
		<div className="ps-shell">
			<PromptLibrary
				prompts={prompts}
				selectedId={selectedId}
				filter={filter}
				search={search}
				loading={loadingList}
				onSelect={(id) => {
					setSelectedId(id);
					setOpenVersionId(null);
					setTab("editor");
				}}
				onFilterChange={setFilter}
				onSearchChange={setSearch}
				onCreate={createPrompt}
			/>

			<section className="ps-panel" aria-labelledby="ps-detail-heading">
				<div className="ps-panel-header">
					<div>
						<h2 className="ps-panel-title" id="ps-detail-heading">
							{detail ? detail.prompt.name : "Prompt"}
						</h2>
						{detail ? (
							<p className="ps-list-meta">
								<span className="ps-badge" data-tone={detail.prompt.status.toLowerCase()}>
									{detail.prompt.status.toLowerCase()}
								</span>
								<span>{detail.versions.length} versions</span>
								<span>{detail.prompt.category}</span>
								{detail.prompt.externalSource ? (
									<span className="ps-badge">derived from {detail.prompt.externalSource.path}</span>
								) : null}
							</p>
						) : null}
					</div>
					{detail ? (
						<div className="ps-actions">
							<button type="button" className="ps-button" disabled={busy} onClick={() => lifecycle("duplicate")}>
								Duplicate
							</button>
							{detail.prompt.status === "ARCHIVED" ? (
								<button type="button" className="ps-button" disabled={busy} onClick={() => lifecycle("restore")}>
									Restore
								</button>
							) : (
								<button type="button" className="ps-button" disabled={busy} onClick={() => lifecycle("archive")}>
									Archive
								</button>
							)}
							{detail.prompt.status === "PUBLISHED" ? (
								<button type="button" className="ps-button" disabled={busy} onClick={() => lifecycle("unpublish")}>
									Unpublish
								</button>
							) : null}
						</div>
					) : (
						<button type="button" className="ps-button" onClick={installStarterPack} disabled={busy}>
							Install AIRA starter pack
						</button>
					)}
				</div>

				{banner ? (
					<div style={{ padding: "0.75rem 1rem 0" }}>
						<p className="ps-notice" data-tone={banner.tone} role="status">
							{banner.text}
						</p>
					</div>
				) : null}

				<div className="ps-tabs" role="tablist" aria-label="Prompt sections">
					{TABS.map((entry) => (
						<button
							key={entry.id}
							type="button"
							role="tab"
							id={`ps-tab-${entry.id}`}
							aria-selected={tab === entry.id}
							aria-controls={`ps-panel-${entry.id}`}
							className="ps-tab"
							onClick={() => setTab(entry.id)}
						>
							{entry.label}
						</button>
					))}
				</div>

				<div role="tabpanel" id={`ps-panel-${tab}`} aria-labelledby={`ps-tab-${tab}`} tabIndex={-1}>
					{tab === "references" ? (
						<ExternalReferencePanel onDerived={refresh} />
					) : loadingDetail ? (
						<p className="ps-empty">Loading prompt…</p>
					) : !detail ? (
						<div className="ps-empty">
							<p>
								No prompt selected. Create one from the library, or install the AIRA starter pack to
								begin from curated, AIRA-native templates.
							</p>
							<div className="ps-actions" style={{ justifyContent: "center", marginTop: "1rem" }}>
								<button type="button" className="ps-button" onClick={createPrompt} disabled={busy}>
									New prompt
								</button>
								<button
									type="button"
									className="ps-button"
									data-variant="primary"
									onClick={installStarterPack}
									disabled={busy}
								>
									Install AIRA starter pack
								</button>
							</div>
						</div>
					) : tab === "editor" ? (
						<PromptEditorPanel detail={detail} baseVersionId={openVersionId} onChanged={refresh} />
					) : tab === "versions" ? (
						<PromptVersionsPanel
							detail={detail}
							onChanged={refresh}
							onOpenVersion={(versionId) => {
								setOpenVersionId(versionId);
								setTab("editor");
							}}
						/>
					) : tab === "run" ? (
						<PromptRunPanel detail={detail} prompts={prompts} providers={providers} />
					) : tab === "evaluate" ? (
						<PromptEvaluationPanel detail={detail} providers={providers} />
					) : (
						<AssignmentPanel detail={detail} busy={busy} onAssign={assign} />
					)}
				</div>
			</section>
		</div>
	);
}

function AssignmentPanel({
	detail,
	busy,
	onAssign,
}: {
	readonly detail: PromptDetailResponse;
	readonly busy: boolean;
	readonly onAssign: (scope: "WORKSPACE" | "CONVERSATION" | "AGENT", targetKey: string) => void;
}) {
	const [conversationId, setConversationId] = useState("");
	const [agentKey, setAgentKey] = useState("");
	const publishable = detail.prompt.status === "PUBLISHED" && detail.prompt.publishedVersionId !== null;

	return (
		<div className="ps-panel-body ps-stack">
			<p className="ps-hint">
				Assignments bind the published version to a runtime surface. Scope is always explicit —
				assigning to one conversation or agent never changes the workspace default. Unpinned
				assignments follow future publishes; pinning holds a specific version.
			</p>

			{!publishable ? (
				<p className="ps-notice">
					Publish a version before assigning this prompt. Drafts run in the playground only.
				</p>
			) : null}

			<div className="ps-stack">
				<h3 className="ps-panel-title">Workspace default</h3>
				<p className="ps-hint">Applies to chat requests that do not choose a template explicitly.</p>
				<div className="ps-actions">
					<button
						type="button"
						className="ps-button"
						data-variant="primary"
						disabled={busy || !publishable}
						onClick={() => onAssign("WORKSPACE", "workspace")}
					>
						Set as workspace default
					</button>
				</div>
			</div>

			<div className="ps-stack">
				<h3 className="ps-panel-title">Single conversation</h3>
				<label className="ps-field">
					<span className="ps-label">Conversation id</span>
					<input
						className="ps-input"
						value={conversationId}
						onChange={(event) => setConversationId(event.target.value)}
						placeholder="Paste a conversation id"
					/>
				</label>
				<div className="ps-actions">
					<button
						type="button"
						className="ps-button"
						disabled={busy || !publishable || !conversationId.trim()}
						onClick={() => onAssign("CONVERSATION", conversationId.trim())}
					>
						Assign to conversation
					</button>
				</div>
			</div>

			<div className="ps-stack">
				<h3 className="ps-panel-title">Agent</h3>
				<label className="ps-field">
					<span className="ps-label">Agent graph id</span>
					<input
						className="ps-input"
						value={agentKey}
						onChange={(event) => setAgentKey(event.target.value)}
						placeholder="Agent graph identifier"
					/>
					<span className="ps-hint">
						The agent references the published version rather than copying its body, so republishing
						updates the agent unless the assignment is pinned.
					</span>
				</label>
				<div className="ps-actions">
					<button
						type="button"
						className="ps-button"
						disabled={busy || !publishable || !agentKey.trim()}
						onClick={() => onAssign("AGENT", agentKey.trim())}
					>
						Assign to agent
					</button>
				</div>
			</div>
		</div>
	);
}
