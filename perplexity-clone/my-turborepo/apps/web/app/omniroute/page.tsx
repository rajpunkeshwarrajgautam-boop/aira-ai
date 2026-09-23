"use client";

import { CheckCircle2, Copy, Gauge, Loader2, Play, RefreshCw, Route, Search, Server, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import {
OMNIROUTE_DISABLED_ROUTING_MODES,
OMNIROUTE_ROUTING_MODES,
} from "@services/omniroute/routing";

type Status = {
	enabled: boolean;
	configured: boolean;
	connected: boolean;
	model: string;
	modelCount: number;
	latencyMs?: number;
	gatewayHost?: string | null;
	checkedAt?: string;
	version?: string;
	message?: string;
};

type Model = { id: string; ownedBy?: string };
type ModelsResponse = { models?: Model[]; total?: number; latencyMs?: number; checkedAt?: string; version?: string; error?: { message?: string } };
type TestResponse = { ok?: boolean; model?: string; text?: string; latencyMs?: number; error?: string | { code?: string; message?: string } };

const ROUTING_PRESET_METADATA = {
"auto": { label: "Auto", detail: "Balanced routing" },
"auto/smart": { label: "Smart", detail: "Quality first" },
"auto/coding": { label: "Coding", detail: "Code-optimized" },
"auto/fast": { label: "Fast", detail: "Low latency" },
"auto/offline": { label: "Available", detail: "Capacity first" },
"auto/cheap": { label: "Cheap", detail: "Blocked: validation failed" },
} as const;

const ROUTING_PRESETS = [
...OMNIROUTE_ROUTING_MODES.map((id) => ({
id,
...ROUTING_PRESET_METADATA[id],
validated: true as const,
})),
...OMNIROUTE_DISABLED_ROUTING_MODES.map((id) => ({
id,
...ROUTING_PRESET_METADATA[id],
validated: false as const,
})),
];

function formatCheckedAt(value: string | undefined): string {
	if (!value) return "—";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function OmniRoutePage() {
	const [status, setStatus] = useState<Status | null>(null);
	const [models, setModels] = useState<Model[]>([]);
	const [filter, setFilter] = useState("");
	const [selectedModel, setSelectedModel] = useState("auto");
	const [prompt, setPrompt] = useState("Reply with one short sentence confirming that AIRA can reach OmniRoute.");
	const [testText, setTestText] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [testing, setTesting] = useState(false);

	const loadGateway = useCallback(async () => {
		setLoading(true);
		setMessage(null);
		try {
			const statusResponse = await fetch("/api/omniroute/status", { cache: "no-store" });
			const statusBody = (await statusResponse.json()) as Status & { error?: { message?: string } };
			if (!statusResponse.ok) throw new Error(statusBody.error?.message ?? "Could not load OmniRoute status.");
			setStatus(statusBody);
			setSelectedModel((current) => current === "auto" ? statusBody.model || "auto" : current);

			if (statusBody.configured) {
				const modelsResponse = await fetch("/api/omniroute/models", { cache: "no-store" });
				const modelsBody = (await modelsResponse.json()) as ModelsResponse;
				if (!modelsResponse.ok) throw new Error(modelsBody.error?.message ?? "Could not discover OmniRoute models.");
				setModels(modelsBody.models ?? []);
				setStatus((current) => current ? {
					...current,
					modelCount: modelsBody.total ?? current.modelCount,
					latencyMs: modelsBody.latencyMs ?? current.latencyMs,
					checkedAt: modelsBody.checkedAt ?? current.checkedAt,
					version: modelsBody.version ?? current.version,
				} : current);
			} else {
				setModels([]);
			}
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Could not load OmniRoute.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadGateway();
	}, [loadGateway]);

	const filteredModels = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) return models;
		return models.filter((model) => `${model.id} ${model.ownedBy ?? ""}`.toLowerCase().includes(needle));
	}, [filter, models]);

	const groupedModels = useMemo(() => {
		const groups = new Map<string, Model[]>();
		for (const model of filteredModels) {
			const owner = model.ownedBy?.trim() || "Other";
			const group = groups.get(owner) ?? [];
			group.push(model);
			groups.set(owner, group);
		}
		return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [filteredModels]);

	async function copyModelId(modelId: string) {
		try {
			await navigator.clipboard.writeText(modelId);
			setCopyFeedback(`Copied ${modelId}`);
			window.setTimeout(() => setCopyFeedback(null), 1800);
		} catch {
			setCopyFeedback("Could not copy model ID.");
		}
	}

	async function runTest() {
		if (!status?.configured || !selectedModel.trim() || !prompt.trim()) return;
		setTesting(true);
		setMessage(null);
		setTestText(null);
		try {
			const response = await fetch("/api/omniroute/test", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model: selectedModel.trim(), prompt: prompt.trim() }),
			});
			const body = (await response.json()) as TestResponse;
			if (!response.ok || body.ok === false) {
				const error = typeof body.error === "string" ? body.error : body.error?.message;
				throw new Error(error ?? "OmniRoute inference test failed.");
			}
			setTestText(`${body.text ?? "Connected."}${body.latencyMs !== undefined ? `\n\nLatency: ${body.latencyMs} ms · ${body.model ?? selectedModel}` : ""}`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "OmniRoute inference test failed.");
		} finally {
			setTesting(false);
		}
	}

	const connectionLabel = loading && !status
		? "Checking…"
		: status?.connected
			? "Connected"
			: status?.enabled
				? status?.configured ? "Unreachable" : "Not configured"
				: "Disabled";

	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] sm:px-5 md:px-8 md:py-7">
					<div className="mx-auto max-w-[1500px]">
						<div className="mb-7 flex flex-wrap items-end justify-between gap-4">
							<div>
								<p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">Universal inference gateway</p>
								<h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#111115] md:text-3xl">AIRA Route</h1>
								<p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">Discover models exposed by your AIRA Route (OmniRoute) server, inspect routing profiles, and verify live inference without exposing gateway credentials to the browser.</p>
							</div>
							<button type="button" onClick={() => void loadGateway()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-xs font-medium text-[#111115] shadow-xs transition hover:bg-[#FAF9F6] disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin text-[#3A0CA3]" : ""}`} />Refresh gateway</button>
						</div>

						{message ? <div className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{message}</div> : null}
						{copyFeedback ? <div className="mb-5 rounded-xl border border-[rgba(17,17,21,0.08)] bg-white px-4 py-2 text-xs text-[#111115] shadow-xs" role="status">{copyFeedback}</div> : null}

						<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
							<div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs sm:col-span-2 xl:col-span-2">
								<div className="flex items-start justify-between gap-3">
									<div className="flex items-center gap-3">
										<span className="grid size-10 place-items-center rounded-xl bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]"><Route className="size-5" /></span>
										<div>
											<h2 className="text-sm font-semibold text-[#111115]">Gateway status</h2>
											<p className="mt-1 text-xs text-[#6B6A75]">Server-side connectivity</p>
										</div>
									</div>
									{status?.connected ? <CheckCircle2 className="size-5 text-emerald-600" /> : <XCircle className="size-5 text-[#8F8E98]" />}
								</div>
								<p className="mt-5 text-2xl font-semibold text-[#111115]">{connectionLabel}</p>
								<p className="mt-2 text-xs leading-5 text-[#6B6A75]">{status?.message ?? (status?.connected ? "AIRA can reach the OmniRoute OpenAI-compatible gateway." : "Configure OmniRoute to enable universal routing.")}</p>
							</div>
							<div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs sm:col-span-2 xl:col-span-2">
								<Server className="size-4 text-[#3A0CA3]" />
								<p className="mt-4 truncate text-base font-semibold text-[#111115]">{status?.gatewayHost ?? "—"}</p>
								<p className="mt-1 text-xs text-[#6B6A75]">Gateway host</p>
								<p className="mt-3 text-[10px] text-[#8F8E98]">Version {status?.version ?? "not reported"}</p>
							</div>
							<div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
								<Server className="size-4 text-[#3A0CA3]" />
								<p className="mt-4 text-2xl font-semibold text-[#111115]">{status?.modelCount ?? 0}</p>
								<p className="mt-1 text-xs text-[#6B6A75]">Discovered models</p>
							</div>
							<div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
								<Gauge className="size-4 text-[#3A0CA3]" />
								<p className="mt-4 text-2xl font-semibold text-[#111115]">{status?.latencyMs !== undefined ? `${status.latencyMs} ms` : "—"}</p>
								<p className="mt-1 text-xs text-[#6B6A75]">Discovery latency</p>
							</div>
						</section>

						<div className="mt-3 rounded-xl border border-[rgba(17,17,21,0.08)] bg-white px-4 py-3 text-[11px] text-[#6B6A75] shadow-xs">
							Last gateway check: <span className="font-medium text-[#111115]">{formatCheckedAt(status?.checkedAt)}</span> · Active default: <code className="font-semibold text-[#3A0CA3]">{status?.model ?? "auto"}</code>
						</div>

						<section className="mt-5 rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
							<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
								<div>
									<div className="flex items-center gap-2">
										<h2 className="text-sm font-semibold text-[#111115]">Automatic routing</h2>
										<span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${status?.connected ? "border-emerald-600/20 bg-emerald-50 text-emerald-700" : "border-[rgba(17,17,21,0.12)] bg-[#FAF9F6] text-[#6B6A75]"}`}>
											{status?.connected ? "Live validated" : "Historical Baseline"}
										</span>
									</div>
									<p className="mt-1 max-w-3xl text-xs leading-5 text-[#6B6A75]">
										{status?.connected
											? "Auto, Smart, Coding, Fast, and Available passed AIRA's live routing validation. The Cheap profile remains visible but blocked because it failed the validation gate."
											: "Routing profiles reflect architectural validation gates. Connect the OmniRoute gateway to activate live routing through these presets."}
									</p>
								</div>
							</div>
							<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
								{ROUTING_PRESETS.map((preset) => {
									const isSelectable = Boolean(status?.connected && preset.validated);
									return (
										<button
											key={preset.id}
											type="button"
											disabled={!preset.validated}
											onClick={() => { if (preset.validated) setSelectedModel(preset.id); }}
											title={!status?.connected ? "Connect OmniRoute gateway to enable routing presets" : preset.validated ? `Use ${preset.label} routing` : "Blocked in AIRA because this OmniRoute profile failed live validation"}
											className={`rounded-xl border px-3 py-3 text-left transition ${isSelectable ? (selectedModel === preset.id ? "border-[#3A0CA3]/40 bg-[#3A0CA3]/[0.08] shadow-xs" : "border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] hover:border-[#3A0CA3]/30 hover:bg-white") : "cursor-not-allowed border-[rgba(17,17,21,0.06)] bg-[#F5F4F0] opacity-55"}`}
										>
											<strong className="block text-xs font-semibold text-[#111115]">{preset.label}</strong>
											<span className="mt-1 block text-[10px] text-[#6B6A75]">{preset.detail}</span>
											<code className="mt-2 block truncate text-[9px] text-[#3A0CA3]">{preset.id}</code>
										</button>
									);
								})}
							</div>
						</section>

						<div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
							<section className="overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs">
								<div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] px-5 py-4">
									<div>
										<h2 className="text-sm font-semibold text-[#111115]">Model registry</h2>
										<p className="mt-1 text-xs text-[#6B6A75]">Live from OmniRoute /v1/models · grouped when owner metadata is available</p>
									</div>
									<div className="relative">
										<Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8F8E98]" />
										<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter models" className="h-9 w-full min-w-0 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white pl-9 pr-3 text-xs text-[#111115] outline-none placeholder:text-[#8F8E98] focus:border-[#3A0CA3] sm:w-56" />
									</div>
								</div>
								<div className="max-h-[520px] overflow-y-auto p-2">
									{loading ? (
										<div className="grid place-items-center py-16"><Loader2 className="size-5 animate-spin text-[#3A0CA3]" /></div>
									) : groupedModels.length ? (
										groupedModels.map(([owner, ownerModels]) => (
											<div key={owner} className="mb-2">
												<div className="sticky top-0 z-10 bg-[#FAF9F6] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6B6A75] backdrop-blur">{owner} · {ownerModels.length}</div>
												{ownerModels.map((model) => (
													<div key={model.id} className={`group flex items-center gap-2 rounded-lg transition ${selectedModel === model.id ? "bg-[#3A0CA3]/[0.08]" : "hover:bg-[#FAF9F6]"}`}>
														<button type="button" onClick={() => setSelectedModel(model.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
															<strong className="block truncate text-xs font-medium text-[#111115]">{model.id}</strong>
															{model.ownedBy ? <small className="mt-0.5 block truncate text-[10px] text-[#6B6A75]">{model.ownedBy}</small> : null}
														</button>
														<button type="button" onClick={() => void copyModelId(model.id)} className="mr-2 grid size-8 shrink-0 place-items-center rounded-md text-[#8F8E98] transition hover:bg-[#FAF9F6] hover:text-[#111115]" aria-label={`Copy ${model.id}`}>
															<Copy className="size-3.5" />
														</button>
														{selectedModel === model.id ? <CheckCircle2 className="mr-3 size-4 shrink-0 text-[#3A0CA3]" /> : null}
													</div>
												))}
											</div>
										))
									) : (
										<p className="px-4 py-16 text-center text-xs text-[#6B6A75]">{status?.configured ? "No models matched." : "Configure OmniRoute to discover models."}</p>
									)}
								</div>
							</section>

							<section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
								<div className="mb-4">
									<h2 className="text-sm font-semibold text-[#111115]">Live inference test</h2>
									<p className="mt-1 break-all text-xs text-[#6B6A75]">Selected model: <code className="font-semibold text-[#3A0CA3]">{selectedModel}</code></p>
								</div>
								<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} maxLength={4000} className="w-full resize-y rounded-xl border border-[rgba(17,17,21,0.12)] bg-white px-3 py-3 text-xs leading-5 text-[#111115] outline-none placeholder:text-[#8F8E98] focus:border-[#3A0CA3]" placeholder="Enter a test prompt" />
								<button type="button" onClick={() => void runTest()} disabled={!status?.configured || testing || !prompt.trim()} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#3A0CA3] text-sm font-semibold text-white transition hover:bg-[#2D0A82] shadow-xs disabled:cursor-not-allowed disabled:opacity-40">
									{testing ? <Loader2 className="size-4 animate-spin text-white" /> : <Play className="size-4" />}Run live test
								</button>
								{testText ? <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-emerald-600/20 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">{testText}</pre> : null}
								<div className="mt-5 border-t border-[rgba(17,17,21,0.08)] pt-4">
									<p className="text-[11px] leading-5 text-[#6B6A75]">Runtime configuration uses <code>OMNIROUTE_ENABLED</code>, <code>OMNIROUTE_BASE_URL</code>, <code>OMNIROUTE_API_KEY</code>, and <code>OMNIROUTE_MODEL</code>. The API key stays server-side and the test endpoint is authenticated and rate-limited.</p>
								</div>
							</section>
						</div>
					</div>
				</main>
			</AiraV2Frame>
		</div>
	);
}
