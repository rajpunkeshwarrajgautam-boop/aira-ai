# RIVA-Inspired UI Redesign Plan

This document outlines a technical and design roadmap to evolve the Perplexity clone's UI using high-level principles from the [RIVA AI Assistant](https://www.behance.net/gallery/246806447/RIVA-AI-Assistant-Dashboard-UIUX-Design-Qudra) design. 

## Visual Analysis & Design Principles

### 1. Dashboard & Workspace Pattern
- **Analysis**: RIVA transitions the chat from a vertical stream into a structured workspace. It uses a clean, persistent navigation sidebar on the left and a centralized content area with modular "widgets" or cards.
- **Principle**: Shift from a "Chat-only" view to a "Research Workspace" where tools, history, and the current answer feel integrated.

### 2. Card Hierarchy & Modularity
- **Analysis**: Instead of one long stream, RIVA uses distinct cards with soft shadows and ~16px corner radius. This separates the "Thought process", the "Direct Answer", and "Citations" into digestible units.
- **Principle**: Group related information into standalone cards to improve scannability.

### 3. Typography & Spacing
- **Analysis**: Bold, legible headers with significant white space between sections. Minimalistic icons that don't distract from the content.
- **Principle**: Use higher contrast typography and increase line heights for long-form research content.

### 4. Color & Glassmorphism
- **Analysis**: Deep, sleek dark mode with subtle translucent layers and high-quality gradients.
- **Principle**: Enhance our current use of `backdrop-blur` and `surface-elevated` overlays for a more premium, layered feel.

---

## Comparison with Current App

| Feature | Current Implementation | RIVA Recommendation |
| :--- | :--- | :--- |
| **Sidebar** | List of untitled threads. | Categorized navigation (Research, Saved, History). |
| **Answer Flow** | Single block `AnswerStream`. | Modular cards for planning, drafting, and final answer. |
| **Citations** | Grid of small cards inside a larger card. | High-fidelity cards with larger favicons and hover actions. |
| **Search Box** | Minimalist sticky bottom. | Glassmorphic floating input with quick-action toggles. |

---

## Implementation Roadmap

### Phase 1: High-Fidelity Citations & Cards
- **Modify**: `CitationCards.tsx` to use more elevated card styles and larger domain representations.
- **Modify**: `AnswerStream.tsx` to wrap different phases (connecting, streaming) in distinct, subtly transitioning containers.

### Phase 2: Workspace Layout Refactor
- **Modify**: `SearchLayout.tsx` to introduce a true "Research Dashboard" feel.
- **Adopt**: Icons for sidebar navigation (e.g., using `lucide-react` for Dashboard, Library, Discover).
- **Keep**: The Homepage as a "Search-First" minimal interface; move the "RIVA Dashboard" style to the `/app` or `/search` result routes.

### Phase 3: Glassmorphism & Depth
- **Modify**: `SearchBox.tsx` to use `backdrop-filter: blur(12px)` and a more prominent floating shadow.
- **Refine**: The global dark mode palette to use deep charcoals and harmonized accent colors (HSL-based).

---

## Risks & Considerations
1. **Performance**: Heavy use of `backdrop-blur` can impact performance on low-end mobile devices. Use it sparingly on mobile.
2. **Readability**: Ensure that glassmorphic layers don't reduce text contrast.
3. **Clutter**: Avoid adding too many "dashboard widgets" that detract from the primary task: getting an answer.

---

## Next Steps
1. **Safest First Step**: Refactor the `CitationCards` component to use the new "Elevated Modular" style.
2. **Build Verification**: Run `npm run build` after any CSS or layout changes.
