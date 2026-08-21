"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export function MobileContextSheet({
  open,
  title,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="v2-context-sheet-backdrop" onMouseDown={onClose}>
      <section
        ref={panelRef}
        className="v2-context-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="v2-context-sheet-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong id="v2-context-sheet-title">{title}</strong>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close context panel">
            <X aria-hidden />
          </button>
        </header>
        <div className="v2-context-sheet-body">{children}</div>
      </section>
    </div>
  );
}
