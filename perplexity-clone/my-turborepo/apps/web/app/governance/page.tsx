"use client";

import { Building2, Loader2, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";

type Workspace = { id: string; name: string };
type Organization = { id: string; name: string; slug: string; role: string; workspaces: Workspace[] };
type Payload = { organizations: Organization[]; enterpriseSso: { state: string; detail: string }; error?: { message?: string } };

export default function GovernancePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/enterprise/organizations", { cache: "no-store" });
      const body = (await response.json()) as Payload;
      if (!response.ok) throw new Error(body.error?.message ?? "Governance state could not be loaded.");
      setData(body);
      setSelectedOrgId((current) => current && body.organizations.some((org) => org.id === current) ? current : body.organizations[0]?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Governance state could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function action(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/enterprise/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Governance action failed.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Governance action failed."); }
    finally { setBusy(false); }
  }

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-4 py-6 text-[#111115] md:px-8">
          <div className="mx-auto max-w-6xl space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3A0CA3]">Governance</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#111115]">Enterprise organizations & workspaces</h1>
                <p className="mt-1 max-w-3xl text-sm text-[#6B6A75]">Memberships and workspace creation are server-authorized. Enterprise SSO remains explicitly external-blocked until a live corporate IdP is connected.</p>
              </div>
              <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-xs font-medium text-[#111115] shadow-xs hover:bg-[#FAF9F6]">
                {loading ? <Loader2 className="size-3.5 animate-spin text-[#3A0CA3]" /> : <RefreshCw className="size-3.5" />}Refresh
              </button>
            </header>
            {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-[#3A0CA3]" />
                  <h2 className="text-sm font-semibold text-[#111115]">Create organization</h2>
                </div>
                <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Organization name" className="mt-3 w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] placeholder:text-[#8F8E98] outline-none focus:border-[#3A0CA3]" />
                <input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="organization-slug" className="mt-2 w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] placeholder:text-[#8F8E98] outline-none focus:border-[#3A0CA3]" />
                <button type="button" onClick={() => void action({ action: "create_org", name: orgName.trim(), slug: orgSlug.trim() })} disabled={busy || orgName.trim().length < 2 || orgSlug.trim().length < 2} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#3A0CA3] hover:bg-[#2D0A82] px-3 py-2 text-sm font-semibold text-white shadow-xs transition disabled:opacity-40">
                  <Plus className="size-4" />Create organization
                </button>
              </section>
              <section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
                <h2 className="text-sm font-semibold text-[#111115]">Create workspace</h2>
                <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)} className="mt-3 w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] outline-none focus:border-[#3A0CA3]">
                  {data?.organizations.map((org) => <option key={org.id} value={org.id}>{org.name} · {org.role}</option>)}
                </select>
                <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Workspace name" className="mt-2 w-full rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm text-[#111115] placeholder:text-[#8F8E98] outline-none focus:border-[#3A0CA3]" />
                <button type="button" onClick={() => void action({ action: "create_workspace", orgId: selectedOrgId, name: workspaceName.trim() })} disabled={busy || !selectedOrgId || workspaceName.trim().length < 2} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[rgba(17,17,21,0.12)] bg-white px-3 py-2 text-sm font-medium text-[#111115] shadow-xs hover:bg-[#FAF9F6] disabled:opacity-40">
                  <Plus className="size-4" />Create workspace
                </button>
              </section>
            </div>
            <section className="rounded-2xl border border-[rgba(17,17,21,0.08)] bg-white p-5 shadow-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-[#3A0CA3]" />
                <h2 className="text-sm font-semibold text-[#111115]">Membership boundary</h2>
              </div>
              {loading ? (
                <div className="grid place-items-center py-12"><Loader2 className="size-4 animate-spin text-[#3A0CA3]" /></div>
              ) : data?.organizations.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {data.organizations.map((org) => (
                    <article key={org.id} className="rounded-xl border border-[rgba(17,17,21,0.08)] bg-[#FAF9F6] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#111115]">{org.name}</p>
                        <span className="rounded-full border border-[#3A0CA3]/20 bg-[#3A0CA3]/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#3A0CA3]">{org.role}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-[#6B6A75]">{org.slug}</p>
                      <div className="mt-3 space-y-1">
                        {org.workspaces.length ? org.workspaces.map((workspace) => (
                          <div key={workspace.id} className="rounded-lg border border-[rgba(17,17,21,0.06)] bg-white px-3 py-2 text-xs text-[#111115]">{workspace.name}</div>
                        )) : <p className="text-xs text-[#6B6A75]">No workspaces.</p>}
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p className="mt-4 text-sm text-[#6B6A75]">No organization membership exists for this account.</p>}
              <div className="mt-5 rounded-xl border border-amber-600/20 bg-amber-50 p-4">
                <p className="text-xs font-semibold text-amber-900">Enterprise identity · {data?.enterpriseSso?.state ?? (error ? "PERMISSION REQUIRED" : "NOT CONFIGURED")}</p>
                <p className="mt-1 text-xs leading-5 text-amber-800/80">{data?.enterpriseSso?.detail ?? (error ? "Sign in with an authorized account to manage enterprise organizations." : "Enterprise SSO capability is currently unconfigured.")}</p>
              </div>
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
