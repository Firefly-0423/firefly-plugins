# Learning theme independent review — 2026-11-01

## Verdict

**Request one palette correction, then scoped recheck.** The dark popup palette does not yet include the latest host's final override. No other required theme correction was found. This review is limited to the theme delta and its integration; it does not reopen the prior full learning feature review.

## Scope and source

- Compared working-tree changes against feature baseline `a77c67b`, including the untracked `ui/theme.css`, `ui/theme.js`, theme tests and approved implementation plan.
- Independently read Firefly-Agent fetched `origin/main` `be9355b81988ebbfbdf45d9a7469a9a3a4f2d932` using Git objects: `src/renderer/react/styles/react-root.css`, `src/renderer/ui/glow.css`, `src/shared/ui-theme.ts`. The checked-out host styles were not treated as current source.
- Read the new theme tests first, then theme CSS/renderer, HTML, preload, native window/IPC changes, public host storage implementation, package resource allowlist, semantic CSS substitutions, and prior final-review record.
- Applied the code-review-and-quality skill. No product code was edited, no agents were spawned, and no commits were created by this reviewer.

## Required correction

### P2 — Apply the final dark popup override from the current host

`plugins/study-cards/ui/theme.css` currently sets dark `--ff-popover: #20342d`, the earlier root token from `react-root.css`. The later `glow.css` override sets dark popups to `#1b1e1d`, with a `#3b4240` hairline. The plugin's `dialog` and toast currently consume the earlier green popup token and the generic green `--ff-border`.

This is a visible mismatch with the user's requested latest-main palette, not a hypothetical rendering concern. The controller's actual Electron artifact `.test-tmp-learning-native-9etLLr/native-result.json` records `dialogColour: rgb(32, 52, 45)`, confirming `#20342d` reached the rendered dialog.

Use the final dark popup background and a popup-specific border token/rule so the ink-green frame can retain its own border. Refresh the native dialog assertion/screenshots accordingly. The controller has acknowledged this finding and is applying the correction; a scoped reread will supersede this initial verdict.

## Other reviewed behavior

- `getTheme`/`setTheme` reuse the existing live-instance, exact main-frame and sender validation. Extra IPC fields are rejected and accepted theme IDs are explicitly allowlisted. Neither renderer input nor stored values can inject HTML attributes: every bootstrap value passes the two-value normalizer.
- Theme preference uses the public plugin-scoped `ctx.storage`. It does not read host-private settings, expose arbitrary storage keys, or promise automatic host theme synchronization. The host implementation is synchronous atomic-file storage, matching the use here.
- Persistence completes before changing the native background and before the renderer applies a successful result. Save failure restores the selected value, retains the last applied palette, re-enables the selector and provides a text-only status. Pending saves disable further user selections. No full renderer reload or content reset is introduced.
- Native window background, resource-served initial HTML theme attribute and preload initial theme are populated from the normalized stored choice. The stylesheet order and deferred renderer bootstrap preserve that choice through first paint. Invalid/missing values fall back to `pearl-white`.
- New theme resources are present in both the package files and native asset allowlist. CSP, sandbox/context isolation, network denial and the narrow bridge remain intact. CSS substitutions cover controls, article/selection, reader/list/review surfaces, states, toast/dialog/backdrop, focus and scrollbars; no old fixed green/white palette remains in `learning.css`.
- The independent selector is a native labeled select. The now-empty theme status element is explicitly hidden and its error presentation is positioned without taking a flex slot. The controller identified screenshot capture during the pre-existing button background transition and updated the capture timing; this is not an additional product defect.

## Verification

- Independently ran `node --test test/learning-theme.test.mjs test/learning-window.test.mjs`: **7 passed, 0 failed**. Coverage includes dark first HTML/native/preload bootstrap, reopen persistence, invalid/corrupt values, extra fields, failed storage write, renderer failure rollback and pending-save disabling.
- In-memory canary: inverted the production theme normalizer's dark equality condition without changing any source file. The existing saved-dark initial-theme assertion rejected the mutated result. Original source remained untouched.
- Computed text contrast from the actual palette values: primary text on reading surface is 10.04:1 light / 11.31:1 dark; secondary text is 6.27:1 / 7.61:1; white primary-button label is 8.05:1 / 4.60:1. Source-identical muted light text is 3.60:1 on the light surface, so this report does not claim every small caption meets 4.5:1. No contrast regression requiring deviation from the explicitly requested host palette was identified.
- Sampled the controller-owned actual Electron JSON: both theme values, computed surfaces/accent/color-scheme, saved-theme reopen and dark dialog. The controller is refreshing capture timing and popup evidence. This reviewer did not independently operate the native UI or rerun full-suite/build/package checks; those remain controller-owned verification gates.

No new dependency, backend/card/dictionary behavior, external integration or schema change is introduced by this theme delta. Final full checks and regenerated registry hashes should follow the controller's last palette adjustment.

## Scoped recheck — approved

**Latest verdict: approve the theme delta.** The sole P2 palette finding is resolved; this supersedes the initial request-changes verdict above. No remaining required finding was identified in this scoped review.

- Independently reread the final theme CSS and dialog rule. Dark popups now use `#1b1e1d`, the popup-specific border is `#3b4240`, and the shadow is the final host override `0 16px 40px rgba(0, 0, 0, 0.45)`. Light popup border still resolves to the original light border token; the frame border remains unchanged.
- Read the refreshed controller-owned actual Electron artifact `.test-tmp-learning-native-W9K2ed/native-result.json`: passed, saved-theme reopen true, dialog background `rgb(27, 30, 29)` and border `rgb(59, 66, 64)`. These match the reviewed final source values. Native operation/screenshot capture remains controller-owned evidence.
- Independently reran the same focused theme/window command after the correction: **7 passed, 0 failed**. No additional product edit or full-feature rerun was needed for this scoped approval. Final full suite, build/check and registry freshness remain the controller's completion gates.
