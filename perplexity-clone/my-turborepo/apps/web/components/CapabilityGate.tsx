import { ArrowUpRight, CircleAlert, CircleCheck, CircleDashed, CircleOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import styles from "./CapabilityGate.module.css";

export type CapabilityState = "available" | "not-configured" | "offline" | "unsupported" | "permission-required";

const STATE_COPY: Record<CapabilityState, { label: string; icon: typeof CircleCheck }> = {
  available: { label: "Available", icon: CircleCheck },
  "not-configured": { label: "Not configured", icon: CircleDashed },
  offline: { label: "Offline", icon: CircleOff },
  unsupported: { label: "Backend contract required", icon: CircleAlert },
  "permission-required": { label: "Permission required", icon: CircleAlert },
};

const STATE_CLASS: Record<CapabilityState, string | undefined> = {
  available: styles.stateAvailable,
  "not-configured": undefined,
  offline: styles.stateOffline,
  unsupported: styles.stateUnsupported,
  "permission-required": styles.statePermission,
};

export function CapabilityGate({
  eyebrow,
  title,
  description,
  state,
  detail,
  actions,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly state: CapabilityState;
  readonly detail: string;
  readonly actions: readonly { href: string; label: string }[];
  readonly children?: ReactNode;
}) {
  const meta = STATE_COPY[state];
  const StateIcon = meta.icon;

  return (
    <section className={styles.gate} aria-labelledby="capability-title">
      <div className={styles.eyebrow}>{eyebrow}</div>
      <div className={styles.head}>
        <div>
          <h1 id="capability-title">{title}</h1>
          <p>{description}</p>
        </div>
        <span className={cn(styles.state, STATE_CLASS[state])}>
          <StateIcon className="size-3.5" aria-hidden />
          {meta.label}
        </span>
      </div>

      <div className={styles.body}>
        <div className={styles.detail}>
          <strong>Current capability</strong>
          <p>{detail}</p>
        </div>
        {children}
      </div>

      {actions.length ? (
        <div className={styles.actions} aria-label="Capability actions">
          {actions.map((action) => (
            <Link key={`${action.href}:${action.label}`} href={action.href} className={styles.action}>
              {action.label}
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
