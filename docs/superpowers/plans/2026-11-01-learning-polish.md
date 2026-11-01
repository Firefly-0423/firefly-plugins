# Learning panel cohesion and motion

User requested another UI pass and transition animations; continue existing PR6 targeting main. Starting commit8a74e05, clean feature worktree; PR open. Implement directly in the established native plugin, preserving all reader/card/dictionary behavior.

## Design

Keep Firefly's two theme IDs, light cool-blue neutrals and dark mint accent. Unify the dark reading/lookup/dialog panels around the same ink-green surface instead of mixing neutral charcoal and green cards. Use three clear levels (frame, workspace, surface), inset controls, softer shared borders/shadows and quieter active navigation. Improve tiny caption readability and keep the article visually primary.

User steering during implementation: "深色的绿色重做". Final dark roles supersede the ink-green surface proposal: neutral ink frame#161b18, workspace#1b201e, shared panel#222825, low-saturation accent#8bbca6 and primary#426a58. Green is reserved for interaction/status accents; light stays unchanged.

Add150–200ms opacity/short-translation entry for tabs/results/notices, native dialog opening/closing via discrete CSS transitions, subtle controls, and a theme cross-fade via supported Document.startViewTransition. Initial paint remains immediate. Honour prefers-reduced-motion for CSS and JS; unsupported/failed visual transitions must still apply the saved theme without presenting a false save error. No artificial delay to backend operations.

## Steps

- [x] Add failing theme tests for animated successful switches, reduced-motion bypass and transition failure fallback.
- [x] Implement cohesive surface roles/control/panel styling and CSS motion; package the motion stylesheet using the existing resource list and allowlist.
- [x] Verify actual Electron colors, tab/dialog motion, reduced-motion, content preservation, repeat switching and persisted reopen; refresh real screenshots. Run existing test/build/check, preserve six other plugin hashes.
- [ ] Independent scoped review, fix material findings, commit with Codex trailer and update PR6; check Windows/Ubuntu CI. No merge or Release.

References: Firefly palette source remains be9355b; user requested adapted panel cohesion over literal mixed surface roles. Browser behavior checked against MDN Document.startViewTransition and HTML dialog animation documentation on2026-11-01. Acceptance limits and actual outputs go into a follow-up validation record.

Verification ledger: final native7yx8wR passed motion and reduced-motion assertions;142 Node tests pass. Review ready-promise finding fixed RED→GREEN and rechecked; later user-directed palette change separately approved. Actual3.24s UI recording and refreshed screenshots accompany PR update. No changes outside this isolated worktree or production profile.

Latest user instructions supersede the previous dark colour choices: black ground + official Firefly green. Use workspace#000000/frame#080808/panel#111111, host accent#7bd8ae and primary#318364 (verified against host react-root.css). Preserve the light palette, animations and all existing behavior; synchronize native background and refresh actual preview/verification in PR6.
