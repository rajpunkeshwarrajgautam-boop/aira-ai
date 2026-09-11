# AIRA AI — Master Program Handoff & Continuity Guide

In the event of an Antigravity agent restart or context compaction:
1. Load `docs/aira-ultimate/MASTER_STATE.json`.
2. Inspect the currently active wave and uncompleted gates.
3. Verify git branch is `integration/aira-ultimate-platform`.
4. Resume execution directly from the first non-complete gate in the dependency graph.
