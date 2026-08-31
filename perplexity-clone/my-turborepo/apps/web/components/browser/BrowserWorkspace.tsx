"use client";

import {
	ArrowLeftRight,
	Camera,
	ExternalLink,
	Keyboard,
	Loader2,
	MousePointer2,
	Pause,
	Play,
	RefreshCw,
	Square,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";

type BrowserSession = {
	id: string;
	mode: "OBSERVE" | "ASSISTED" | "AUTONOMOUS";
	status: "CREATING" | "ACTIVE" | "HUMAN_CONTROL" | "PAUSED" | "ENDED" | "FAILED" | "EXPIRED";
	allowedDomains: string[];
	permissions: string[];
	currentUrl: string | null;
	lastScreenshotUri: string | null;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
};

type BrowserAction = {
	id: string;
	source: string;
	action: string;
	target: string | null;
	risk: string;
	createdAt: string;
};

type RuntimeStatus = { enabled: boolean; configured: boolean; healthy: boolean; ready: boolean };

type SessionDetail = { session: BrowserSession; actions: BrowserAction[]; syncWarning?: string };

async function readError(response: Response): Promise<Error> {
	const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
	return new Error(body?.error?.message ?? `Request failed (${response.status}).`);
}

export function BrowserWorkspace() {
	const router = useRouter();
	const { status: sessionStatus } = useSession();
	const [sessions, setSessions] = useState<BrowserSession[]>([]);
	const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<SessionDetail | null>(null);
	const [startUrl, setStartUrl] = useState("https://example.com");
	const [domains, setDomains] = useState("example.com");
	const [mode, setMode] = useState<BrowserSession["mode"]>("ASSISTED");
	const [navigationUrl, setNavigationUrl] = useState("");
	const [selector, setSelector] = useState("");
	const [text, setText] = useState("");
	const [key, setKey] = useState("Enter");
	const [shotRevision, setShotRevision] = useState(0);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const selected = useMemo(() => detail?.session ?? sessions.find((item) => item.id === selectedId) ?? null, [detail, sessions, selectedId]);
	const humanControl = selected?.status === "HUMAN_CONTROL";
	const screenshotUrl = selected
		? `/api/browser/sessions/${encodeURIComponent(selected.id)}/screenshot?r=${shotRevision}`
		: null;

	const loadSessions = useCallback(async () => {
		const response = await fetch("/api/browser/sessions", { cache: "no-store" });
		if (!response.ok) throw await readError(response);
		const body = (await response.json()) as { sessions: BrowserSession[]; runtime: RuntimeStatus };
		setSessions(body.sessions);
		setRuntime(body.runtime);
		setSelectedId((current) => current && body.sessions.some((item) => item.id === current) ? current : body.sessions[0]?.id ?? null);
	}, []);

	const loadDetail = useCallback(async (sessionId: string) => {
		const response = await fetch(`/api/browser/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
		if (!response.ok) throw await readError(response);
		const body = (await response.json()) as SessionDetail;
		setDetail(body);
		setSessions((current) => current.map((item) => item.id === body.session.id ? body.session : item));
		return body;
	}, []);

	useEffect(() => {
		if (sessionStatus === "unauthenticated") {
			router.replace(`/signin?callbackUrl=${encodeURIComponent("/browser")}`);
			return;
		}
		if (sessionStatus !== "authenticated") return;
		void loadSessions().catch((e: unknown) => setError(e instanceof Error ? e.message : "Browser sessions could not be loaded.")).finally(() => setLoading(false));
	}, [loadSessions, router, sessionStatus]);

	useEffect(() => {
		if (!selectedId) { setDetail(null); return; }
		void loadDetail(selectedId).catch((e: unknown) => setError(e instanceof Error ? e.message : "Browser session could not be loaded."));
	}, [loadDetail, selectedId]);

	useEffect(() => {
		if (!selected || !["ACTIVE", "HUMAN_CONTROL", "PAUSED"].includes(selected.status)) return;
		const timer = window.setInterval(() => {
			setShotRevision((value) => value + 1);
			void loadDetail(selected.id).catch(() => undefined);
		}, 2_500);
		return () => window.clearInterval(timer);
	}, [loadDetail, selected]);

	async function createSession() {
		const allowedDomains = domains.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
		if (!allowedDomains.length) return;
		setBusy("create"); setError(null);
		try {
			const response = await fetch("/api/browser/sessions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode, allowedDomains, startUrl: startUrl.trim() || undefined, width: 1440, height: 900, ttlMinutes: 60 }),
			});
			if (!response.ok) throw await readError(response);
			const body = (await response.json()) as { session: BrowserSession };
			setSessions((current) => [body.session, ...current.filter((item) => item.id !== body.session.id)]);
			setSelectedId(body.session.id);
			setDetail({ session: body.session, actions: [] });
			setNavigationUrl(body.session.currentUrl ?? startUrl);
			setShotRevision((value) => value + 1);
		} catch (e) { setError(e instanceof Error ? e.message : "Browser session could not be created."); }
		finally { setBusy(null); }
	}

	async function action(payload: Record<string, unknown>) {
		if (!selected) return;
		setBusy("action"); setError(null);
		try {
			const response = await fetch(`/api/browser/sessions/${encodeURIComponent(selected.id)}/actions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (!response.ok) throw await readError(response);
			setShotRevision((value) => value + 1);
			await loadDetail(selected.id);
		} catch (e) { setError(e instanceof Error ? e.message : "Browser action failed."); }
		finally { setBusy(null); }
	}

	async function control(value: "human" | "agent" | "pause" | "resume") {
		if (!selected) return;
		setBusy(`control-${value}`);
		try {
			const response = await fetch(`/api/browser/sessions/${encodeURIComponent(selected.id)}/control`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ control: value }),
			});
			if (!response.ok) throw await readError(response);
			await loadDetail(selected.id);
		} catch (e) { setError(e instanceof Error ? e.message : "Browser control could not be changed."); }
		finally { setBusy(null); }
	}

	async function endSession() {
		if (!selected) return;
		setBusy("end");
		try {
			const response = await fetch(`/api/browser/sessions/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
			if (!response.ok) throw await readError(response);
			await loadSessions();
			setDetail(null);
		} catch (e) { setError(e instanceof Error ? e.message : "Browser session could not be ended."); }
		finally { setBusy(null); }
	}

	function clickScreenshot(event: React.MouseEvent<HTMLImageElement>) {
		if (!humanControl || !selected) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * 1440;
		const y = ((event.clientY - rect.top) / rect.height) * 900;
		void action({ action: "click_at", x, y });
	}

	if (sessionStatus !== "authenticated" || loading) {
		return <div className="grid min-h-[calc(100dvh-58px)] place-items-center bg-[#090b0e] text-[#8f949c]"><Loader2 className="size-5 animate-spin" /></div>;
	}

	return (
		<main className="min-h-[calc(100dvh-58px)] bg-[#090b0e] px-4 py-5 text-[#ecece8] md:px-6">
			<div className="mx-auto max-w-[1600px]">
				<div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b89a51]">AIRA Browser</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Browser operator</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#858b94]">Isolated Chromium sessions with domain scope, audited actions and screenshot-driven human takeover.</p></div><div className={cn("rounded-full border px-3 py-1.5 text-xs", runtime?.ready ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200" : "border-amber-300/20 bg-amber-300/[0.06] text-amber-100")}>{runtime?.ready ? "Browser runtime ready" : "Browser runtime not configured"}</div></div>
				{error ? <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200">{error}</div> : null}
				<div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
					<aside className="space-y-4">
						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4"><h2 className="text-sm font-semibold">New session</h2><input value={startUrl} onChange={(e) => setStartUrl(e.target.value)} placeholder="https://example.com" className="mt-3 w-full rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-xs outline-none"/><input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com, auth.example.com" className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-xs outline-none"/><select value={mode} onChange={(e) => setMode(e.target.value as BrowserSession["mode"])} className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-xs"><option value="OBSERVE">Observe</option><option value="ASSISTED">Assisted</option><option value="AUTONOMOUS">Autonomous scope</option></select><button type="button" onClick={() => void createSession()} disabled={!runtime?.ready || busy !== null} className="mt-3 w-full rounded-lg bg-[#d0ae55] px-3 py-2 text-sm font-semibold text-[#111214] disabled:opacity-35">{busy === "create" ? "Starting…" : "Start browser"}</button></div>
						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Sessions</h2><button type="button" onClick={() => void loadSessions()} className="text-[#858b94]"><RefreshCw className="size-3.5"/></button></div><div className="mt-3 space-y-2">{sessions.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn("w-full rounded-xl border px-3 py-2.5 text-left", selectedId === item.id ? "border-[#c5a34e]/25 bg-[#c5a34e]/[0.06]" : "border-white/[0.06] bg-[#0a0d11]")}><span className="flex items-center justify-between gap-2"><strong className="truncate text-xs">{item.allowedDomains[0] ?? "Browser"}</strong><span className="text-[9px] text-[#777d86]">{item.status.replaceAll("_", " ")}</span></span><span className="mt-1 block truncate text-[10px] text-[#626872]">{item.currentUrl ?? item.mode}</span></button>)}</div></div>
					</aside>

					<section className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0f1216]">
						<div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3"><input value={navigationUrl} onChange={(e) => setNavigationUrl(e.target.value)} placeholder={selected?.currentUrl ?? "https://…"} className="min-w-[220px] flex-1 rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-xs outline-none"/><button type="button" onClick={() => void action({ action: "navigate", url: navigationUrl })} disabled={!selected || busy !== null} className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs">Go</button><button type="button" onClick={() => setShotRevision((value) => value + 1)} className="rounded-lg border border-white/[0.08] p-2 text-[#9298a0]" aria-label="Refresh screenshot"><Camera className="size-4"/></button></div>
						<div className="relative aspect-[16/10] w-full bg-black">{screenshotUrl ? <Image key={screenshotUrl} src={screenshotUrl} alt="Live AIRA browser session" fill unoptimized sizes="(max-width: 1280px) 100vw, 900px" onClick={clickScreenshot} className={cn("object-contain", humanControl && "cursor-crosshair")}/> : <div className="grid h-full place-items-center text-sm text-[#666c75]">Create or select a browser session.</div>}{humanControl ? <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-emerald-300/20 bg-black/70 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">YOU HAVE CONTROL · click the screenshot</div> : null}</div>
						<div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] p-3">{selected && selected.status !== "HUMAN_CONTROL" ? <button type="button" onClick={() => void control("human")} className="inline-flex items-center gap-2 rounded-lg bg-[#d0ae55] px-3 py-2 text-xs font-semibold text-[#111214]"><MousePointer2 className="size-3.5"/>Take control</button> : selected ? <button type="button" onClick={() => void control("agent")} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2 text-xs text-emerald-100"><ArrowLeftRight className="size-3.5"/>Return to AIRA</button> : null}{selected?.status === "PAUSED" ? <button type="button" onClick={() => void control("resume")} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs"><Play className="size-3.5"/>Resume</button> : selected ? <button type="button" onClick={() => void control("pause")} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs"><Pause className="size-3.5"/>Pause</button> : null}{selected ? <button type="button" onClick={() => void endSession()} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-red-300/15 px-3 py-2 text-xs text-red-200"><Square className="size-3.5"/>End</button> : null}</div>
					</section>

					<aside className="space-y-4">
						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4"><h2 className="text-sm font-semibold">Operator input</h2><p className="mt-1 text-xs leading-5 text-[#717780]">In human control, click a field in the screenshot, then fill the focused element with <code>:focus</code>.</p><input value={selector} onChange={(e) => setSelector(e.target.value)} placeholder="CSS selector, e.g. :focus" className="mt-3 w-full rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-xs outline-none"/><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Text to fill" className="mt-2 w-full rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-xs outline-none"/><div className="mt-2 flex gap-2"><button type="button" onClick={() => void action({ action: "fill", selector: selector || ":focus", text })} disabled={!selected || busy !== null} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs"><Keyboard className="size-3.5"/>Fill</button><button type="button" onClick={() => void action({ action: "click", selector })} disabled={!selected || !selector || busy !== null} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs"><MousePointer2 className="size-3.5"/>Click</button></div><div className="mt-2 flex gap-2"><input value={key} onChange={(e) => setKey(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#090b0e] px-3 py-2 text-xs"/><button type="button" onClick={() => void action({ action: "press", key, ...(selector ? { selector } : {}) })} disabled={!selected || !key || busy !== null} className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs">Press</button></div><button type="button" onClick={() => void action({ action: "inspect" })} disabled={!selected || busy !== null} className="mt-2 w-full rounded-lg border border-white/[0.08] px-3 py-2 text-xs">Inspect page state</button></div>

						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4"><h2 className="text-sm font-semibold">Session policy</h2>{selected ? <div className="mt-3 space-y-2 text-xs"><div className="flex justify-between"><span className="text-[#707680]">Mode</span><span>{selected.mode}</span></div><div className="flex justify-between"><span className="text-[#707680]">Control</span><span>{selected.status}</span></div><div><span className="text-[#707680]">Domains</span><div className="mt-1 flex flex-wrap gap-1">{selected.allowedDomains.map((domain) => <span key={domain} className="rounded border border-white/[0.07] bg-[#090b0e] px-1.5 py-0.5 text-[10px]">{domain}</span>)}</div></div>{selected.currentUrl ? <a href={selected.currentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#c4a651]">Current URL <ExternalLink className="size-3"/></a> : null}</div> : <p className="mt-3 text-xs text-[#707680]">No session selected.</p>}</div>

						<div className="rounded-2xl border border-white/[0.07] bg-[#0f1216] p-4"><h2 className="text-sm font-semibold">Audit trail</h2><div className="mt-3 max-h-72 space-y-2 overflow-auto">{detail?.actions.map((item) => <div key={item.id} className="border-l border-white/[0.08] pl-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">{item.action}</p><span className="text-[9px] text-[#676d75]">{item.source}</span></div><p className="mt-0.5 truncate text-[10px] text-[#676d75]">{item.target ?? item.risk}</p></div>) ?? <p className="text-xs text-[#707680]">No actions recorded.</p>}</div></div>
					</aside>
				</div>
			</div>
		</main>
	);
}
