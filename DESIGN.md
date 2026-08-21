# AIRA AI — Design Direction

## Intent
AIRA should feel like a serious research and execution instrument: calm, dense enough for power use, legible for long sessions, and fast to navigate.

## Visual language
- Dark, slightly warm/tinted graphite surfaces rather than pure black.
- Warm brass accent used sparingly for focus, active state, and premium emphasis.
- Strong typographic hierarchy with compact operational labels.
- Borders and contrast establish structure; avoid gratuitous glass, glow, and gradient effects.
- Use open canvas and dividers before introducing another card.

## Navigation
- Persistent desktop rail with text labels and grouped destinations.
- Mobile bottom navigation keeps the four primary destinations available.
- Command palette provides keyboard-first navigation with Ctrl/Command + K.
- Never expose a control that does not perform a real action.

## Interaction
- Fast 140–180ms state transitions.
- No bounce or elastic easing.
- Clear focus-visible states.
- Active state should be obvious without excessive color.
- Motion communicates state changes rather than decorating idle UI.

## Type
- Geist remains the application UI face because it is already bundled and highly legible.
- Use weight, size, width, and casing to build hierarchy rather than mixing many typefaces.
- Long-form answers optimize for reading width and line-height.

## Responsive behavior
- >= 1180px: full text navigation rail.
- 768–1179px: compact icon rail.
- < 768px: bottom navigation; topbar preserves current context and command access.

## Anti-patterns
- No nested card stacks.
- No decorative gradient text.
- No oversized hero treatment inside authenticated product surfaces.
- No fake settings, model selectors, or integrations.
- No gray-on-gray low-contrast metadata.
