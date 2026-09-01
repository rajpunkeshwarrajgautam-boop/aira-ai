# AIRA AI — Product Design System

## 1. Visual Theme & Atmosphere
AIRA is an intelligence workspace, not a chat skin. The interface must feel calm, precise, fast, trustworthy, and operationally powerful. It should support long research sessions, dense agent workflows, file-heavy knowledge work, model evaluation, and everyday conversation without changing visual identity.

Design reference synthesis:
- Claude: reading comfort, humane conversational tone, restrained hierarchy.
- Linear: information architecture, dense workspace precision, keyboard-first control, subtle motion.
- Vercel: developer-facing clarity, technical settings, disciplined typography.
- Notion: knowledge organization and document-oriented workspace ergonomics.
- Raycast/Superhuman: command palette and power-user speed.
- Apple: restraint, spacing quality, polished state transitions.

AIRA must not visually clone any of these products. Translate principles into one original system.

Core personality: calm + intelligent + powerful + precise + premium + trustworthy + fast.

Avoid cyberpunk aesthetics, excessive gradients, glassmorphism, neon accents, decorative glows, floating blobs, giant hero typography inside product surfaces, and repeated nested cards.

## 2. Color Palette & Roles
Use semantic tokens. Components must not hard-code unrelated color values.

### Dark mode — default product surface
- `--aira-bg`: #0A0C0F — app canvas
- `--aira-surface-1`: #0F1216 — primary workspace surface
- `--aira-surface-2`: #14181D — elevated controls/cards
- `--aira-surface-3`: #1A1F25 — menus/popovers/selected surfaces
- `--aira-border`: rgba(255,255,255,.08) — standard hairline
- `--aira-border-strong`: rgba(255,255,255,.14) — active/high-emphasis border
- `--aira-text`: #F2F2EE — primary text
- `--aira-text-secondary`: #A8ADB5 — secondary text
- `--aira-text-muted`: #737982 — metadata
- `--aira-accent`: #C8A95B — AIRA brass signal
- `--aira-accent-hover`: #D7B867
- `--aira-accent-soft`: rgba(200,169,91,.10)
- `--aira-success`: #46B97A
- `--aira-warning`: #D6A447
- `--aira-danger`: #E56B72
- `--aira-info`: #6FA8E8

### Light mode
- `--aira-bg`: #F6F6F3
- `--aira-surface-1`: #FFFFFF
- `--aira-surface-2`: #F0F1EE
- `--aira-surface-3`: #E9EAE6
- `--aira-border`: rgba(20,22,24,.10)
- `--aira-border-strong`: rgba(20,22,24,.18)
- `--aira-text`: #17191B
- `--aira-text-secondary`: #555B62
- `--aira-text-muted`: #777D84
- `--aira-accent`: #9B7933
- `--aira-accent-hover`: #856628
- `--aira-accent-soft`: rgba(155,121,51,.10)

Accent is a signal, not decoration. Reserve it for primary actions, focus, active navigation, important progress, execution state, and meaningful selection.

## 3. Typography Rules
Primary UI face: Geist Sans already bundled in the application.
Monospace: Geist Mono for code, logs, API data, model identifiers, tokens, and terminal output.

Recommended scale:
- Display: 40/44, 600, -0.03em — marketing or major onboarding only.
- H1: 30/36, 600, -0.025em.
- H2: 24/30, 600, -0.02em.
- H3: 18/24, 600, -0.01em.
- Title: 15/22, 600.
- Body: 15/24, 400.
- Body small: 14/21, 400.
- Label: 13/18, 500.
- Metadata: 12/17, 400.
- Micro: 11/16, 500.
- Code: 13/20, 400, Geist Mono.

Long AI answers should use a comfortable reading measure of roughly 680–820px with line-height around 1.6. Do not use display-sized typography for authenticated application pages unless the user is in a true onboarding/empty-state context.

## 4. Spacing & Layout
Base spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96.

Use spacing to establish hierarchy before adding cards or dividers.

Desktop shell:
- Full rail: 264–288px.
- Compact rail: 64–72px.
- Top bar: 56–60px.
- Main content max widths depend on task: chat 820–960px; settings 960–1100px; knowledge/agents 1200–1440px; model comparison can use full available width.

