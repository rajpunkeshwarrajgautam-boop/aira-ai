"use client";

import {
	ArrowUpRight,
	Cable,
	CheckCircle2,
	Cpu,
	Globe2,
	Layers,
	Loader2,
	Power,
	RefreshCw,
	Settings2,
	ShieldCheck,
	User,
	Wrench,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { cn } from "@/lib/cn";

type Integration = { id: string; label: string; configured: boolean; detail: string; model?: string };
type Status = { integrations: Integration[]; defaults: { primaryProvider: string; fallbackProvider: string; omniRouteModel?: string } };
type ToolStatus = {
	id: string;
	label: string;
	description: string;
	category: string;
	permission: string;
	sideEffecting: boolean;
	timeoutMs: number;
	cancellable: boolean;
	audit: "required" | "standard";
	availability: { state: string; detail: string };
	provenance?: { kind: "builtin" | "mcp"; serverId?: string };
};
type ToolsPayload = {
	tools: ToolStatus[];
	permissionPolicy: { modes: string[]; auto: string; ask: string; plan_only: string };
};
type McpServerStatus = {
	id: string;
	label: string;
	endpointHost: string;
	enabled: boolean;
	authMode: string;
	scopes: string[];
	state: string;
	detail: string;
	toolCount: number;
	resourceCount: number;
	promptCount: number;
	tools: Array<{ id: string; label: string; permission: string }>;
};
type McpPayload = { enabled: boolean; servers: McpServerStatus[] };

const INTEGRATION_DESTINATIONS: Readonly<Record<string, { href: string; label: string }>> = {
	omniroute: { href: "/omniroute", label: "Open AIRA Route" },
	openai: { href: "/compare", label: "Open Compare" },
	nvidia: { href: "/compare", label: "Open Compare" },
	exa: { href: "/", label: "Open Research" },
	knowledge: { href: "/knowledge", label: "Open Knowledge" },
	deerflow: { href: "/agents", label: "Open Agents" },
	autogpt: { href: "/agents", label: "Open Agents" },
};

function stateLabel(state: string): string {
	if (state === "AVAILABLE") return "Available";
	if (state === "CONFIGURED") return "Configured";
	if (state === "AUTH_REQUIRED") return "Auth required";
	if (state === "PERMISSION_REQUIRED") return "Permission required";
	if (state === "DEGRADED") return "Degraded";
	if (state === "UNAVAILABLE") return "Unavailable";
	return "Not configured";
}

function stateReady(state: string): boolean {
	return state === "AVAILABLE" || state === "CONFIGURED";
}

type SettingsTab = "general" | "models" | "connections" | "developer";

export default function SettingsPage() {
	const [activeTab, setActiveTab] = useState<SettingsTab>("connections");
	const [status, setStatus] = useState<Status | null>(null);
	const [tools, setTools] = useState<ToolsPayload | null>(null);
	const [mcp, setMcp] = useState<McpPayload | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [savingMcp, setSavingMcp] = useState<string | null>(null);

	const loadStatus = useCallback(async () => {
		setLoading(true);
		setMessage(null);
		try {
			const [statusResponse, toolsResponse, mcpResponse] = await Promise.all([
				fetch("/api/integrations/status", { cache: "no-store" }),
				fetch("/api/tools", { cache: "no-store" }),
				fetch("/api/mcp", { cache: "no-store" }),
			]);
			const data = (await statusResponse.json()) as Status & { error?: { message?: string } };
			const toolData = (await toolsResponse.json()) as ToolsPayload & { error?: { message?: string } };
			const mcpData = (await mcpResponse.json()) as McpPayload & { error?: { message?: string } };
			if (!statusResponse.ok) throw new Error(data.error?.message ?? "Could not load integration status.");
			if (!toolsResponse.ok) throw new Error(toolData.error?.message ?? "Could not load tool registry status.");
			if (!mcpResponse.ok) throw new Error(mcpData.error?.message ?? "Could not load MCP status.");
			setStatus(data);
			setTools(toolData);
			setMcp(mcpData);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Could not load runtime status.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadStatus();
	}, [loadStatus]);

	useEffect(() => {
		if (typeof window !== "undefined") {
			const hash = window.location.hash;
			if (hash === "#integrations") setActiveTab("connections");
			else if (hash === "#mcp" || hash === "#tools") setActiveTab("developer");
			else if (hash === "#models") setActiveTab("models");
		}
	}, []);

	const toggleMcpServer = useCallback(async (server: McpServerStatus) => {
		setSavingMcp(server.id);
		setMessage(null);
		try {
			const response = await fetch(`/api/mcp/servers/${encodeURIComponent(server.id)}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: !server.enabled }),
			});
			const payload = (await response.json()) as { error?: { message?: string } };
			if (!response.ok) throw new Error(payload.error?.message ?? "Could not update MCP server preference.");
			await loadStatus();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Could not update MCP server preference.");
		} finally {
			setSavingMcp(null);
		}
	}, [loadStatus]);

	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-5 py-7 text-[#111115] md:px-8">
					<div className="mx-auto max-w-6xl">
						{/* Page Title & Refresh */}
						<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
							<div>
								<p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#3A0CA3]">Settings</p>
								<h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#111115] md:text-3xl">System & Preferences</h1>
								<p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6A75]">Runtime &amp; integrations (Runtime & integrations): manage deployment configuration, model routing, verified MCP discovery, and tool security policies. Secrets remain server-side and are never returned to the browser.</p>
							</div>
							<button
								type="button"
								onClick={() => void loadStatus()}
								disabled={loading}
								className="inline-flex items-center gap-2 rounded-xl border border-[rgba(17,17,21,0.08)] bg-white px-3.5 py-2 text-xs font-semibold text-[#111115] shadow-2xs transition hover:bg-[#FAF9F6] disabled:opacity-50"
							>
								<RefreshCw className={`size-3.5 text-[#3A0CA3] ${loading ? "animate-spin" : ""}`} />
								Refresh status
							</button>
						</div>

						{/* Settings Navigation Tabs */}
						<div className="mb-6 flex flex-wrap border-b border-[rgba(17,17,21,0.08)] text-xs font-medium">
							{[
								{ id: "connections" as const, label: "Connections", icon: Settings2 },
								{ id: "models" as const, label: "Models & Routing", icon: Cpu },
								{ id: "developer" as const, label: "Developer & Tools", icon: Wrench },
								{ id: "general" as const, label: "General & Privacy", icon: User },
							].map((tab) => {
								const Icon = tab.icon;
								const isActive = activeTab === tab.id;
								return (
									<button
										key={tab.id}
										type="button"
										onClick={() => setActiveTab(tab.id)}
										className={cn(
											"inline-flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition",
											isActive
												? "border-[#3A0CA3] text-[#3A0CA3]"
												: "border-transparent text-[#6B6A75] hover:border-[rgba(17,17,21,0.15)] hover:text-[#111115]",
										)}
									>
										<Icon className="size-3.5" />
										{tab.label}
									</button>
								);
							})}
						</div>

						{message ? (
							<div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-800" role="alert">
								<span>{message}</span>
								<button type="button" onClick={() => void loadStatus()} className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-red-500/[0.08]">
									Retry
								</button>
							</div>
						) : null}

						{loading && !status ? (
							<div className="grid place-items-center rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white py-20 shadow-xs">
								<Loader2 className="size-5 animate-spin text-[#3A0CA3]" />
							</div>
						) : status ? (
							<>
								{/* Tab: Connections (Integrations) */}
								<div className={activeTab === "connections" ? "block" : "hidden"}>
									<section id="integrations" className="mb-5 scroll-mt-24 overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs">
										<div className="border-b border-[rgba(17,17,21,0.08)] px-5 py-4">
											<h2 className="text-sm font-semibold text-[#111115]">Service configuration</h2>
											<p className="mt-1 text-xs text-[#6B6A75]">Deployment configuration state; provider health is verified by the relevant live runtime path</p>
										</div>
										<ul className="divide-y divide-[rgba(17,17,21,0.06)]">
											{status.integrations.map((integration) => {
												const destination = INTEGRATION_DESTINATIONS[integration.id];
												return (
													<li key={integration.id} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-[#FAF9F6] transition">
														<span className={`grid size-9 place-items-center rounded-lg ${integration.configured ? "bg-emerald-500/10 text-emerald-800" : "bg-[#F3F1EC] text-[#8F8E98]"}`}>
															{integration.configured ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
														</span>
														<div className="min-w-0 flex-1">
															<p className="text-sm font-semibold text-[#111115]">{integration.label}</p>
															<p className="mt-1 text-xs text-[#6B6A75]">{integration.detail}{integration.model ? ` · ${integration.model}` : ""}</p>
														</div>
														<span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${integration.configured ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800" : "border-[rgba(17,17,21,0.08)] bg-[#F7F6F2] text-[#6B6A75]"}`}>
															{integration.configured ? "Configured" : "Not configured"}
														</span>
														{destination ? (
															<Link href={destination.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgba(17,17,21,0.08)] bg-white px-2.5 text-[11px] font-medium text-[#111115] shadow-2xs transition hover:border-[#3A0CA3]/30 hover:text-[#3A0CA3]">
																{destination.label}<ArrowUpRight className="size-3" />
															</Link>
														) : null}
													</li>
												);
											})}
										</ul>
									</section>
								</div>

								{/* Tab: Models & Routing */}
								<div className={activeTab === "models" ? "block" : "hidden"}>
									<section id="models" className="mb-5 grid gap-4 md:grid-cols-2">
										<div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
											<div className="mb-4 flex items-center gap-3">
												<span className="grid size-9 place-items-center rounded-lg bg-[rgba(58,12,163,0.08)] text-[#3A0CA3]">
													<Settings2 className="size-4" />
												</span>
												<div>
													<h2 className="text-sm font-semibold text-[#111115]">Model routing</h2>
													<p className="mt-1 text-xs text-[#6B6A75]">Current server defaults</p>
												</div>
											</div>
											<dl className="grid gap-3 text-sm">
												<div className="flex items-center justify-between rounded-lg bg-[#FAF9F6] px-3 py-2.5">
													<dt className="text-[#6B6A75]">Primary</dt>
													<dd className="font-semibold text-[#111115]">{status.defaults.primaryProvider}</dd>
												</div>
												<div className="flex items-center justify-between rounded-lg bg-[#FAF9F6] px-3 py-2.5">
													<dt className="text-[#6B6A75]">Fallback</dt>
													<dd className="font-semibold text-[#111115]">{status.defaults.fallbackProvider}</dd>
												</div>
												{status.defaults.omniRouteModel ? (
													<div className="flex items-center justify-between rounded-lg bg-[#FAF9F6] px-3 py-2.5">
														<dt className="text-[#6B6A75]">OmniRoute mode</dt>
														<dd className="font-semibold text-[#111115]">{status.defaults.omniRouteModel}</dd>
													</div>
												) : null}
											</dl>
											<Link href="/omniroute" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#3A0CA3] transition hover:underline">
												Open routing gateway <ArrowUpRight className="size-3.5" />
											</Link>
										</div>
										<div className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
											<h2 className="text-sm font-semibold text-[#111115]">Configuration model</h2>
											<p className="mt-2 text-sm leading-6 text-[#6B6A75]">Provider and MCP credentials stay deployment-level settings. AIRA exposes configuration and live verification states without returning API keys, OAuth client secrets, or private credentials.</p>
											<p className="mt-3 text-xs leading-5 text-[#6B6A75]">Configured does not mean connected. AIRA only reports MCP as available after a live protocol handshake and capability discovery.</p>
										</div>
									</section>
								</div>

								{/* Tab: Developer & Tools (MCP & Tool Registry) */}
								<div className={activeTab === "developer" ? "block" : "hidden"}>
									{mcp ? (
										<section id="mcp" className="mb-5 scroll-mt-24 overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs">
											<div className="flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(17,17,21,0.08)] px-5 py-4">
												<div>
													<div className="flex items-center gap-2">
														<Cable className="size-4 text-[#3A0CA3]" />
														<h2 className="text-sm font-semibold text-[#111115]">Model Context Protocol</h2>
													</div>
													<p className="mt-1 text-xs text-[#6B6A75]">Deployment-approved remote MCP v2 servers with live discovery and AIRA permission enforcement</p>
												</div>
												<span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${mcp.enabled ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800" : "border-[rgba(17,17,21,0.08)] bg-[#F7F6F2] text-[#6B6A75]"}`}>
													{mcp.enabled ? "Enabled" : "Disabled by deployment"}
												</span>
											</div>
											{mcp.servers.length ? (
												<ul className="divide-y divide-[rgba(17,17,21,0.06)]">
													{mcp.servers.map((server) => {
														const ready = stateReady(server.state);
														return (
															<li key={server.id} className="px-5 py-4 hover:bg-[#FAF9F6] transition">
																<div className="flex flex-wrap items-center gap-4">
																	<span className={`grid size-9 place-items-center rounded-lg ${ready ? "bg-emerald-500/10 text-emerald-800" : server.state === "DEGRADED" ? "bg-amber-500/10 text-amber-800" : "bg-[#F3F1EC] text-[#8F8E98]"}`}>
																		{ready ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
																	</span>
																	<div className="min-w-0 flex-1">
																		<div className="flex flex-wrap items-center gap-2">
																			<p className="text-sm font-semibold text-[#111115]">{server.label}</p>
																			<span className="rounded-md bg-[#F3F1EC] px-1.5 py-0.5 text-[10px] text-[#6B6A75]">{server.endpointHost}</span>
																			<span className="rounded-md bg-[#F3F1EC] px-1.5 py-0.5 text-[10px] text-[#6B6A75]">{server.authMode}</span>
																		</div>
																		<p className="mt-1 text-xs text-[#6B6A75]">{server.detail}</p>
																		<p className="mt-1 text-[11px] text-[#6B6A75]">
																			{server.toolCount} tools · {server.resourceCount} resources · {server.promptCount} prompts
																			{server.scopes.length ? ` · scopes: ${server.scopes.join(", ")}` : ""}
																		</p>
																	</div>
																	<span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${ready ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800" : "border-[rgba(17,17,21,0.08)] bg-[#F7F6F2] text-[#6B6A75]"}`}>
																		{stateLabel(server.state)}
																	</span>
																	<button
																		type="button"
																		disabled={!mcp.enabled || savingMcp === server.id}
																		onClick={() => void toggleMcpServer(server)}
																		className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgba(17,17,21,0.08)] bg-white px-2.5 text-[11px] font-medium text-[#111115] shadow-2xs transition hover:border-[#3A0CA3]/30 hover:text-[#3A0CA3] disabled:cursor-not-allowed disabled:opacity-40"
																	>
																		{savingMcp === server.id ? <Loader2 className="size-3 animate-spin" /> : <Power className="size-3" />}
																		{server.enabled ? "Disable" : "Enable"}
																	</button>
																</div>
																{server.tools.length ? (
																	<div className="mt-3 flex flex-wrap gap-1.5">
																		{server.tools.slice(0, 8).map((tool) => (
																			<span key={tool.id} className="rounded-md border border-[rgba(17,17,21,0.06)] bg-[#F7F6F2] px-2 py-1 text-[10px] text-[#6B6A75]">
																				{tool.label} · {tool.permission}
																			</span>
																		))}
																	</div>
																) : null}
															</li>
														);
													})}
												</ul>
											) : (
												<div className="px-5 py-8 text-sm text-[#6B6A75]">No deployment-approved MCP servers are configured. Add server-only configuration before enabling MCP tools.</div>
											)}
											<div className="border-t border-[rgba(17,17,21,0.08)] px-5 py-4 text-xs leading-5 text-[#6B6A75]">
												Unknown remote MCP tools default to <span className="font-semibold text-amber-800">HIGH_IMPACT</span> and require persisted approval. Only deployment-allowlisted read-only tools may execute automatically in auto mode.
											</div>
										</section>
									) : null}

									{tools ? (
										<section id="tools" className="scroll-mt-24 overflow-hidden rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white shadow-xs">
											<div className="flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(17,17,21,0.08)] px-5 py-4">
												<div>
													<div className="flex items-center gap-2">
														<Wrench className="size-4 text-[#3A0CA3]" />
														<h2 className="text-sm font-semibold text-[#111115]">Agent tool registry</h2>
													</div>
													<p className="mt-1 text-xs text-[#6B6A75]">One canonical execution registry for built-in and MCP tools</p>
												</div>
												<div className="flex items-center gap-2 text-[11px] text-[#6B6A75]">
													<ShieldCheck className="size-3.5 text-[#3A0CA3]" />Auto mode only auto-executes read tools
												</div>
											</div>
											<ul className="divide-y divide-[rgba(17,17,21,0.06)]">
												{tools.tools.map((tool) => {
													const ready = stateReady(tool.availability.state);
													return (
														<li key={tool.id} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-[#FAF9F6] transition">
															<span className={`grid size-9 place-items-center rounded-lg ${ready ? "bg-emerald-500/10 text-emerald-800" : "bg-[#F3F1EC] text-[#8F8E98]"}`}>
																{ready ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
															</span>
															<div className="min-w-0 flex-1">
																<div className="flex flex-wrap items-center gap-2">
																	<p className="text-sm font-semibold text-[#111115]">{tool.label}</p>
																	<span className="rounded-md bg-[#F3F1EC] px-1.5 py-0.5 text-[10px] font-medium text-[#6B6A75]">{tool.permission}</span>
																	{tool.provenance?.kind === "mcp" ? (
																		<span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">MCP · {tool.provenance.serverId}</span>
																	) : null}
																	{tool.audit === "required" ? (
																		<span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Audited</span>
																	) : null}
																</div>
																<p className="mt-1 text-xs text-[#6B6A75]">{tool.description}</p>
																<p className="mt-1 text-[11px] leading-5 text-[#6B6A75]">{tool.availability.detail}</p>
															</div>
															<span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${ready ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800" : "border-[rgba(17,17,21,0.08)] bg-[#F7F6F2] text-[#6B6A75]"}`}>
																{stateLabel(tool.availability.state)}
															</span>
														</li>
													);
												})}
											</ul>
											<div className="border-t border-[rgba(17,17,21,0.08)] px-5 py-4 text-xs leading-5 text-[#6B6A75]">
												Permission modes: <span className="font-semibold text-[#111115]">auto</span>, <span className="font-semibold text-[#111115]">ask</span>, and <span className="font-semibold text-[#111115]">plan_only</span>. Configured means credentials/endpoints are present; it deliberately does not claim live health until invocation or runtime verification.
											</div>
										</section>
									) : null}
								</div>

								{/* Tab: General & Privacy */}
								<div className={activeTab === "general" ? "block" : "hidden"}>
									<section className="mb-5 rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
										<h2 className="text-sm font-semibold text-[#111115]">Identity & Workspace</h2>
										<p className="mt-1 text-xs text-[#6B6A75]">Your current active session and environment parameters.</p>
										<div className="mt-4 grid gap-3 sm:grid-cols-2">
											<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3.5">
												<p className="text-[11px] text-[#6B6A75]">Tenant Partition</p>
												<p className="mt-1 text-xs font-semibold text-[#111115]">Standard Encrypted Namespace</p>
											</div>
											<div className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-3.5">
												<p className="text-[11px] text-[#6B6A75]">Knowledge Ingestion</p>
												{status.integrations?.find((i) => i.id === "knowledge")?.configured ? (
													<p className="mt-1 text-xs font-semibold text-emerald-700">Active (Multi-Format pgvector)</p>
												) : (
													<p className="mt-1 text-xs font-semibold text-amber-800">Disabled (Deployment Gate: Requires Ingestion Worker)</p>
												)}
											</div>
										</div>
									</section>
								</div>
							</>
						) : null}
					</div>
				</main>
			</AiraV2Frame>
		</div>
	);
}
