# Learning backend validation — 2026-10-31

## Scope and storage

Task 1 only: runtime service/worker/store/dictionaries, readable vendored ZIP reader, backend tests. Tests use freshly allocated temporary directories. No production Firefly profile or legacy archive was modified. No commit/push performed.

`createService({rootDir, now=Date.now})` returns `{call(action,args={}),dispose()}`. Each call sends a timestamp to a serialized worker queue. Errors reject with code/effectState. Cancellation bypasses the queue so an active asynchronous ZIP preparation can roll back. Dispose cancels preparation, drains queued work, removes staging, closes SQLite and terminates the worker; pending interrupted requests conservatively report unknown. Fatal worker error/exit closes the service and future calls reject. Uncloneable inputs remove their pending requests.

Persistent files live under rootDir: learning.sqlite (WAL during use); temporary dictionary-stage-UUID.sqlite and SQLite sidecars. Startup removes only exact generated staging filenames. Valid legacy cards-v1.json is migrated once in the same transaction as the marker and remains byte-for-byte unchanged. Corrupt legacy JSON/schema prevents service mutations and can be repaired and retried after restart.

## Service shapes

- Original create/new/due/review/update/delete/list accept original argument shapes and retain original raw result fields. Card cap 1000, list maximum40, original four intervals and 365-day upper bound remain.
- collect returns `{cardId,revision,duplicate}`; operationId is durable and distinct operations deduplicate by language/NFC-term/meaning. Operation retries after deletion return the original receipt without recreating a deleted card. Vocabulary and card edits/deletion share transactions and revision checks.
- vocabulary returns `{total,items}` with cardId/revision/language/term/reading/meaning/context/dictionaryId/deck/dueAt/reviews/dictionaryTitle. Supports language,query,dictionaryId,deck,status(new/due/learning),offset,limit.
- lookup returns `{entries,match}`; entries contain id,dictionaryId,title,revision,sourceLanguage,targetLanguage,term,reading,meaning. Exact NFC results precede Latin-only case fallback. No accent removal or morphology guesses.
- dictionaryList returns `{dictionaries,staging}`; prepare returns token/title/revision/sourceLanguage/targetLanguage/count/warnings/bytes/attribution. Commit returns this summary plus id; cancel returns `{cancelled:true}`. During preparation `dictionaryCancel({})` cancels current work; after prepare pass its token. Set requires id/enabled/priority. Delete returns `{id}`.
- demoInstall explicitly installs six labelled original demo dictionaries idempotently. Each language has4–5 original sample entries/readings/Chinese definitions; existing demo IDs are left unchanged on repeat installation.
- dashboard returns `{cards,newCards,dueCards,words,dictionaries}`. ArticleSave returns `{id}`, list returns `{articles}`, get returns article text plus metadata. Title<=200, text<=1MiB UTF-8, position is integer within text length.
- exportData returns version2 with cards,vocabulary,articles,dictionaries metadata,operations. Dictionary entry corpus is intentionally excluded to avoid allocating up to2million rows for an export; users retain their original dictionary ZIP.

## ZIP handling and provenance

Pinned readable yauzl3.4.0 and pend1.2.0, MIT licenses and source provenance are under vendor/. The sole upstream patch makes pend resolve the packaged sibling. No host module/package installation/network dependency is used at runtime. Import uses lazy sequential ZIP entry streams, strict filenames, actual expanded-byte accounting, CRC32 checks, NFC/case duplicate aliases, mode/encryption rejection and schema validation. Bounds:200MiB compressed,1GiB expanded actual,64MiB each file/bank,2million source rows,10,000 ZIP entries, structured glossary nesting32. Entries with no supported core text are omitted with warnings; images/styles/media are not loaded and reported. Definitions over4000 characters reject import rather than silently truncating. Activation occurs only after explicit token commit.

Official sources consulted: https://github.com/thejoshwolfe/yauzl#openpath-options-callback and exact installed source; https://nodejs.org/api/sqlite.html for prepared parameter binding/DatabaseSync. The version-specific latest-v24 documentation URL was unavailable through browsing; actual Node24 tests verify the used synchronous API. No Yomitan source is copied.

## Verification

- RED: initial worker storage tests failed because service.cjs was missing; initial dictionary tests failed because dictionaries.cjs was missing.
- Explicit behavior RED→GREEN cycles recorded for in-flight cancellation, CRC corruption, disposing staged imports, vocabulary filters, reader demo coverage and UTF-8 article byte cap.
- `node --test test/learning-store.test.mjs test/learning-dictionaries.test.mjs`:16passed,0failed on Node24 (real worker, SQLite and temporary directories).
- Coverage includes migration/restart/raw-byte preservation, corruption refusal/retry, concurrent collect dedup, stale edit/delete/review, all four grades/card cap/pagination, source/deck/status filters, articles/export, clone failure/disposal, six-language lookup/NFC/case, staged confirmation/cancel, rollback, traversal/aliases, malformed bank, hostile structured media, CRC corruption, symbolic links/encrypted entries,200MiB archive and64MiB bank rejection.
- `npm test`:127tests,124passed,3failed at intermediate integration state. Failures: `every package matches the committed registry, so published versions never change bytes` (study-cards0.1.1 changed hash); `DrawAI ZIP is self-contained, disabled and retains five immutable packages` (includes changed study-cards hash); `built plugin packages all declared readable resources and starts disabled` (package-files.json not yet created). These belong to pending Task3 packaging; controller must rerun after version/resources/registry integration.
- `git diff --check`:exit0 at this check (CRLF normalization warnings only in controller-owned files).

## Evidence limits and design deviation

Confirmed dictionary entries currently activate into learning.sqlite in a transaction; preparation uses an independent staging index. This differs from the design wording of permanently separate read-only final dictionary indexes, and was explicitly escalated to the controller. It avoids a multi-database/WAL activation atomicity gap. No API change results.

No normal Electron worker/UI acceptance, real large third-party dictionaries,2million-row/1GiB performance boundary, aggregate expanded overflow fixture, interrupted-process power-loss simulation, disk-full/COMMIT-failure injection, or per-language local speech has been validated by this backend task. The16tests are bounded backend evidence, not complete product acceptance. Full build/check and final package evidence are controller-owned.
