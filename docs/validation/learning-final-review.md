# Learning workbench independent final review — 2026-10-31

## Verdict

**Request changes before user preview / implementation PR:** two reproduced issues, one P1 data-loss race and one P2 misleading cancellation state. No confirmed code-execution, arbitrary-path IPC, SQL-injection, or legacy-file-overwrite vulnerability was found in the examined paths. This is a focused review, not a comprehensive dependency audit or full product acceptance.

| Severity | Count |
| --- | --- |
| P1 | 1 |
| P2 | 1 |

## Scope and baseline

- Baseline: `origin/main` / HEAD `6cfc6dc`; reviewed the working-tree implementation, including new untracked runtime, UI, vendor, package-resource and test files. A tracked-only diff would omit most of this feature.
- Read the approved implementation plan, design, backend validation report, entry point, all five runtime modules, preload, renderer, HTML, package resources, provenance and relevant ZIP-reader stream/size/name handling. Reviewed the three learning test files and the adapted original study-cards tests. CSS and vendored dependencies were not audited line by line.
- Compared the seven old tool schemas and main result shapes against `git show HEAD:plugins/study-cards/index.cjs`. Git blame identifies legacy validation from `ab025710` / `e4df0b98`; equivalent corruption, duplicate-ID, revision, card-cap and interval protections remain in the new store.
- The shared final SQLite dictionary index is an explicitly approved deviation: separate staging plus a single final transaction. It is not reported as a defect.
- Used the code-review-and-quality and differential-review skills together. No subagents, commits, permanent runtime edits, or UI edits were made by this reviewer.

## Findings

### P1 — An old article-save reply assigns its ID to a different article

**Location:** `plugins/study-cards/ui/learning.js:45`, `saveArticle()`; new working-tree code.

`saveArticle()` submits fields from the current article, then after awaiting the service writes `article.id = saved.id` to the current global object. The sample, open-file, paste and article-selection controls remain usable while saving. If they replace `article` before the reply arrives, the new article inherits the previous article's database identity. A subsequent explicit save or scroll-position autosave updates the previous saved record with the new text.

**Reproduction, executed in a Node VM against the actual renderer functions:**

1. Hold the promise returned by `Learning.articleSave` unresolved.
2. Set current article to unsaved A and call `saveArticle()`.
3. Replace current article with unrelated B, simulating the sample/open/paste flow.
4. Resolve A's save with `{id: 'saved-A'}`.
5. Observe B now contains `id: 'saved-A'`. Invoke save again and inspect its argument.

Observed second request:

```json
{"id":"saved-A","title":"B","language":"fr","text":"unrelated B","position":0}
```

This overwrites A because `articleSave` intentionally performs an upsert by ID. Blast radius: one explicit `saveArticle` caller plus the scroll autosave path, affecting saved article content and identity. Existing backend article tests cannot catch this renderer race.

**Required fix:** capture the article object and immutable submitted fields before awaiting. Associate the returned ID only with that captured article, and update visible UI only if that same article is still current. Do not attach a stale save result to the new article. Add a deferred-save renderer regression which changes articles before resolving the first save and proves that the next save cannot target A's ID.

### P2 — Cancel remains available during an activation that cannot be cancelled

**Locations:** `plugins/study-cards/ui/learning.js:135,157`; `plugins/study-cards/runtime/dictionaries.cjs:230-246`.

The confirmation handler disables only the confirm button. The cancel button and dialog Escape handler still call `cancelImport()` while `dictionaryCommit` runs. Activation copies the staging rows into the final database synchronously inside a transaction; the worker cannot handle the cancel message until that transaction has completed. Cancel then replies `{cancelled:true}` although the dictionary is installed. With a large supported dictionary the UI presents a meaningful cancellation opportunity that cannot work.

**Reproduction, executed with the real service/worker/SQLite and a temporary valid Yomitan ZIP:** prepare a dictionary, then issue:

```js
await Promise.all([
  service.call('dictionaryCommit', {token}),
  service.call('dictionaryCancel', {token}),
]);
```

Observed: commit succeeded, cancellation returned `{cancelled:true}`, and `dictionaryList().dictionaries.length` was `1`.

This does not invalidate the working cancellation of asynchronous *preparation*, which is covered by tests. The defect is the UI promising cancellation after entering the final activation phase. Blast radius: the import-confirm/cancel/Escape controls; no model-facing import tool exists.

**Required fix:** make confirmation enter an explicit adding/activation state, disable cancellation and suppress Escape cancellation until its result is known; restore appropriate controls after errors. Alternatively implement a genuinely cancellable activation transaction. Add a deferred-commit renderer test proving cancel and Escape do not imply successful cancellation after commit starts. Do not solve this by hiding successful activation or claiming the cancellation changed the already committed database.

## Verification and test quality

