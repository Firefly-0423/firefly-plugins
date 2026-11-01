# Learning themes implementation plan

> Use superpowers:executing-plans. User explicitly requested both colour schemes and implementation on 2026-10-31; no further design approval is needed.

**Goal:** Match the latest Firefly light/dark interface colours in the native learning plugin and then open the approved feature PR targeting main.
**Source:** Firefly-Agent main `be9355b81988ebbfbdf45d9a7469a9a3a4f2d932`, `src/renderer/react/styles/react-root.css`, `src/renderer/ui/glow.css`, `src/shared/ui-theme.ts`. Read via fetched git objects, not an older working-tree snapshot.
**Design:** Keep the current four-page workflow. Use `pearl-white` (default, cool blue-grey) and `firefly-dark` (ink-green frame, neutral reading surface, mint accents). Match source background/surface/text/accent/border/primary-button tokens. A compact header selector persists the choice in this plugin's public ctx.storage; it does not read the host's private configuration or claim automatic host sync. Native background, initial document and selector all start with the saved scheme to avoid a white flash.
**Scope:** `ui/theme.css`, `ui/theme.js`, semantic colour substitutions in `ui/learning.css`, header control in `ui/index.html`; validated getTheme/setTheme in existing IPC, preload initial theme, package resources and docs. No card/dictionary/migration/schema changes, external runtime or Release.

- [x] Write failing tests for first paint from saved theme, setting/reopening, invalid theme/extra IPC fields, renderer save failure and disabled control while saving.
- [x] Implement tokens and replace every old fixed green/white colour with semantic tokens; preserve layout/content. Add native theme persistence and preload bootstrap.
- [x] Run focused tests, full npm test/build/check and all-new-file diff checks. Capture both actual Electron themes, dialogs and reopen persistence with isolated data. Verify other six plugin hashes unchanged.
- [ ] Review theme diff and integration, preserve existing review evidence. Commit with Codex trailer, push feature branch and create source PR with base main; do not merge or publish.

## Ledger
- Starting feature commit a77c67b, clean codex/language-learning worktree. Remote plugin main unchanged at6cfc6dc. Prior preview accepted by user; PR now authorized after the requested theme implementation.
- 2026-11-01: continued user instruction.139tests passed; Electron W9K2ed proved both themes, popup colour/border and saved theme on reopen. Independent review found one missing late popup override, fixed with real native RED→GREEN. PR base remains main; no merge/Release authorized or performed.
