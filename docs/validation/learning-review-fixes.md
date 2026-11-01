# Learning renderer review fixes — 2026-10-31

Scope: the two confirmed findings in `learning-final-review.md`, against product baseline `6cfc6dc` plus the existing learning working tree. Changed only `plugins/study-cards/ui/learning.js`, added `test/learning-renderer.test.mjs`, and wrote this report. Runtime, dependencies, resources, registry, and other UI files were not changed by this fix wave.

## P1: delayed article save

`saveArticle` captures the submitting article object and a separate request containing its submitted scalar fields before the first await. The returned ID/demo state is written only to that captured article. Badge/list/toast updates are conditional on that object still being current. `refreshArticles` also checks the expected article after its own await, preventing a delayed list response from changing the next article's selection.

Regression coverage executes the entire real renderer in `node:vm`, with a small DOM adapter and deferred bridge promises: replace A with B before A's save resolves, verify A receives its ID while B remains unsaved, then verify B's next request has no A ID; switch articles while the saved-article list refresh waits; and verify current-article normal completion and immutable submitted fields.

## P2: final dictionary activation

Confirmation enters explicit `importActivating` state and disables Cancel before requesting commit. `cancelImport` suppresses both button/direct invocation and the dialog Escape callback during this phase; Escape's default dialog-close behavior is already prevented. New preparation is also blocked during activation. Commit success closes the dialog. A `finally` clears activation and restores Cancel; the existing busy wrapper restores Confirm after failure, keeping the token available for retry/cancel. Pre-confirm preparation cancellation and late-token cleanup remain unchanged.

Regression coverage holds commit unresolved, exercises direct cancellation and the dialog Escape event, and verifies no cancellation call or dialog closure occurs; then resolves successful commit. Separate cases reject commit and verify retry/cancel controls and visible error, and cancel asynchronous preparation before its token arrives.

## Evidence

- Test-first RED: four initial tests, two failed for the exact confirmed defects (`saved-A` incorrectly assigned to B; Cancel disabled expected true but actual false), two existing-behavior controls passed. Production fixes followed this run.
- GREEN: six renderer regression tests passed.
- Affected suites: `node --test test/learning-renderer.test.mjs test/learning-store.test.mjs test/learning-dictionaries.test.mjs test/learning-window.test.mjs`: **24 passed, 0 failed**.
- Full `npm test`: **134 tests, 132 passed, 2 failed**. Named failures: `every package matches the committed registry, so published versions never change bytes` and `DrawAI ZIP is self-contained, disabled and retains five immutable packages`. Both report the study-cards 0.2.0 registry hash mismatch after renderer bytes changed: expected `26feec0daad8be9b88ae6a643b7ffe0b322845091294a4698920baa03d0280dd`, rebuilt source `38133dc7481df5fd15cf1e8eafbad300caff5b35c57d8e48c968aee2a0aa5b34`. Packaging refresh belongs to the controller; no full-suite green claim is made here.
- `git diff --check`: exit 0; existing CRLF normalization warnings in unrelated README/index/study-cards-test files.

## Limits and follow-up

These deterministic regressions establish renderer request identity and import-control behavior; the DOM adapter does not establish native Electron focus, rendered layout, actual keyboard dispatch, worker transaction timing, or real dictionary/audio acceptance. This agent did not run a new native preview or rebuild package artifacts. Controller must refresh package hashes, rerun final checks, and perform the requested scoped independent re-review before preview/PR. No commit or push was made.
