"use client";

import { ArrowUpRight, CheckCircle2, Loader2, RefreshCw, Settings2, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AiraV2Frame } from "@/components/AiraV2Frame";
import { cn } from "@/lib/cn";
import styles from "./settings.module.css";

type Integration = {
  readonly id: string;
  readonly label: string;
  readonly configured: boolean;
  readonly detail: string;
  readonly model?: string;
};
type Status = {
  readonly integrations: Integration[];
  readonly defaults: {
    readonly primaryProvider: string;
    readonly fallbackProvider: string;
    readonly localRouting?: string;
  };
};

const INTEGRATION_DESTINATIONS: Readonly<Record<string, { href: string; label: string }>> = {
  openai: { href: "/compare", label: "Open Model Lab" },
  nvidia: { href: "/compare", label: "Open Model Lab" },
  "self-hosted": { href: "/local-ai", label: "Open Local AI" },
  exa: { href: "/", label: "Open Research" },
  knowledge: { href: "/knowledge", label: "Open Knowledge" },
  deerflow: { href: "/agents", label: "Open Agents" },
  autogpt: { href: "/agents", label: "Open Agents" },
};

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/status", {
        cache: "no-store",
        credentials: "include",
      });
      const data = (await response.json().catch(() => null)) as (Status & { error?: { message?: string } }) | null;
      if (!response.ok || !data) throw new Error(data?.error?.message ?? "Could not load integration status.");
      setStatus(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load integration status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <main className={styles.page}>
          <div className={styles.inner}>
            <header className={styles.header}>
              <div>
                <p className={styles.eyebrow}>Settings</p>
                <h1 className={styles.title}>Runtime & integrations</h1>
                <p className={styles.description}>
                  A live view of services configured on this AIRA deployment. Provider credentials and private endpoints stay server-side; this screen exposes configuration state and safe model metadata, not an uptime guarantee.
                </p>
              </div>
              <button type="button" onClick={() => void loadStatus()} disabled={loading} className={styles.button}>
                <RefreshCw className={cn("size-3.5", loading && styles.spin)} aria-hidden /> Refresh status
              </button>
            </header>

            {message ? (
              <div className={styles.error} role="alert">
                <span>{message}</span>
                <button type="button" onClick={() => void loadStatus()} className={styles.retry}>Retry</button>
              </div>
            ) : null}

            {loading && !status ? (
              <div className={styles.loading}><Loader2 className={cn("size-5", styles.spin)} aria-label="Loading integration status" /></div>
            ) : status ? (
              <>
                <section className={styles.summaryGrid}>
                  <article className={styles.panel}>
                    <div className={styles.panelHeader}>
                      <span className={styles.panelIcon}><Settings2 className="size-4" aria-hidden /></span>
                      <div><h2>Model routing</h2><p>Current deployment defaults</p></div>
                    </div>
                    <dl className={styles.facts}>
                      <div className={styles.fact}><dt>Primary</dt><dd>{status.defaults.primaryProvider}</dd></div>
                      <div className={styles.fact}><dt>Fallback</dt><dd>{status.defaults.fallbackProvider}</dd></div>
                      {status.defaults.localRouting ? <div className={styles.fact}><dt>Local routing</dt><dd>{status.defaults.localRouting}</dd></div> : null}
                    </dl>
                    <Link href="/compare" className={styles.link}>Test configured providers <ArrowUpRight className="size-3.5" aria-hidden /></Link>
                  </article>

                  <article className={styles.panel}>
                    <div className={styles.panelHeader}>
                      <span className={styles.panelIcon}><ShieldCheck className="size-4" aria-hidden /></span>
                      <div><h2>Server-side trust boundary</h2><p>Configuration without credential exposure</p></div>
                    </div>
                    <p>
                      Integration credentials and infrastructure endpoints remain deployment-level configuration. AIRA reports whether a capability is configured without returning API keys or private endpoint URLs to the browser.
                    </p>
                  </article>
                </section>

                <section id="integrations" className={styles.services} aria-label="Integration status">
                  <header className={styles.servicesHeader}>
                    <h2>Integration status</h2>
                    <p>Live configuration state reported by the current deployment.</p>
                  </header>
                  <ul className={styles.list}>
                    {status.integrations.map((integration) => {
                      const destination = INTEGRATION_DESTINATIONS[integration.id];
                      return (
                        <li key={integration.id} className={styles.row}>
                          <span className={cn(styles.stateIcon, integration.configured && styles.stateOn)} aria-hidden>
                            {integration.configured ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                          </span>
                          <div className={styles.copy}>
                            <strong>{integration.label}</strong>
                            <span title={`${integration.detail}${integration.model ? ` · ${integration.model}` : ""}`}>
                              {integration.detail}{integration.model ? ` · ${integration.model}` : ""}
                            </span>
                          </div>
                          <span className={cn(styles.badge, integration.configured && styles.badgeOn)}>
                            {integration.configured ? "Configured" : "Not configured"}
                          </span>
                          {destination ? (
                            <Link href={destination.href} className={styles.action}>
                              {destination.label}<ArrowUpRight className="size-3" aria-hidden />
                            </Link>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </>
            ) : null}
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}
