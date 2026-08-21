"use client";

const FOOTER_SECTIONS = [
  {
    title: "Product",
    links: [
      ["Research", "/v2#research"],
      ["AIRA Agents", "/v2#agents"],
      ["Library", "/v2#library"],
      ["Memory", "/v2#memory"],
      ["Settings", "/v2#settings"],
      ["Pricing", "/pricing"],
    ],
  },
  {
    title: "Workspace",
    links: [
      ["New task", "/v2"],
      ["Research history", "/v2#research"],
      ["Versioned artifacts", "/v2#library"],
      ["Plan & usage", "/v2#settings"],
    ],
  },
  {
    title: "Research",
    links: [
      ["General", "/v2#research"],
      ["Academic", "/v2#research"],
      ["Startup", "/v2#research"],
      ["Coding", "/v2#research"],
      ["Shopping", "/v2#research"],
    ],
  },
  {
    title: "Agents",
    links: [
      ["Autonomous tasks", "/v2#agents"],
      ["Run history", "/v2#agents"],
      ["Artifacts", "/v2#library"],
    ],
  },
  {
    title: "Account",
    links: [
      ["Sign in", `/signin?callbackUrl=${encodeURIComponent("/v2")}`],
      ["Settings", "/v2#settings"],
      ["Upgrade", "/upgrade"],
    ],
  },
  {
    title: "AIRA",
    links: [
      ["Current interface", "/"],
      ["V2 workspace", "/v2"],
      ["Pricing", "/pricing"],
    ],
  },
] as const;

export function AiraFooter() {
  return (
    <footer className="aira-footer">
      <div className="aira-footer-inner">
        <h2 className="aira-footer-tagline">Less structure,<br />more intelligence.</h2>

        <div className="aira-footer-grid">
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.title}>
              <h3>{section.title}</h3>
              <ul>
                {section.links.map(([label, href]) => (
                  <li key={label}><a href={href}>{label}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="aira-footer-bottom">
          <div className="aira-footer-status"><span aria-hidden="true" /> Existing AIRA backend compatibility layer</div>
          <div className="aira-footer-meta">
            <span>English</span>
            <span>© 2026 AIRA AI</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
