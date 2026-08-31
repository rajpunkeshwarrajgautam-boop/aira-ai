"use client";

import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { CapabilityGate, type CapabilityState } from "@/components/CapabilityGate";
import surface from "../workspace-surface.module.css";

type AccessPayload = { readonly analyticsAdmin?: boolean; readonly error?: { readonly message?: string } };

export default function GovernancePage() {
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/access", { credentials: "include", cache: "no-store" });
      const body = (await response.json()) as AccessPayload;
      if (!response.ok) throw new Error(body.error?.message ?? "Governance access could not be verified.");
      setAccess(body);
    } catch (cause) {
      setAccess(null);
      setError(cause instanceof Error ? cause.message : "Governance access could not be verified.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const state: CapabilityState = loading ? "permission-required" : access?.analyticsAdmin ? "unsupported" : "permission-required";
  const detail = loading
    ? "Verifying the current account's server-authoritative admin capability."
    : error
      ? error
      : access?.analyticsAdmin
        ? "Admin capability is verified. Policy mutation, retention and sovereignty controls do not yet have a complete server-side persistence contract, so AIRA exposes no decorative toggles."
        : "This account does not have the admin capability required for enterprise governance. Existing user-scoped settings remain available.";

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={surface.page}>
          <div className={surface.inner}>
            <CapabilityGate
              eyebrow="System"
              title="Data Governance"
              description="Enterprise policy and sovereignty controls remain permission-aware and fail closed."
              state={state}
              detail={detail}
              actions={access?.analyticsAdmin
                ? [
                    { href: "/admin/analytics", label: "Open Analytics" },
                    { href: "/settings#integrations", label: "Open Integrations" },
                  ]
                : [
                    { href: "/settings#integrations", label: "Open Settings" },
                    { href: "/control-center", label: "Open Control Center" },
                  ]}
            >
              <div className={surface.facts} aria-label="Governance capability">
                <div><span>Admin access</span><strong>{loading ? "Checking…" : access?.analyticsAdmin ? "Verified" : "Not granted"}</strong></div>
                <div><span>Policy mutation contract</span><strong>Not implemented</strong></div>
                <div><span>Security posture</span><strong>Fail closed</strong></div>
              </div>
              <button type="button" className={surface.secondary} onClick={() => void refresh()} disabled={loading}>
                {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                Refresh access
              </button>
            </CapabilityGate>

            <section className={surface.note} aria-label="Governance implementation policy">
              <ShieldCheck className="size-4" aria-hidden />
              <div>
                <strong>No decorative enterprise controls</strong>
                <p>Retention rules, sovereignty regions, policy switches and audit actions become interactive only after their server-side authorization and persistence contracts exist.</p>
              </div>
            </section>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
