"use client";

import { CheckCircle2, Copy, Gauge, Loader2, Play, RefreshCw, Route, Search, Server, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

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

const ROUTING_PRESETS = [
	{ id: "auto", label: "Auto", detail: "Balanced routing" },
	{ id: "auto/smart", label: "Smart", detail: "Quality first" },
	{ id: "auto/coding", label: "Coding", detail: "Code-optimized" },
	{ id: "auto/fast", label: "Fast", detail: "Low latency" },
	{ id: "auto/cheap", label: "Cheap", detail: "Cost optimized" },
	{ id: "auto/offline", label: "Available", detail: "Capacity first" },
] as const;

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
				<main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-4 py-6 sm:px-5 md:px-8 md:py-7">
					<div className="mx-auto max-w-[1500px]">
						<div className="mb-7 flex flex-wrap items-end justify-between gap-4">
							<div>
								<p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#a98b43]">Universal inference gateway</p>
								<h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#f2f2ee] md:text-3xl">OmniRoute</h1>
								<p className="mt-2 max-w-3xl text-sm leading-6 text-[#8b9098]">Discover models exposed by your OmniRoute server, choose automatic routing modes, and verify live inference without exposing gateway credentials to the browser.</p>
							</div>
							<button type="button" onClick={() => void loadGateway()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#111419] px-3 py-2 text-xs font-medium text-[#abb0b7] transition hover:bg-[#171a1f] disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />Refresh gateway</button>
						</div>

						{message ? <div className="mb-5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-4 py-3 text-sm text-red-200" role="alert">{message}</div> : null}
						{copyFeedback ? <div className="mb-5 rounded-xl border border-white/[0.08] bg-[#111419] px-4 py-2 text-xs text-[#aeb3ba]" role="status">{copyFeedback}</div> : null}

						<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
							<div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5 sm:col-span-2 xl:col-span-2"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#181b20] text-[#c9a84c]"><Route className="size-5" /></span><div><h2 className="text-sm font-semibold text-[#eeeeeb]">Gateway status</h2><p className="mt-1 text-xs text-[#72777f]">Server-side connectivity</p></div></div>{status?.connected ? <CheckCircle2 className="size-5 text-emerald-400" /> : <XCircle className="size-5 text-[#626871]" />}</div><p className="mt-5 text-2xl font-semibold text-[#f0f0ed]">{connectionLabel}</p><p className="mt-2 text-xs leading-5 text-[#777c84]">{status?.message ?? (status?.connected ? "AIRA can reach the OmniRoute OpenAI-compatible gateway." : "Configure OmniRoute to enable universal routing.")}</p></div>
							<div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5 sm:col-span-2 xl:col-span-2"><Server className="size-4 text-[#c9a84c]" /><p className="mt-4 truncate text-base font-semibold text-[#f0f0ed]">{status?.gatewayHost ?? "—"}</p><p className="mt-1 text-xs text-[#72777f]">Gateway host</p><p className="mt-3 text-[10px] text-[#616770]">Version {status?.version ?? "not reported"}</p></div>
							<div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><Server className="size-4 text-[#c9a84c]" /><p className="mt-4 text-2xl font-semibold text-[#f0f0ed]">{status?.modelCount ?? 0}</p><p className="mt-1 text-xs text-[#72777f]">Discovered models</p></div>
							<div className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><Gauge className="size-4 text-[#c9a84c]" /><p className="mt-4 text-2xl font-semibold text-[#f0f0ed]">{status?.latencyMs !== undefined ? `${status.latencyMs} ms` : "—"}</p><p className="mt-1 text-xs text-[#72777f]">Discovery latency</p></div>
						</section>

						<div className="mt-3 rounded-xl border border-white/[0.07] bg-[#0d1014] px-4 py-3 text-[11px] text-[#6f747c]">Last gateway check: <span className="text-[#9ca1a8]">{formatCheckedAt(status?.checkedAt)}</span> · Active default: <code className="text-[#b69a50]">{status?.model ?? "auto"}</code></div>

						<section className="mt-5 rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5">
							<div className="mb-4"><h2 className="text-sm font-semibold text-[#eeeeeb]">Automatic routing</h2><p className="mt-1 text-xs text-[#72777f]">Selection is session-local. Use an OmniRoute profile here or choose a specific discovered model below.</p></div>
							<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{ROUTING_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => setSelectedModel(preset.id)} className={`rounded-xl border px-3 py-3 text-left transition ${selectedModel === preset.id ? "border-[#c9a84c]/45 bg-[#c9a84c]/[0.08]" : "border-white/[0.08] bg-[#12151a] hover:border-white/[0.14]"}`}><strong className="block text-xs font-semibold text-[#ecece8]">{preset.label}</strong><span className="mt-1 block text-[10px] text-[#747981]">{preset.detail}</span><code className="mt-2 block truncate text-[9px] text-[#9c8448]">{preset.id}</code></button>)}</div>
						</section>

						<div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
							<section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1216]">
								<div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4"><div><h2 className="text-sm font-semibold text-[#eeeeeb]">Model registry</h2><p className="mt-1 text-xs text-[#72777f]">Live from OmniRoute /v1/models · grouped when owner metadata is available</p></div><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#656b73]" /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter models" className="h-9 w-full min-w-0 rounded-lg border border-white/[0.08] bg-[#0a0d11] pl-9 pr-3 text-xs text-[#dededb] outline-none placeholder:text-[#5f646c] focus:border-[#c9a84c]/35 sm:w-56" /></div></div>
								<div className="max-h-[520px] overflow-y-auto p-2">{loading ? <div className="grid place-items-center py-16"><Loader2 className="size-5 animate-spin text-[#a98b43]" /></div> : groupedModels.length ? groupedModels.map(([owner, ownerModels]) => <div key={owner} className="mb-2"><div className="sticky top-0 z-10 bg-[#0f1216]/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#646a72] backdrop-blur">{owner} · {ownerModels.length}</div>{ownerModels.map((model) => <div key={model.id} className={`group flex items-center gap-2 rounded-lg transition ${selectedModel === model.id ? "bg-[#c9a84c]/[0.09]" : "hover:bg-white/[0.035]"}`}><button type="button" onClick={() => setSelectedModel(model.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left"><strong className="block truncate text-xs font-medium text-[#dededb]">{model.id}</strong>{model.ownedBy ? <small className="mt-0.5 block truncate text-[10px] text-[#6f747c]">{model.ownedBy}</small> : null}</button><button type="button" onClick={() => void copyModelId(model.id)} className="mr-2 grid size-8 shrink-0 place-items-center rounded-md text-[#5f656d] transition hover:bg-white/[0.05] hover:text-[#c5c8cb]" aria-label={`Copy ${model.id}`}><Copy className="size-3.5" /></button>{selectedModel === model.id ? <CheckCircle2 className="mr-3 size-4 shrink-0 text-[#d0b25c]" /> : null}</div>)}</div>) : <p className="px-4 py-16 text-center text-xs text-[#666c74]">{status?.configured ? "No models matched." : "Configure OmniRoute to discover models."}</p>}</div>
							</section>

							<section className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"><div className="mb-4"><h2 className="text-sm font-semibold text-[#eeeeeb]">Live inference test</h2><p className="mt-1 break-all text-xs text-[#72777f]">Selected model: <code className="text-[#c9a84c]">{selectedModel}</code></p></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} maxLength={4000} className="w-full resize-y rounded-xl border border-white/[0.09] bg-[#0a0d11] px-3 py-3 text-xs leading-5 text-[#dededb] outline-none placeholder:text-[#5f646c] focus:border-[#c9a84c]/35" placeholder="Enter a test prompt" /><button type="button" onClick={() => void runTest()} disabled={!status?.configured || testing || !prompt.trim()} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#d0ae55] text-sm font-semibold text-[#111214] transition hover:bg-[#dfbd63] disabled:cursor-not-allowed disabled:opacity-40">{testing ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Run live test</button>{testText ? <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3 text-xs leading-5 text-emerald-100">{testText}</pre> : null}<div className="mt-5 border-t border-white/[0.06] pt-4"><p className="text-[11px] leading-5 text-[#6d727a]">Runtime configuration uses <code>OMNIROUTE_ENABLED</code>, <code>OMNIROUTE_BASE_URL</code>, <code>OMNIROUTE_API_KEY</code>, and <code>OMNIROUTE_MODEL</code>. The API key stays server-side and the test endpoint is authenticated and rate-limited.</p></div></section>
						</div>
					</div>
				</main>
			</AiraV2Frame>
		</div>
	);
}
