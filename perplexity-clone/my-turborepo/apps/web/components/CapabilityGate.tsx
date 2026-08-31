import { ArrowUpRight, CircleAlert, CircleCheck, CircleDashed, CircleOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export type CapabilityState = "available" | "not-configured" | "offline" | "unsupported" | "permission-required";

const STATE_COPY: Record<CapabilityState, { label: string; icon: typeof CircleCheck }> = {
  available: { label: "Available", icon: CircleCheck },
  "not-configured": { label: "Not configured", icon: CircleDashed },
  offline: { label: "Offline", icon: CircleOff },
  unsupported: { label: "Backend contract required", icon: CircleAlert },
  "permission-required": { label: "Permission required", icon: CircleAlert },
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
    <section className="aira-capability-gate" aria-labelledby="capability-title">
      <div className="aira-capability-gate__eyebrow">{eyebrow}</div>
      <div className="aira-capability-gate__head">
        <div>
          <h1 id="capability-title">{title}</h1>
          <p>{description}</p>
        </div>
        <span className={`aira-capability-state is-${state}`}>
          <StateIcon className="size-3.5" aria-hidden />
          {meta.label}
        </span>
      </div>

      <div className="aira-capability-gate__body">
        <div className="aira-capability-gate__detail">
          <strong>Current capability</strong>
          <p>{detail}</p>
        </div>
        {children}
      </div>

      <div className="aira-capability-gate__actions" aria-label="Capability actions">
        {actions.map((action) => (
          <Link key={`${action.href}:${action.label}`} href={action.href} className="aira-capability-action">
            {action.label}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        ))}
      </div>
    </section>
  );
}