Avoid random per-page max-widths. Use shared layout primitives.

## 5. Geometry
- Radius XS: 4px
- Radius SM: 6px
- Radius MD: 8px
- Radius LG: 12px
- Radius XL: 16px
- Radius Full: 9999px only for semantic pills/status chips.

Default buttons and inputs should generally use 8px. Dialogs and major elevated panels may use 12–16px. Avoid making every card `rounded-2xl`.

## 6. Depth & Elevation
Hierarchy priority:
1. surface contrast
2. spacing
3. typography
4. borders
5. subtle shadows

Shadows are reserved for floating UI: command palette, popovers, tooltips, dialogs, elevated composer, and drag previews. Static workspace panels should usually rely on border + surface contrast.

Suggested shadow tokens:
- `--aira-shadow-float`: 0 12px 40px rgba(0,0,0,.28)
- `--aira-shadow-dialog`: 0 24px 80px rgba(0,0,0,.38)

## 7. Navigation
Navigation must reflect product priority, not feature inventory.

Primary level:
- New task / Research
- Search
- Chats / recent work
- Agents / Runs
- Knowledge / Files

Secondary or advanced destinations may include model comparison, local runtime, browser agent, swarms, projects, integrations, governance, analytics, and billing.

Use progressive disclosure. Do not permanently expose every advanced destination at equal visual weight.

Desktop: persistent rail.
Tablet: compact icon rail or drawer depending on width.
Mobile: drawer/bottom-sheet or concise bottom navigation for highest-frequency destinations.

Command palette: Ctrl/Cmd + K. It should search navigation and later support commands/actions.

## 8. Chat & Conversation
The chat surface is reading-first.

Message hierarchy:
- User message visually distinct but restrained.
- Assistant response should read like content, not a giant chat bubble.
- Tool activity and citations are secondary layers.
- Response actions stay quiet until hover/focus or response completion.

Support rich Markdown, code, tables, citations, files, images, artifacts, tool execution, and streaming states.

Composer requirements:
- multiline input
- attach file/image
- model/mode selection
- tool/research access
- send/stop state
- progressive disclosure for advanced controls

The default experience remains: type → send.

## 9. Model Selection & Comparison
Model selector defaults to `Auto / Best for task` where the runtime supports it. Group models by practical capability rather than provider branding alone: Recommended, Fast, Reasoning, Coding, Research, Vision, Local, Custom.

Comparison workspace must support real provider selection, one shared prompt, side-by-side output, latency, model identity, error states, and continuation from a preferred result where supported.

Results should use columnar comparison surfaces, not isolated marketing cards.

## 10. Agents & Run Center
Clearly separate conversation from delegated work.

Agent entity should expose role, instructions, tools, model, memory, permissions, workflow, and execution history.

Run states: queued, planning, working, waiting, completed, failed, cancelled.

A run timeline should show meaningful operations: subtasks, tool calls, model calls, browser work, files created, sources, outputs, and errors. Avoid sci-fi swarm diagrams unless they improve operational understanding.

## 11. Knowledge & Files
Treat knowledge as a workspace, not an upload box.

Views may include Recent, Uploaded, Generated, Collections, and Knowledge Bases.

Each file should support contextual actions when backed by real APIs: Ask AIRA, summarize, extract, compare, research, transform, attach to conversation.

Statuses such as uploading, queued, processing, ready, and failed must be legible without relying on color alone.

## 12. Settings & Integrations
Use a two-level settings architecture: section navigation + focused content panel.

Recommended sections: General, Appearance, Models, Providers, AI Behavior, Memory, Agents, Tools, Integrations, Data & Privacy, Notifications, Billing, Usage, Keyboard Shortcuts.

Integration states: available, connected, disconnected, configuration required, permission required, error.

Technical settings should use Vercel/Linear-level structural clarity without copying their branding.

