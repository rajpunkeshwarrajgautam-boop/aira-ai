# AIRA AI — Oatmeal & Ink 2.0 Design System Specification

> **Identity**: AIRA AI — One workspace. Every intelligence.  
> **Visual Philosophy**: Premium, Editorial, Calm, Intelligent, Purpose-Built, Readable, Precise.

---

## 1. 60–30–10 Visual Principle

| Proportion | Role | Token / Value | Application |
| :--- | :--- | :--- | :--- |
| **60%** | Quiet Canvas | `#F9F8F6` (Oatmeal) | App background, workspace stages, thread layouts |
| **30%** | Crisp Surface | `#FFFFFF` (White) / `#FAF9F6` | Card containers, composer body, modals, topbar, rail |
| **10%** | Branded Accents | `#3A0CA3` (Royal Iris) / `#FF6B6B` (Warm Coral) | Primary submit actions, active navigation pills, focus rings, status indicators |

---

## 2. Color Palette & Functional Tokens

### Typography & Contrast (Deep Ink)
- **Primary Text (`--aira-text-0`)**: `#111115` (94% contrast against white)
- **Body Text (`--aira-text-1`)**: `#1E1E24`
- **Secondary Text (`--aira-text-2`)**: `#6B6A75` (Readable metadata, subtitles)
- **Muted Text (`--aira-text-3`)**: `#8F8E98` (Placeholders, disabled controls)

### Accent Tokens
- **Royal Iris (`--aira-accent`)**: `#3A0CA3`
- **Royal Iris Hover (`--aira-accent-hover`)**: `#2D0A82`
- **Royal Iris Soft Tint (`--aira-accent-soft`)**: `rgba(58, 12, 163, 0.08)`
- **Warm Coral (`--aira-warm-coral`)**: `#FF6B6B` (Alerts, attention badges)
- **Emerald Grounding (`--aira-emerald`)**: `#10B981` (Live telemetry, verified ground truth)

### Borders & Dividing Lines
- **Hairline Subtle**: `rgba(17, 17, 21, 0.08)`
- **Mid Divider**: `rgba(17, 17, 21, 0.14)`
- **Strong Boundary**: `rgba(17, 17, 21, 0.22)`
- **Focus Ring**: `rgba(58, 12, 163, 0.30)`

---

## 3. Layout & Above-The-Fold Structure

1. **Top Bar**:
   - Clean white `#FFFFFF` surface with subtle bottom border `rgba(17, 17, 21, 0.08)`.
   - Title display with destination icon, title, and concise purpose description.
   - Status badge: `AIRA workspace` with emerald pulsating indicator.
   - Accessible command palette trigger (`⌘K`).
2. **Navigation Rail**:
   - 240px wide executive dock.
   - Organized into 5 distinct intent groups:
     - **Discover**: Research (`/`), Models (`/compare`), Knowledge (`/knowledge`)
     - **Your Workspace**: Projects (`/projects`), Memory (`/memory`), Outputs (`/artifacts`)
     - **Create & Automate**: Build (`/build`), Agents (`/agents`), Work (`/work`), Workflows (`/workflows`), Browser (`/browser`)
     - **Infrastructure**: Route (`/omniroute`), Connections (`/settings#integrations`), Command Center (`/control-center`), Governance (`/governance`)
     - **Account**: Settings (`/settings`), Plans & Billing (`/pricing`), Global Search (`/workspace-search`)
   - Responsive off-canvas sliding drawer on viewports ≤ 1023px with 44px touch targets.
3. **Research Home Hero & Composer**:
   - Centered greeting: *"Where Autonomous Research Meets Grounded Truth."*
   - Single prominent hero composer positioned above the fold.
   - Crisp white card container with subtle shadow and Royal Iris focus ring.
   - Exactly three starter prompts:
     1. **Market Research**: *Competitive AI Infrastructure Due Diligence*
     2. **Security Audit**: *Sovereign Multi-Tenant Security & IDOR*
     3. **Architecture**: *Sub-100ms Inference Topologies & Routing*
   - Cluttered dark bento boxes and redundant cards completely eliminated.
4. **Sign-In Stage**:
   - Replaces dark cosmic astronaut modal with Oatmeal & Ink dual-panel editorial login stage.
   - Left panel: Quiet oatmeal background with subtle geometric watermark and brand promise.
   - Right panel: Crisp white card with GitHub OAuth and NextAuth authentication options.

---

## 4. Responsive Viewports & Evidence

- **Desktop (1440 × 900)**: Full 240px rail, centered 960px content stack, visible above the fold.
- **Tablet (768 × 1024)**: Off-canvas navigation drawer, 44px touch targets, centered hero composer.
- **Mobile (375 × 812)**: Compact topbar, 44px hamburger menu, fluid single-column layout without clipping.

Verified screenshot records:
- `docs/aira/oatmeal-ink-v2/screenshots/research_home_desktop_1440x900.png`
- `docs/aira/oatmeal-ink-v2/screenshots/research_home_tablet_768x1024.png`
- `docs/aira/oatmeal-ink-v2/screenshots/research_home_mobile_375x812.png`
- `docs/aira/oatmeal-ink-v2/screenshots/signin_desktop_1440x900.png`
- `docs/aira/oatmeal-ink-v2/screenshots/signin_mobile_375x812.png`
