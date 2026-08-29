"use client";

import { Check, Copy, Loader2, Play, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type ProviderId = "openai" | "nvidia" | "omniroute";
type Provider = {
	id: ProviderId;
	label: string;
	configured: boolean;
	model: string;
	routingModes?: string[];
};
type Model = { id: string; ownedBy?: string };
type TargetChoice = {
	key: string;
	provider: ProviderId;
	model: string;
	label: string;
	detail: string;
};
type ResultStatus = "pending" | "streaming" | "success" | "error";
type Result = {
	targetId: string;
	providerId: ProviderId;
	model: string;
	status: ResultStatus;
	text: string;
	latencyMs?: number;
	error?: string;
};
type CompareStreamEvent =
	| {
			type: "start";
			targetId: string;
			providerId: ProviderId;
			model: string;
		}
	| {
			type: "delta";
			targetId: string;
			delta: string;
		}
	| {
			type: "complete";
			targetId: string;
			providerId: ProviderId;
			model: string;
			text: string;
			latencyMs: number;
		}
	| {
			type: "error";
			targetId: string;
			providerId: ProviderId;
			model: string;
			error: string;
		};

const ROUTING_LABELS: Record<string, string> = {
	auto: "Auto",
	"auto/smart": "Smart",
	"auto/coding": "Coding",
	"auto/fast": "Fast",
	"auto/cheap": "Cheap",
	"auto/offline": "Offline / available",
};

function resultForChoice(choice: TargetChoice): Result {
	return {
		targetId: `${choice.provider}:${choice.model}`,
		providerId: choice.provider,
		model: choice.model,
		status: "pending",
		text: "",
	};
}

export default function ComparePage() {
	const [providers, setProviders] = useState<Provider[]>([]);
	const [omniModels, setOmniModels] = useState<Model[]>([]);
	const [slots, setSlots] = useState<[string, string, string]>(["", "", ""]);
	const [prompt, setPrompt] = useState("");
	const [results, setResults] = useState<Result[]>([]);
	const [loading, setLoading] = useState(false);
	const [initializing, setInitializing] = useState(true);
	const [message, setMessage] = useState<string | null>(null);
	const [registryWarning, setRegistryWarning] = useState<string | null>(null);
	const [copiedTargetId, setCopiedTargetId] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			try {
				const response = await fetch("/api/compare", { cache: "no-store" });
				const body = (await response.json()) as {
					providers?: Provider[];
					error?: { message?: string };
				};
				if (!response.ok) {
					throw new Error(body.error?.message ?? "Could not load model providers.");
				}
				const loadedProviders = body.providers ?? [];
				setProviders(loadedProviders);

				const omni = loadedProviders.find(
					(provider) => provider.id === "omniroute" && provider.configured,
				);
				if (omni) {
					try {
						const modelsResponse = await fetch("/api/omniroute/models", {
							cache: "no-store",
						});
						const modelsBody = (await modelsResponse.json()) as {
							models?: Model[];
							error?: { message?: string };
						};
						if (!modelsResponse.ok) {
							throw new Error(
								modelsBody.error?.message ?? "Could not load OmniRoute models.",
							);
						}
						setOmniModels(modelsBody.models ?? []);
					} catch (error) {
						setRegistryWarning(
							error instanceof Error
								? error.message
								: "Live OmniRoute models are unavailable; routing modes still work.",
						);
					}
				}
			} catch (error) {
				setMessage(error instanceof Error ? error.message : "Could not load providers.");
			} finally {
				setInitializing(false);
			}
		})();
	}, []);

	const choices = useMemo<TargetChoice[]>(() => {
		const next: TargetChoice[] = [];
		for (const provider of providers) {
			if (!provider.configured) continue;
			if (provider.id === "omniroute") {
				for (const mode of provider.routingModes ?? ["auto"]) {
					next.push({
						key: `omniroute:${mode}`,
						provider: "omniroute",
						model: mode,
						label: `OmniRoute — ${ROUTING_LABELS[mode] ?? mode}`,
						detail: mode,
					});
				}
				for (const model of omniModels) {
					next.push({
						key: `omniroute:${model.id}`,
						provider: "omniroute",
						model: model.id,
						label: `OmniRoute — ${model.id}`,
						detail: model.ownedBy ?? "discovered model",
					});
				}
			} else {
				next.push({
					key: `${provider.id}:${provider.model}`,
					provider: provider.id,
					model: provider.model,
					label: `${provider.label} — ${provider.model}`,
					detail: "direct provider",
				});
			}
		}
		return next;
	}, [omniModels, providers]);

	useEffect(() => {
		if (initializing || choices.length < 2 || slots[0] || slots[1]) return;
		const preferred = [
			choices.find((choice) => choice.key === "omniroute:auto/smart"),
			choices.find((choice) => choice.key === "omniroute:auto/fast"),
			...choices,
		].filter((choice): choice is TargetChoice => Boolean(choice));
		const unique = [
			...new Map(preferred.map((choice) => [choice.key, choice])).values(),
		];
		setSlots([unique[0]?.key ?? "", unique[1]?.key ?? "", ""]);
	}, [choices, initializing, slots]);

	const selectedChoices = useMemo(
		() =>
			slots
				.filter(Boolean)
				.map((key) => choices.find((choice) => choice.key === key))
				.filter((choice): choice is TargetChoice => Boolean(choice)),
		[choices, slots],
	);
	const uniqueSelectionCount = new Set(selectedChoices.map((choice) => choice.key)).size;

	function updateSlot(index: number, value: string) {
		setSlots((current) => {
			const next: [string, string, string] = [...current];
			next[index] = value;
			return next;
		});
	}

	function applyStreamEvent(event: CompareStreamEvent) {
		setResults((current) =>
			current.map((result) => {
				if (result.targetId !== event.targetId) return result;
				if (event.type === "start") {
					return { ...result, status: "streaming", error: undefined };
				}
				if (event.type === "delta") {
					return {
						...result,
						status: "streaming",
						text: result.text + event.delta,
					};
				}
				if (event.type === "complete") {
					return {
						...result,
						status: "success",
						text: event.text,
						latencyMs: event.latencyMs,
						error: undefined,
					};
				}
				return {
					...result,
					status: "error",
					error: event.error,
				};
			}),
		);
	}

	async function readComparisonStream(response: Response) {
		if (!response.body) throw new Error("Comparison stream was unavailable.");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		const consumeLine = (line: string) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			applyStreamEvent(JSON.parse(trimmed) as CompareStreamEvent);
		};

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) consumeLine(line);
		}

		buffer += decoder.decode();
		consumeLine(buffer);
	}

	async function runComparison() {
		if (
			prompt.trim().length < 2 ||
			selectedChoices.length < 2 ||
			uniqueSelectionCount !== selectedChoices.length
		) {
			return;
		}

		const targets = selectedChoices.map((choice) => ({
			provider: choice.provider,
			model: choice.model,
		}));
		setLoading(true);
		setMessage(null);
		setCopiedTargetId(null);
		setResults(selectedChoices.map(resultForChoice));

		try {
			const response = await fetch("/api/compare", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: prompt.trim(), targets }),
			});
			if (!response.ok) {
				const data = (await response.json()) as { error?: { message?: string } };
				throw new Error(data.error?.message ?? "Comparison failed.");
			}
			await readComparisonStream(response);
			setResults((current) =>
				current.map((result) =>
					result.status === "pending" || result.status === "streaming"
						? {
								...result,
								status: "error",
								error: "The comparison stream ended before this target completed.",
							}
						: result,
				),
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Comparison failed.";
			setMessage(errorMessage);
			setResults((current) =>
				current.map((result) =>
					result.status === "pending" || result.status === "streaming"
						? { ...result, status: "error", error: errorMessage }
						: result,
				),
			);
		} finally {
			setLoading(false);
		}
	}

	async function copyResult(result: Result) {
		if (!result.text) return;
		try {
			await navigator.clipboard.writeText(result.text);
			setCopiedTargetId(result.targetId);
			window.setTimeout(() => {
				setCopiedTargetId((current) => (current === result.targetId ? null : current));
			}, 1600);
		} catch {
			setMessage("Could not copy this result to the clipboard.");
		}
	}

	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<main className="min-h-[calc(100dvh-58px)] bg-[#0a0c0f] px-5 py-7 md:px-8">
					<div className="mx-auto max-w-[1500px]">
						<div className="mb-7 flex flex-wrap items-end justify-between gap-4">
							<div>
								<p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#a98b43]">
									Evaluation lab
								</p>
								<h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#f2f2ee] md:text-3xl">
									Compare models side by side
								</h1>
								<p className="mt-2 max-w-3xl text-sm leading-6 text-[#8b9098]">
									Compare OmniRoute routing modes against one another, fixed models from the live registry, or AIRA&apos;s direct fallback providers. Each target streams and completes independently.
								</p>
							</div>
							<div className="rounded-full border border-white/[0.08] bg-[#111419] px-3 py-1.5 text-xs text-[#8b9098]">
								{choices.length} targets available
							</div>
						</div>

						<section className="rounded-2xl border border-white/[0.08] bg-[#0f1216] p-4 md:p-5">
							<div className="grid gap-3 lg:grid-cols-3">
								{[0, 1, 2].map((index) => (
									<label key={index} className="block">
										<span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-[#747981]">
											Target {index + 1}
											{index === 2 ? " · optional" : ""}
										</span>
										<select
											value={slots[index]}
											onChange={(event) => updateSlot(index, event.target.value)}
											disabled={initializing || loading}
											className="h-11 w-full rounded-xl border border-white/[0.09] bg-[#0b0d10] px-3 text-xs text-[#e2e2de] outline-none focus:border-[#c9a84c]/45 disabled:opacity-40"
										>
											<option value="">Choose a target</option>
											{choices.map((choice) => (
												<option key={choice.key} value={choice.key}>
													{choice.label}
												</option>
											))}
										</select>
										{slots[index] ? (
											<span className="mt-1 block truncate text-[10px] text-[#666c74]">
												{choices.find((choice) => choice.key === slots[index])?.detail}
											</span>
										) : null}
									</label>
								))}
							</div>
							{registryWarning ? (
								<p className="mt-3 rounded-lg border border-amber-400/15 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-100">
									{registryWarning}
								</p>
							) : null}
							{uniqueSelectionCount !== selectedChoices.length ? (
								<p className="mt-3 text-xs text-amber-200">
									Choose distinct targets for each column.
								</p>
							) : null}
							<textarea
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
								disabled={loading}
								rows={5}
								placeholder="Enter one prompt to test across models…"
								className="mt-4 w-full resize-y rounded-xl border border-white/[0.09] bg-[#0b0d10] px-4 py-3 text-sm leading-6 text-[#f0f0ec] outline-none placeholder:text-[#5e636b] focus:border-[#c9a84c]/45 disabled:opacity-70"
							/>
							<div className="mt-3 flex items-center justify-between gap-3">
								<p className="text-xs text-[#6f747c]">
									Select two or three distinct model targets. Completed columns stay visible even if another target fails.
								</p>
								<button
									type="button"
									onClick={() => void runComparison()}
									disabled={
										loading ||
										selectedChoices.length < 2 ||
										uniqueSelectionCount !== selectedChoices.length ||
										prompt.trim().length < 2
									}
									className="inline-flex items-center gap-2 rounded-xl bg-[#d0ae55] px-4 py-2.5 text-sm font-semibold text-[#111214] transition hover:bg-[#dfbd63] disabled:opacity-40"
								>
									{loading ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Play className="size-4" />
									)}
									{loading ? "Comparing…" : "Compare"}
								</button>
							</div>
							{message ? (
								<p
									className="mt-3 rounded-lg border border-red-400/15 bg-red-400/[0.06] px-3 py-2 text-sm text-red-200"
									role="alert"
								>
									{message}
								</p>
							) : null}
						</section>

						<section className="mt-5 grid gap-4 xl:grid-cols-3" aria-live="polite">
							{results.map((result) => {
								const inProgress = result.status === "pending" || result.status === "streaming";
								return (
									<article
										key={result.targetId}
										className="min-h-[360px] rounded-2xl border border-white/[0.08] bg-[#0f1216] p-5"
									>
										<header className="mb-4 flex items-start justify-between gap-3 border-b border-white/[0.07] pb-4">
											<div className="flex min-w-0 items-center gap-3">
												<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#191d23] text-[#c9a84c]">
													<Scale className="size-4" />
												</span>
												<div className="min-w-0">
													<h2 className="text-sm font-semibold text-[#f0f0ed]">
														{providers.find((provider) => provider.id === result.providerId)?.label ?? result.providerId}
													</h2>
													<p className="mt-0.5 truncate text-[11px] text-[#70757d]">
														{result.model}
													</p>
												</div>
											</div>
											<div className="flex shrink-0 items-center gap-2">
												{inProgress ? (
													<span className="inline-flex items-center gap-1.5 text-[11px] text-[#9da2aa]">
														<Loader2 className="size-3 animate-spin" />
														{result.status === "streaming" ? "Streaming" : "Waiting"}
													</span>
												) : result.status === "success" && result.latencyMs !== undefined ? (
													<span className="text-[11px] tabular-nums text-[#70757d]">
														{(result.latencyMs / 1000).toFixed(1)}s
													</span>
												) : (
													<span className="text-[11px] text-red-300">Failed</span>
												)}
												{result.text ? (
													<button
														type="button"
														onClick={() => void copyResult(result)}
														className="grid size-8 place-items-center rounded-lg border border-white/[0.08] text-[#858a92] transition hover:bg-white/[0.04] hover:text-[#e6e7e4]"
														aria-label={`Copy ${result.model} response`}
														title="Copy response"
													>
														{copiedTargetId === result.targetId ? (
															<Check className="size-3.5" />
														) : (
															<Copy className="size-3.5" />
														)}
													</button>
												) : null}
											</div>
										</header>
										{result.text ? (
											<div className="whitespace-pre-wrap text-sm leading-7 text-[#cfd1d3]">
												{result.text}
											</div>
										) : result.status === "error" ? (
											<p className="text-sm leading-6 text-red-200">{result.error}</p>
										) : (
											<div className="flex min-h-40 items-center justify-center text-sm text-[#666c74]">
												{result.status === "streaming" ? "Waiting for the first output…" : "Starting target…"}
											</div>
										)}
										{result.status === "error" && result.text ? (
											<p className="mt-4 border-t border-white/[0.07] pt-4 text-xs leading-5 text-red-200">
												{result.error}
											</p>
										) : null}
									</article>
								);
							})}
							{!results.length && !loading ? (
								<div className="rounded-2xl border border-dashed border-white/[0.09] px-6 py-16 text-center text-sm text-[#666c74] xl:col-span-3">
									Comparison results appear here.
								</div>
							) : null}
						</section>
					</div>
				</main>
			</AiraV2Frame>
		</div>
	);
}
