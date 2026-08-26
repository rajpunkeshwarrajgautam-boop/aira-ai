"use client";

import { Plus, Search } from "lucide-react";
import { useMemo } from "react";

import type { PromptStatusValue, PromptSummary } from "./types";

export type LibraryFilter = "ALL" | PromptStatusValue | "AIRA" | "EXTERNAL";

const FILTERS: readonly { readonly id: LibraryFilter; readonly label: string }[] = [
	{ id: "ALL", label: "All" },
	{ id: "DRAFT", label: "Drafts" },
	{ id: "PUBLISHED", label: "Published" },
	{ id: "ARCHIVED", label: "Archived" },
	{ id: "AIRA", label: "AIRA templates" },
	{ id: "EXTERNAL", label: "Derived" },
];

function statusTone(status: PromptStatusValue): string {
	if (status === "PUBLISHED") return "published";
	if (status === "ARCHIVED") return "archived";
	return "draft";
}

export function PromptLibrary({
	prompts,
	selectedId,
	filter,
	search,
	loading,
	onSelect,
	onFilterChange,
	onSearchChange,
	onCreate,
}: {
	readonly prompts: readonly PromptSummary[];
	readonly selectedId: string | null;
	readonly filter: LibraryFilter;
	readonly search: string;
	readonly loading: boolean;
	readonly onSelect: (id: string) => void;
	readonly onFilterChange: (filter: LibraryFilter) => void;
	readonly onSearchChange: (value: string) => void;
	readonly onCreate: () => void;
}) {
	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return prompts.filter((prompt) => {
			if (filter === "AIRA" && prompt.origin !== "AIRA_NATIVE") return false;
			if (filter === "EXTERNAL" && prompt.origin !== "EXTERNAL_DERIVED") return false;
			if (
				(filter === "DRAFT" || filter === "PUBLISHED" || filter === "ARCHIVED") &&
				prompt.status !== filter
			) {
				return false;
			}
			if (!needle) return true;
			return (
				prompt.name.toLowerCase().includes(needle) ||
				(prompt.description ?? "").toLowerCase().includes(needle) ||
				prompt.tags.some((tag) => tag.toLowerCase().includes(needle))
			);
		});
	}, [prompts, filter, search]);

	return (
		<section className="ps-panel ps-library" aria-labelledby="ps-library-heading">
			<div className="ps-panel-header">
				<h2 className="ps-panel-title" id="ps-library-heading">
					Library
				</h2>
				<button type="button" className="ps-button" onClick={onCreate}>
					<Plus className="size-3.5" aria-hidden />
					New prompt
				</button>
			</div>
			<div className="ps-panel-body">
				<label className="ps-field">
					<span className="ps-label">
						<Search className="size-3 inline" aria-hidden /> Search prompts
					</span>
					<input
						className="ps-search"
						type="search"
						value={search}
						placeholder="Name, description or tag"
						onChange={(event) => onSearchChange(event.target.value)}
					/>
				</label>

				<div className="ps-filters" role="group" aria-label="Filter prompts">
					{FILTERS.map((entry) => (
						<button
							key={entry.id}
							type="button"
							className="ps-filter"
							aria-pressed={filter === entry.id}
							onClick={() => onFilterChange(entry.id)}
						>
							{entry.label}
						</button>
					))}
				</div>

				{loading ? (
					<p className="ps-empty">Loading prompts…</p>
				) : visible.length === 0 ? (
					<p className="ps-empty">
						{prompts.length === 0
							? "No prompts yet. Create one, or install the AIRA starter pack from the Templates tab."
							: "No prompts match this filter."}
					</p>
				) : (
					<ul className="ps-list">
						{visible.map((prompt) => (
							<li key={prompt.id} className="ps-list-item">
								<button
									type="button"
									className="ps-list-button"
									aria-current={prompt.id === selectedId}
									onClick={() => onSelect(prompt.id)}
								>
									<span className="ps-list-name">{prompt.name}</span>
									<span className="ps-list-meta">
										<span className="ps-badge" data-tone={statusTone(prompt.status)}>
											{prompt.status.toLowerCase()}
										</span>
										{prompt.publishedVersion ? <span>v{prompt.publishedVersion.version}</span> : null}
										<span>
											{prompt.versionCount} version{prompt.versionCount === 1 ? "" : "s"}
										</span>
										{prompt.origin === "AIRA_NATIVE" ? (
											<span className="ps-badge" data-tone="accent">
												AIRA
											</span>
										) : null}
										{prompt.origin === "EXTERNAL_DERIVED" ? (
											<span className="ps-badge">derived</span>
										) : null}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
