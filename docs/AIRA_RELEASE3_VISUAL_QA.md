# AIRA AI — Release 3 Visual QA

## Responsive & Layout Specifications

| Breakpoint | Dimensions | Target Surface | Status |
| :--- | :--- | :--- | :--- |
| Mobile Small | `390x844` | Sign-in, Navigation, Search, Models | PASS — No horizontal overflow |
| Mobile Large | `430x932` | Sign-in, Navigation, Search, Models | PASS — Clean touch targets |
| Desktop HD | `1366x768` | Full Workspace Shell & Navigation | PASS — Clean rail & collapse |
| Desktop Full HD | `1440x900` | Full Workspace Shell & Navigation | PASS — Standard desktop density |
| Desktop Ultra | `1920x1080` | High-density Analytics & Workspaces | PASS — Optimal spacing |

## Surface Integrity Highlights

1. **Authentication (`/signin`)**:
   - Fixed malformed SVG geometry (`20-20c0` -> standard SVG commands) in `GoogleGlyph`.
   - Verified 0 console SVG parsing errors in Chromium DOM inspector.

2. **Navigation Rail (`components/AiraV2Frame.tsx`)**:
   - Clean grouping under `PRIMARY`, `CREATE`, `WORKSPACE`, `INTELLIGENCE`, and `SYSTEM`.
   - Consolidated `/browser-agent` into canonical `/browser`.

3. **Pricing Surface (`/pricing`)**:
   - Updated messaging to reflect active commercial release status while keeping fail-closed checkout security assertions intact.

4. **Model Lab (`/compare`)**:
   - Displays explicit entitlement and configuration status cards instead of `0 targets available`.
