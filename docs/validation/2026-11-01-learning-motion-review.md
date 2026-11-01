# Learning cohesion and motion review — 2026-11-01

## Verdict

**Request changes: one P2 failure-path correction.** Surface cohesion, stylesheet packaging and the normal/reduced-motion paths are coherent. The asynchronous snapshot-failure path still leaks an unhandled rejection; fix it and add a targeted regression before final approval.

## Scope

Reviewed `8a74e05` through the current working tree: theme controller/tests, semantic surface/style changes, new `motion.css`, HTML/resource/package wiring, native validation additions and the approved polish plan. The user explicitly approved adapting surface roles, so the shared green reading/lookup/dialog surface is intentional and supersedes the preceding literal host-popup comparison. Backend/card/dictionary behavior is outside this follow-up review.

Applied `code-review-and-quality`: tests first, five-axis implementation review and an in-memory mutation canary. This reviewer changed only this report, spawned no agents and made no commits.

## Required finding

### P2 — Handle the rejected `ready` promise when a transition is skipped

`plugins/study-cards/ui/theme.js:23-27` immediately handles `finished` and `updateCallbackDone`, but never handles `transition.ready`. Snapshot failures and transitions skipped before animation begins reject `ready` independently while the other two promises can fulfill. Hiding/minimizing the window between saving and capture, or resizing before capture completes, is a normal way to reach this path. The catch around `startViewTransition()` only covers a synchronous throw.

The [CSS View Transitions specification](https://drafts.csswg.org/css-view-transitions/#viewtransition) explicitly states that `ready` and `updateCallbackDone` are created immediately and can produce `unhandledrejection` even when their getters are never accessed. Its skip algorithm rejects `ready`, and its page-visibility algorithm skips an active transition when the document becomes hidden. The [Chrome API documentation](https://developer.chrome.com/docs/web-platform/view-transitions/same-document) also distinguishes rejected `ready` from fulfilled `finished` for skipped visual transitions.

Independent in-memory reproduction against the unmodified controller returned `{ready: Promise.reject(Error('Transition skipped')), updateCallbackDone: Promise.resolve(), finished: Promise.resolve()}` after applying the update. Result: the saved dark theme applied, status stayed empty and the selector re-enabled, **but Node's `unhandledRejection` observer received `Transition skipped`**. The five existing theme tests still pass because their successful mock omits `ready` and their failure mock only throws synchronously.

Attach a rejection handler to the real transition's `ready` immediately, alongside the existing promise handling. Add a regression with rejected `ready` and fulfilled update/finished promises; assert the saved choice is applied, controls recover, no false save error appears and no unhandled rejection escapes. Keep coverage for rejected update/finished promises if the fallback branch is retained.

## Other reviewed behavior

- The saved preference still completes before visual application. Initial paint is immediate, unsupported View Transition APIs fall back to an immediate update, reduced motion bypasses the API, and theme selection remains disabled until the selected transition settles. No new storage/network/IPC capability is introduced.
- Surface roles consistently cover reader, lookup, words, review, dictionaries, toast and native dialogs. Shared border tokens remove the previous gray/green split. Increased caption sizes preserve content and existing layout breakpoints. There is no security-boundary or dependency change.
- CSS motion uses bounded 140–180 ms durations, no polling or backend delay. Tabs retain the existing `[hidden]` behavior. Reduced-motion rules disable normal animations/transitions and active-button translation, and remove backdrop blur.
- Native dialog motion uses `display`/`overlay` discrete transitions plus `@starting-style`; it does not replace native `showModal()`, `close()`, form/cancel behavior or focus management. No additional focus/close defect was found statically. Browser-level open/close/focus/reduced-motion assertions remain controller-owned verification gates.
- `motion.css` is included in the document, package file list and native resource allowlist. No host/private palette read, arbitrary path access or external call is added.

## Verification and limits

- Independently ran `node --test test/learning-theme.test.mjs`: **5 passed, 0 failed**.
- Ran the rejection reproduction described above in memory without modifying production files.
- In-memory mutation canary inverted the new reduced-motion condition. The existing reduced-motion animation-count assertion rejected the mutation (`animations=1`, expected `0`). Production source was untouched.
- Read controller-owned `.test-tmp-learning-native-dlHxFW/native-result.json`: `passed: true`, reader/lookup/dialog shared dark tone `rgb(29, 48, 42)`, saved dark-theme reopen, six demo languages, collect/review persistence and no renderer Node access. This is the controller's native evidence, not an independently operated native run. The artifact predates the extra motion assertions currently being added.
- Full suite, build/check, refreshed registry hash and final native motion/focus screenshots are still controller-owned completion gates. This report does not reopen the prior backend/dictionary reviews or claim broad accessibility certification.

## Scoped recheck — approved

**Latest verdict: approve the cohesion and motion delta.** This supersedes the initial request-changes verdict. The sole required P2 finding is resolved; no remaining required finding was identified within this scope.

- Independently reread the final controller: `transition.ready.catch(() => {})` is attached synchronously immediately after `startViewTransition()` returns, alongside the existing `finished` and `updateCallbackDone` handlers. This closes the skipped-snapshot rejection path without converting a visual failure into a preference-save error.
- Read the added asynchronous regression. It creates a genuinely rejected `ready` promise with successful update/finished promises and waits through `setImmediate`, so Node's test runner can observe an escaped rejection. It also checks the saved dark choice, enabled selector and empty error status. The normal animation mock now supplies all three promises.
- Independently reran `node --test test/learning-theme.test.mjs`: **6 passed, 0 failed**, including the rejected-ready regression. The controller separately reported the regression was red before the handler and green after it; this reviewer directly verified the final green state and previously reproduced the original unhandled rejection.
- Product code was not modified by this reviewer. Final expanded native motion/focus evidence, full-suite/build/check and registry freshness remain the controller's completion gates; scoped approval does not claim those pending gates have passed.

## Dark palette follow-up — approved

The user subsequently requested the dark green palette be redone. This supersedes the original green-surface design in the scope description above. **Scoped approval remains valid for the revised neutral ink palette.**

- Independently reread `theme.css`: frame `#161b18`, workspace `#1b201e` and shared panel/dialog `#222825` now provide neutral dark surfaces; desaturated `#8bbca6` accents and `#426a58` primary controls reserve green for emphasis. The native `THEMES` background and its window-test expectation both match workspace `#1b201e`; no theme ID or persistence contract changes.
- Calculated standard sRGB text contrast on the panel: primary 11.37:1, secondary 7.40:1, muted 5.85:1 and accent 7.04:1. White text on the new primary control is 6.11:1. These sampled combinations exceed 4.5:1; this is not a claim about every state or the unchanged light palette.
- Independently ran `node --test test/learning-theme.test.mjs test/learning-window.test.mjs`: **10 passed, 0 failed**.
- Read controller-owned `.test-tmp-learning-native-7yx8wR/native-result.json`: `passed: true`; actual dark workspace `rgb(27, 32, 30)`, reader/dialog `rgb(34, 40, 37)`, sidebar `rgb(22, 27, 24)` and accent `#8bbca6` match the revised source. Native proof records one theme transition; reduced motion records zero dialog animations, dialog opacity `1` and tab animation `none`. Six demo languages and saved-theme reopen remain successful. Native operation remains controller-owned evidence.
- No new required finding. Motion implementation and the reviewed rejected-ready correction remain unchanged. Final full checks, package hash and PR update remain controller-owned gates.
