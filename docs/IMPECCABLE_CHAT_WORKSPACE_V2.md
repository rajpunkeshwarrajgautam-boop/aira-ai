# AIRA Impeccable Chat Workspace V2

## Goal

Make the AIRA home experience feel like a focused, premium AI workspace rather than a dashboard wrapped around a chat box. The chat home should be comparable in interaction density and clarity to mature assistants such as Claude and ChatGPT while keeping AIRA's distinct graphite/gold visual identity and existing research architecture.

## Design principles applied

- One primary shell on the chat home: conversation history + chat, not nested workspace rails.
- The composer is the dominant interaction surface.
- Content reads on the canvas rather than inside nested glass cards.
- Progressive disclosure for secondary actions.
- Restrained radii, borders, and motion.
- No decorative purple/blue gradients or generic AI dashboard chrome.
- Keyboard and focus states remain obvious.
- Features shown in the UI must connect to real AIRA routes or existing commands.

## New / improved interactions

### Conversation navigation

- Client-side search over saved conversation titles.
- Recent threads grouped into Today, Previous 7 days, and Older.
- `Cmd/Ctrl + Shift + O` creates a new chat.
- Direct workspace navigation to Files, Agents, OmniRoute, Compare, Memory, and global conversation/memory search.
- Settings & Integrations is available directly from the chat sidebar.

### Composer

- The `+` button opens real AIRA context/workspace destinations instead of being a placeholder.
- Typing `/` reveals the already-supported AIRA command vocabulary (`/deep`, `/new`, `/history`, `/share`).
- Files, web, memory, and tools are surfaced as available context classes without adding fake upload behavior to the composer.
- Previous user prompts can be reused into the composer, edited, and sent as a new turn.
- The composer has an optional stop-generation control contract for the existing request abort path when wired by the parent.

### Messages

- Assistant and user messages have copy actions.
- Previous user prompts expose a Reuse action that repopulates the composer without mutating saved history.
- Grounded assistant answers surface source count close to the answer identity.
- Streaming state is visually distinct but restrained.

### Empty state

- Prompt starters remain direct prompt actions.
- Real connected entry points are added for Files & Knowledge, Agents, and OmniRoute.
- Copy emphasizes what the user can do rather than marketing the interface.

## Preserved behavior

This pass does not change:

- `/api/search` request semantics
- SSE parsing
- research modes or presets
- citation generation
- conversation persistence
- billing/quota enforcement
- authentication
- memory behavior
- agent runtime

The Local AI runtime is intentionally retired. OmniRoute now owns upstream model/provider routing while AIRA retains its existing research, safety, citation, publication, memory, and agent behavior.