- Reviewer ran `node --test test/learning-store.test.mjs test/learning-dictionaries.test.mjs test/learning-window.test.mjs`: **18 passed, 0 failed**.
- Canary mutation: changed the revision guard in `runtime/store.cjs` from `c.revision !== a.expectedRevision` to `c.revision === a.expectedRevision`. The storage suite failed **4 of 8** tests, covering migration/review, vocabulary edits, filtered review state and interval/card-cap behavior. Original bytes were restored in `finally` and verified byte-for-byte; rerun: **8 passed, 0 failed**.
- Existing tests meaningfully cover legacy-byte preservation and retry, transactional deduplication/revision conflicts, four grades, card cap, six-language demo matching, CRC/path/alias/link/encryption/size rejection, preparation cancellation, disposal and sender/action/path restrictions. Their success does not cover the two renderer races above.
- Minimal UI-test harness: evaluate renderer declarations in `node:vm` with a small DOM adapter and injected `window.Learning` promises; resolve saves/commits only after dispatching the competing UI action. The article reproduction used actual `saveArticle`, not a reimplementation. This is suitable as a deterministic regression test, supplemented by real Electron acceptance.
- Read `.test-tmp-learning-preview/native-result.json`: reports real host install/enable/re-enable and six demonstration-language flows, with local Japanese/Chinese voice enumeration and renderer Node unavailable. This review did not independently rerun that entire native driver or hear audio playback. The controller's full-suite/build results remain controller-owned evidence.

## Security and architecture observations

The high-risk entry points examined were a malicious dictionary chosen through the native picker, hostile article/definition text, spoofed renderer IPC, concurrent writes and shutdown/cancellation. The importer has one production prepare entry through the native picker; model tools cannot pass import paths. Its final commit has one production UI caller. The service is shared by the nine public tools and the narrow window action map, so store revision and transaction correctness have cross-interface impact.

Prepared SQL bindings, text-only rendering, isolated sandboxed window, main-frame/sender identity checks, exact IPC field allowlists, package-asset allowlisting, network denial and native-selected file paths are present. ZIP expanded bytes are counted while streaming, including ignored resources; per-file/archive/entry/row limits and CRC validation are additional checks. The analysis found no concrete bypass in those paths. Final dictionary activation and card/vocabulary mutations use transactions. The existing operations table provides durable retry receipts; no additional stronger operation-payload contract is claimed by this review.

## Evidence limits and next action

Fix both findings with the deterministic UI regressions, rerun affected suites and rebuild/recheck package hashes before user preview. Full-size third-party dictionaries, each language's real-data coverage, boundary performance at 2 million rows / 1 GiB, disk-full and interrupted-commit fault injection, and actual per-language audio playback were not established by this review. The controller is independently adding real dictionary validation; do not conflate small gloss dictionaries, original demo entries, enumerated voices, or a passing unit suite with complete dictionary/audio acceptance. No unverified hypothetical security issue is asserted as a blocker.

## Scoped re-review — both findings resolved

**Latest verdict: approve the fixes for P1 and P2; no remaining blocker found in this scoped re-review.** This supersedes the initial request-changes verdict for these two findings only. Final package regeneration, full checks and acceptance evidence remain controller-owned gates.

Reviewed `docs/validation/learning-review-fixes.md`, the actual formatted renderer changes, and all six new tests in `test/learning-renderer.test.mjs`. This was one fix-only re-review; backend and unrelated feature behavior were not reopened.

- **P1 resolved:** `saveArticle` at current renderer line 191 captures both article identity and submitted scalar fields before awaiting. It attaches the returned ID to that captured object; visible badge and notification updates require that object still be current. `refreshArticles` at line 179 checks the same identity after its independent asynchronous list request. The new tests cover replacing A with B during save, list-refresh completion after switching to B, and the normal same-article path with a stable request snapshot. B cannot inherit A's ID in the reproduced sequence.
- **P2 resolved:** confirmation at current line 714 enters `importActivating` synchronously before requesting commit and disables Cancel. `cancelImport` at line 548 refuses cancellation while activating; the dialog Escape handler also prevents its default close behavior before invoking that guard. New preparation is blocked during activation. A `finally` restores cancellation after the commit settles, and the existing busy wrapper restores confirmation after failure. Tests cover both direct cancel and the registered dialog cancel callback during a deferred commit, a rejected commit with retry/cancel restored, and pre-confirm cancellation with late-token cleanup. The reproduced misleading cancellation path is closed.
- Independently reran `node --test test/learning-renderer.test.mjs test/learning-window.test.mjs test/learning-store.test.mjs` after the formatting pass: **16 passed, 0 failed, 0 skipped**. Six of these are the renderer regressions. No mutation or runtime/UI edit was made during re-review.
- The test harness evaluates the complete production renderer and registered callbacks with deferred bridge promises, so it verifies the relevant state transitions rather than duplicating the implementation. It remains simulated DOM evidence, not a substitute for native focus/keyboard/layout or audio acceptance.
- The controller reports six WTY gloss dictionaries with 263,472 imported entries and successful known-term queries, with file hashes recorded in `.test-tmp-learning-preview/real-dictionaries-result.json`. This re-review sampled that artifact but did not rerun those imports; the claim remains controller-owned evidence and is not expanded to full structured dictionaries, complete language coverage or audio playback.

No additional code change is requested by this re-review. Refresh the package registry hashes and run the final full checks before making a complete-suite or ready-for-PR claim.
