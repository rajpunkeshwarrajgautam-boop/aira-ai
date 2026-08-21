"use client";

export function AiraLogo({ className = "" }: { className?: string }) {
  return (
    <a href="/v2" className={`aira-logo ${className}`.trim()} aria-label="AIRA AI home">
      <svg
        className="aira-logo-mark"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M12 2 4 6v12l8 4 8-4V6l-8-4Z" fill="currentColor" opacity="0.92" />
        <path d="m12 6-4 2v8l4 2 4-2V8l-4-2Z" fill="#f8f8f7" />
        <circle cx="12" cy="12" r="2" fill="#f8f8f7" />
      </svg>
      <span className="aira-logo-wordmark">AIRA AI</span>
    </a>
  );
}
