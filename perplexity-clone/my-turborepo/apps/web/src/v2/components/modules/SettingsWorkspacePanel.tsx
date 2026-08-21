"use client";

import { CreditCard, ExternalLink, LogOut, Settings2, SlidersHorizontal, UserRound } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";

import type { BillingStatus } from "@/src/v2/compat/account-api";
import {
  V2_RESEARCH_PRESETS,
  type ResearchPresetId,
  type V2WorkspacePreferences,
} from "@/src/v2/research-config";

function usagePercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

export function SettingsWorkspacePanel({
  authenticated,
  user,
  billing,
  preferences,
  onPreferencesChange,
}: {
  readonly authenticated: boolean;
  readonly user: { readonly name?: string | null; readonly email?: string | null } | null;
  readonly billing: BillingStatus | null;
  readonly preferences: V2WorkspacePreferences;
  readonly onPreferencesChange: (preferences: V2WorkspacePreferences) => void;
}) {
  const update = <K extends keyof V2WorkspacePreferences>(
    key: K,
    value: V2WorkspacePreferences[K],
  ) => onPreferencesChange({ ...preferences, [key]: value });

  return (
    <section className="v2-module-page v2-settings-workspace" aria-labelledby="v2-settings-title">
      <div className="v2-module-heading">
        <div>
          <p className="v2-eyebrow">ACCOUNT & WORKSPACE</p>
          <h1 id="v2-settings-title">Settings</h1>
        </div>
      </div>

      <div className="v2-settings-grid">
        <section className="v2-settings-card" aria-labelledby="v2-account-title">
          <div className="v2-settings-card-head">
            <UserRound aria-hidden />
            <div><strong id="v2-account-title">Account</strong><span>Identity and session</span></div>
          </div>
          {authenticated ? (
            <div className="v2-settings-account">
              <div><span>Name</span><strong>{user?.name?.trim() || "AIRA user"}</strong></div>
              <div><span>Email</span><strong>{user?.email?.trim() || "Not available"}</strong></div>
              <button type="button" onClick={() => void signOut({ callbackUrl: "/v2" })}>
                <LogOut aria-hidden /> Sign out
              </button>
            </div>
          ) : (
            <div className="v2-settings-account">
              <p>Sign in to sync conversations, memory, agent runs, sharing, and usage.</p>
              <Link href={`/signin?callbackUrl=${encodeURIComponent("/v2")}`}>Sign in</Link>
            </div>
          )}
        </section>

        <section className="v2-settings-card" aria-labelledby="v2-plan-title">
          <div className="v2-settings-card-head">
            <CreditCard aria-hidden />
            <div><strong id="v2-plan-title">Plan & usage</strong><span>Existing AIRA billing entitlements</span></div>
          </div>
          {authenticated && billing ? (
            <div className="v2-settings-usage">
              <div className="v2-plan-row"><span>Plan</span><strong>{billing.billingPlan}</strong></div>
              <div>
                <div className="v2-usage-row"><span>Searches</span><strong>{billing.searchesUsed} / {billing.monthlySearchLimit}</strong></div>
                <div className="v2-meter" aria-label={`${billing.searchesUsed} of ${billing.monthlySearchLimit} searches used`}><span style={{ width: `${usagePercent(billing.searchesUsed, billing.monthlySearchLimit)}%` }} /></div>
              </div>
              <div>
                <div className="v2-usage-row"><span>Agent runs</span><strong>{billing.agentRunsUsed} / {billing.monthlyAgentRunLimit}</strong></div>
                <div className="v2-meter" aria-label={`${billing.agentRunsUsed} of ${billing.monthlyAgentRunLimit} agent runs used`}><span style={{ width: `${usagePercent(billing.agentRunsUsed, billing.monthlyAgentRunLimit)}%` }} /></div>
              </div>
              <Link href="/pricing">Manage plan <ExternalLink aria-hidden /></Link>
            </div>
          ) : (
            <p className="v2-settings-muted">Usage appears here after sign-in.</p>
          )}
        </section>

        <section className="v2-settings-card v2-settings-card-wide" aria-labelledby="v2-research-defaults-title">
          <div className="v2-settings-card-head">
            <SlidersHorizontal aria-hidden />
            <div><strong id="v2-research-defaults-title">Research defaults</strong><span>Stored only in this browser; backend policy remains authoritative</span></div>
          </div>
          <div className="v2-settings-fields">
            <label>
              <span>Default research preset</span>
              <select
                value={preferences.defaultPreset}
                onChange={(event) => update("defaultPreset", event.target.value as ResearchPresetId)}
              >
                {V2_RESEARCH_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Default depth</span>
              <select
                value={preferences.defaultMode}
                onChange={(event) => update("defaultMode", event.target.value === "deep" ? "deep" : "standard")}
              >
                <option value="standard">Standard</option>
                <option value="deep">Deep Research</option>
              </select>
            </label>
          </div>
        </section>

        <section className="v2-settings-card v2-settings-card-wide" aria-labelledby="v2-interface-title">
          <div className="v2-settings-card-head">
            <Settings2 aria-hidden />
            <div><strong id="v2-interface-title">Interface</strong><span>Workspace display preferences</span></div>
          </div>
          <div className="v2-toggle-list">
            <label>
              <span><strong>Context panel</strong><small>Keep sources, history, and thread context visible on desktop.</small></span>
              <input
                type="checkbox"
                checked={preferences.contextPanelOpen}
                onChange={(event) => update("contextPanelOpen", event.target.checked)}
              />
            </label>
            <label>
              <span><strong>Reduce motion</strong><small>Disable non-essential V2 transitions and loading animation.</small></span>
              <input
                type="checkbox"
                checked={preferences.reduceMotion}
                onChange={(event) => update("reduceMotion", event.target.checked)}
              />
            </label>
          </div>
        </section>
      </div>
    </section>
  );
}
