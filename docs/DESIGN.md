# AIRA AI — Design System and UI/UX Specification

> **Document Type**: Authoritative Design System & Implementation Reference  
> **Status**: Active / Production Baseline  
> **Last Verified**: 2026-09-20  
> **Repository Root**: [c:/Users/WORKSTATION/aira-ai](file:///c:/Users/WORKSTATION/aira-ai)  
> **Related Documents**:
> - Foundational Design Direction: [DESIGN.md](file:///c:/Users/WORKSTATION/aira-ai/DESIGN.md) *(Root reference; immutable)*
> - Product Requirements: [docs/PRD.md](file:///c:/Users/WORKSTATION/aira-ai/docs/PRD.md)
> - Technical Architecture: [docs/ARCHITECTURE.md](file:///c:/Users/WORKSTATION/aira-ai/docs/ARCHITECTURE.md)
> - Engineering Guardrails: [docs/RULES.md](file:///c:/Users/WORKSTATION/aira-ai/docs/RULES.md)
> - Task Ledger: [docs/TASKS.md](file:///c:/Users/WORKSTATION/aira-ai/docs/TASKS.md)
> - Operational Memory: [docs/MEMORY.md](file:///c:/Users/WORKSTATION/aira-ai/docs/MEMORY.md)
> - Primary Stylesheets: [apps/web/app/aira-v2.css](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/app/aira-v2.css) | [apps/web/app/globals.css](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/app/globals.css)

---

## 1. Intent & Brand Identity

AIRA AI is designed as a serious, focused research and execution instrument. It embodies a calm, high-density, low-distraction aesthetic intended for long, deep-work sessions.

### 1.1 Core Visual Philosophy
- **Dark, Tinted Graphite Surfaces**: Rejects harsh pure blacks (`#000000`) in favor of warm, tinted graphite tones (`#0b0d10`, `#101318`, `#1a1e24`) that reduce eye fatigue.
- **Warm Brass Accent**: Warm brass (`#ceae56` / `#d0b665`) is applied with strict economy—reserved exclusively for active states, focus rings, verified citation badges, and high-priority operational indicators.
- **Open Canvas Over Card Walls**: Employs open canvas layouts, subtle hairline dividers, and intentional negative space before introducing container cards. Card stacks and nested containers are prohibited.
- **Direct Operational Honesty**: Every control, badge, selector, and status indicator must represent genuine application state. Decorative or non-functional UI controls are strictly forbidden.

---

## 2. Color Palette & Verified Design Tokens

The design tokens below are extracted directly from production stylesheets ([aira-v2.css](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/app/aira-v2.css), [globals.css](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/app/globals.css), and [tailwind.config.ts](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/tailwind.config.ts)):

### 2.1 Dark Surface Palette (Primary Theme)

| Token Name | Hex / Value | Usage & Visual Role |
| :--- | :--- | :--- |
| `--page-bg` | `#0b0d10` | Main application background canvas (`.aira-v2-page`, `.aira-v2-frame`) |
| `--rail-bg` | `#101318` | Persistent desktop sidebar rail (`.aira-v2-rail`) |
| `--surface-active` | `#1a1e24` | Active navigation items, selected cards, elevated panels (`.is-active`) |
| `--surface-elevated` | `rgba(255, 255, 255, 0.03)` | Modal dialogs, dropdowns, floating panels |
| `--border-subtle` | `rgba(255, 255, 255, 0.07)` | Hairline dividers, panel borders, subtle container outlines |
| `--border-focus` | `rgba(206, 174, 86, 0.35)` | Active item borders, input focus states |

### 2.2 Warm Brass Accent System

| Token Name | Hex / Value | Usage & Visual Role |
| :--- | :--- | :--- |
| `--accent-brass` | `#ceae56` | Primary active accent: vertical active indicator bars, primary CTA states |
| `--accent-brass-bright` | `#d0b665` | Active icons, verified badges, highlighted text markers |
| `--accent-brass-muted` | `rgba(206, 174, 86, 0.14)` | Active item background tints, subtle badge borders |
| `--accent-brass-glow` | `rgba(206, 174, 86, 0.08)` | Soft focus rings, keyboard navigation focus indicators |

### 2.3 Typography & Content Colors

| Token Name | Hex / Value | Usage & Visual Role |
| :--- | :--- | :--- |
| `--text-primary` | `#f1f0eb` / `#f3f0e8` | Primary headings, body copy, answer stream text |
| `--text-secondary` | `#b7babd` / `#8e95a2` | Subheadings, metadata, inactive navigation labels |
| `--text-tertiary` | `#72777f` / `#626871` | Micro labels, timestamps, shortcut badges, helper text |

---

## 3. Typography Hierarchy

AIRA AI uses two complementary type families:
1. **Geist Sans (`var(--font-geist-sans)`)**: Primary UI typeface across all navigation, controls, buttons, cards, and data tables.
2. **Geist Mono (`var(--font-geist-mono)`)**: Code blocks, model names, cryptographic hashes, JSON payloads, and terminal outputs.
3. **Display Serif (`Georgia, "Times New Roman", serif`)**: Applied selectively to the `.aira-display` class for editorial elegance on research titles.

```
Display Large:   32px / line-height: 1.25 / letter-spacing: -0.035em (Serif display)
H1 / Page Title: 24px / line-height: 1.3  / font-weight: 700 / Geist Sans
H2 / Section:    18px / line-height: 1.4  / font-weight: 600 / Geist Sans
Body Copy:       15px / line-height: 1.78 / font-weight: 400 / Geist Sans (Answer Stream)
UI Labels:       12px / line-height: 1.4  / font-weight: 700 / letter-spacing: 0.08em
Micro / Badges:  10px / line-height: 1.2  / font-weight: 600 / Geist Mono
```

---

## 4. Spacing, Grid & Layout Geometry

### 4.1 Master Frame Geometry
The master frame (`AiraV2Frame.tsx`) defines the layout geometry across screen widths:

```
┌──────────────┬─────────────────────────────────────────────────────────┐
│              │ Workspace Header (Search, Command Palette, User Profile) │
│  Desktop     ├─────────────────────────────────────────────────────────┤
│  Rail        │                                                         │
│  (236px)     │  Main Content Canvas (max-w-4xl or fluid data grid)      │
│  Fixed       │                                                         │
│              │                                                         │
└──────────────┴─────────────────────────────────────────────────────────┘
```

### 4.2 Responsive Breakpoint Specifications
- **Desktop (>= 1180px)**:
  - Full desktop rail: width `236px`, fixed left, sticky `100dvh`.
  - Displays full brand typography, grouped navigation links, and bottom user status.
- **Tablet (768px – 1179px)**:
  - Compact rail: width `64px`, fixed left.
  - Collapses labels to centered icons with tooltip hover states.
- **Mobile (< 768px)**:
  - Desktop rail hidden.
  - Top header preserves context title and search access.
  - Fixed bottom navigation bar (`h-14`) exposing the four primary destinations: Search, Agents, Memory, and Settings.

---

## 5. Core Component Anatomy

### 5.1 Search & Query Input (`SearchBox.tsx`)
- Located centrally on empty states; transitions smoothly to the top of the viewport when an active conversation starts.
- Rounded container (`rounded-xl`) with background `#101318` and subtle border `rgba(255,255,255,0.07)`.
- Model selector button: compact pill showing active model (`NVIDIA Nemotron` / `OmniRoute`) with real-time routing status.
- Submit action: keyboard-triggered with `Enter` (or `Shift + Enter` for multi-line inputs).

### 5.2 Answer Stream & Citation Display (`AnswerStream.tsx`, `CitationCards.tsx`)
- Streams SSE tokens without layout jumping or stutter.
- Markdown rendering via `@tailwindcss/typography` with customized prose colors:
  - Line height: `1.78` for effortless reading.
  - Citation tags: Small inline pill badges (`[1]`, `[2]`) linked directly to the corresponding source card.
- Source Citation Cards: Displayed in a horizontal scroll rail or compact grid below the answer. Shows favicon, domain name, article title, and verified excerpt snippet.

### 5.3 Tool Approval Panel (`ToolApprovalPanel.tsx`)
- Surfaces human-in-the-loop permission requests during agent runs.
- Distinct warning perimeter with amber/brass highlights (`rgba(206,174,86,0.2)`).
- Explicitly presents: Tool ID, requested operation, risk classification (`LOW`, `MEDIUM`, `HIGH`), and payload preview.
- Two unambiguous action buttons: **Approve** (green tone `#22c55e`) and **Deny** (muted zinc `#71717a`).

---

## 6. Interaction, Motion & Micro-Animations

- **Transition Durations**: Strictly bounded to `140–180ms`.
- **Easing Function**: `cubic-bezier(0.2, 0.75, 0.25, 1)` for clean, snappy deceleration.
- **Zero Elastic Easing**: Bouncing, rubber-banding, or spring physics are strictly prohibited.
- **Focus Visibility**: Clear keyboard focus rings (`outline: 2px solid #ceae56; outline-offset: 2px`).
- **Subtle State Pulsing**: Background tasks and streaming indicators use a gentle pulse (`.aira-soft-pulse`, 2.2s duration) rather than erratic spinning loaders.

---

## 7. Anti-Patterns & Prohibited Design Practices

1. **No Gratuitous Glassmorphism**: Avoid heavy background blurs (`backdrop-blur-xl`) that degrade frame rate on lower-end devices.
2. **No Nested Card Stacks**: Do not place cards inside cards inside cards. Use borders and spacing to delineate hierarchy.
3. **No Decorative Gradient Text**: Gradient text effects are prohibited in product UI.
4. **No Fake Controls or Badges**: Never render a dropdown, button, or toggle that does not trigger real backend logic.
5. **No Low-Contrast Metadata**: All secondary and tertiary text must satisfy WCAG AA contrast standards against dark graphite backgrounds.