## 13. Components
Shared primitives should include:
- AppShell / WorkspaceFrame
- Sidebar / NavGroup / NavItem
- WorkspaceHeader
- CommandPalette
- Composer
- Message / AssistantResponse / ToolActivity
- ResponseActions
- ModelPicker / ToolPicker
- AgentCard / AgentRun / RunTimeline
- FileRow / KnowledgeItem
- SearchResult
- ArtifactPanel
- SettingsSection / IntegrationRow
- Button / IconButton / Input / Textarea / Select
- Dialog / Popover / Tooltip / Toast
- Tabs / SegmentedControl
- Table / DataList
- EmptyState / Skeleton / ErrorState

Every component must implement relevant default, hover, focus, active, selected, disabled, loading, success, and error states.

## 14. Motion & Interaction
- Micro: 100–160ms
- Standard: 160–240ms
- Larger layout: 240–360ms

Use natural ease-out/ease-in-out curves. No bounce, elastic easing, idle animation loops, parallax, decorative particles, or animated gradients in core workspace UI.

Respect `prefers-reduced-motion` and simplify transitions accordingly.

## 15. Responsive Behavior
Design intentionally for approximately 320, 375, 430, 768, 1024, 1280, 1440, and 1920px.

Do not shrink desktop layouts mechanically.

At smaller widths:
- collapse or replace sidebars
- reduce secondary controls
- preserve composer height and touch usability
- transform wide tables into scrollable or stacked representations
- collapse artifact/chat split view into a switchable surface
- use full-width dialogs/bottom sheets where appropriate

Touch targets should generally approach 44px where practical.

## 16. Accessibility
Target WCAG 2.2 AA.

Required by default:
- semantic HTML
- logical heading hierarchy
- keyboard navigation
- visible focus rings
- labeled controls
- ARIA only where semantic HTML is insufficient
- adequate contrast
- screen-reader status announcements for meaningful async changes
- reduced-motion support
- non-color-only status communication

Never remove focus outlines without a replacement.

## 17. Empty, Loading & Error States
Empty states answer: what is this, why does it matter, what should I do next?

Loading: prefer skeletons, streamed output, and truthful contextual status. Do not rotate through fake activity labels disconnected from actual backend state.

Errors must be explicit and recoverable when possible: offline, request failed, rate limit, model unavailable, provider auth failure, upload failure, unsupported file, tool failure, agent failure, partial completion.

## 18. Design Router
Use these references by product surface:
- Conversation: Claude + original AIRA.
- Application shell/dense navigation: Linear.
- Providers/settings/technical configuration: Vercel + Linear.
- Knowledge/documents: Notion + Linear.
- Command interactions: Raycast + Superhuman.
- Marketing/onboarding presentation: Apple + Vercel.

Resolve all references into AIRA tokens and patterns. Never splice recognizable branded UI fragments together.

## 19. Do's
- Prefer hierarchy over decoration.
- Use one coherent icon family.
- Use semantic tokens instead of scattered hex values.
- Keep high-frequency actions obvious and advanced actions discoverable.
- Preserve real backend functionality during visual refactors.
- Design for hundreds of chats, thousands of files, many agents, and many model providers.
- Refine desktop and mobile independently.
- Make state and system activity understandable.

## 20. Don'ts
- No generic purple AI gradients.
- No glass cards by default.
- No giant glowing spheres or aurora blobs.
- No fake charts or fake activity.
- No meaningless statistics.
- No nested card stacks.
- No excessive pill buttons.
- No arbitrary radii or spacing.
- No page-specific hard-coded theme systems that conflict with global tokens.
- No dead controls or placeholder features presented as functional.
- No destructive backend rewrites for cosmetic goals.

## 21. Agent Implementation Guidance
Before changing a major screen:
1. inspect current functionality and API dependencies
2. identify the product task and information hierarchy
3. select relevant design references through the router
4. map the screen to AIRA semantic tokens
5. reuse or improve shared primitives before adding page-local styles
6. implement empty/loading/error/success states
7. verify keyboard and focus behavior
8. verify 375, 768, 1280, and 1440px layouts at minimum
9. remove decorative or redundant UI that does not improve comprehension
10. preserve working backend contracts

The completion test is not whether the page compiles. It is whether the workflow is coherent, visually consistent, responsive, accessible, performant, and recognizably AIRA.