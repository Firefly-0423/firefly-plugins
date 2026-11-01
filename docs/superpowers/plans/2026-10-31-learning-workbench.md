# Language Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track steps below.

**Goal:** Upgrade study-cards into a usable six-language native learning window, preserving old cards and the seven public tools.
**Architecture:** A private SQLite database in a worker owns cards, vocabulary, articles and import transactions. A sandboxed local window uses narrow IPC; dictionaries are indexed from bounded local Yomitan v3 ZIP streams.
**Tech Stack:** CommonJS, Electron 43 / Node 24 built-in SQLite, plain HTML/CSS/JS, readable vendored MIT ZIP reader.
**Spec:** ../specs/2026-10-31-learning-workbench-design.md (approved for implementation by user on 2026-10-31).

## Global Constraints
- Keep study-cards ID, original seven tool argument/result fields, 1000-card bound and four existing review intervals. Version 0.2.0. Default disabled.
- No Anki runtime, network requests, runtime dependency installation or Release. Existing package policies and other plugin contents stay unchanged.
- Store data only under ctx.storage.rootDir(). Preserve cards-v1.json verbatim; migration marker and cards commit together. Corrupt archives reject migration.
- Six language codes: en, ja, ko, fr, de, es. NFC / Latin case candidates only. Plain text rendering. Local system synthesis only; show honest unavailable states.
- User will view running preview before implementation PR targeting main. Do not merge.

## Review Focus
- Corrupt/truncated legacy JSON: preserve bytes, refuse mutation, retry safely on restart.
- Import failure/cancel: previous dictionary set unchanged, staging removed and no late activation.
- Repeated collect/review and concurrent tools/window writes: atomic deduplication and revision conflicts.
- Malicious ZIP/text: traversal, aliases, links, expanded bytes, hostile HTML and unsupported media must not execute.
- Window closure, re-open and plugin stop: stale replies discarded, worker/IPC/session cleaned up.

### Task 1: Worker data and dictionaries
Files: runtime/service.cjs, worker.cjs, store.cjs, dictionaries.cjs, vendor/*, test/learning-store.test.mjs, test/learning-dictionaries.test.mjs.
Interface: `createService({rootDir, now=Date.now}) -> {call(action,args={}),dispose()}`; call resolves raw data, rejects Error with code/effectState. Worker timestamps supplied per call. All calls serialized in worker.
Actions:
- create/new/due/review/update/delete/list use original tool args and raw data results.
- lookup({language,term,limit=20}) -> {entries:[{id,dictionaryId,title,revision,sourceLanguage,targetLanguage,term,reading,meaning}], match:'exact'|'case'|'none'}.
- collect({language,term,reading?,meaning,context?,dictionaryId?,operationId}) -> {cardId,revision,duplicate}; max text fields as old cards, term max200, context max4000, operationId max100; distinct operations same language/NFC term/meaning reuse card.
- vocabulary({language?,query?,offset=0,limit=40}) -> {total,items:[{cardId,revision,language,term,reading,meaning,context,dictionaryId,deck,dueAt}]}.
- dictionaryList() -> {dictionaries:[{id,title,revision,sourceLanguage,targetLanguage,enabled,priority,count,bytes,attribution,demo}],staging:null|summary}; dictionaryPrepare({path,language?}) -> summary {token,title,revision,sourceLanguage,targetLanguage,count,warnings,bytes}; dictionaryCommit({token}) / dictionaryCancel({token}); dictionarySet({id,enabled,priority}); dictionaryDelete({id}). Import is solely reachable from native-selected path in window, never model tool.
- demoInstall(): installs six tiny ORIGINAL labelled demo dictionaries idempotently, never automatically on plugin registration.
- dashboard() -> {cards,newCards,dueCards,words,dictionaries}; articleSave({id?,title,language,text,position=0}) -> {id}; articleList() -> {articles:[{id,title,language,position}]}; articleGet({id}) -> article with text; exportData() -> versioned JSON object including all learning data.
- vocabularyUpdate({cardId,expectedRevision,meaning,context}) and vocabularyDelete({cardId,expectedRevision}) update/delete associated card transactionally.
- [x] Write failing real-directory tests for migration/corruption, grading/conflict/idempotency/restart, Unicode/language lookup and malicious ZIP/rollback.
- [x] Run tests RED; implement SQLite worker/service and bounded ZIP index (200MiB archive, 1GiB expanded actual, 64MiB per bank, 2million rows). Vendor fixed yauzl+pend with licenses/provenance; use staging transaction and user-confirmed activation.
- [x] Run focused tests GREEN, report commands and remaining limitations. No changes to entry/UI/build files in this task.

### Task 2: Native entry and usable window
Files: index.cjs, runtime/window.cjs, ui/index.html, ui/learning.css, ui/learning.js, ui/preload.cjs, test/study-cards.test.mjs, test/learning-window.test.mjs.
Consumes Task 1 service contract. Window uses {open,dispose}; native dialogs own file access; renderer cannot pass paths. Preload methods mirror safe service calls with bounded args. Entry forwards original tools plus lookup/collect.
- [x] Test original tool behaviour with real temp storage and adapted corruption/package tests; retain all original test intent, no skipped tests. Test sender/action restrictions.
- [x] Implement native window with four Chinese tabs, six-language reader/selection/manual lookup, explicit demo setup, editable collect confirmation, local-only voice states, article save/open, vocabulary filters/edit/delete, revision-aware review and dictionary prepare/confirm/cancel/enable/order/delete/export.
- [x] Test real Electron SQLite worker + UI selection/collect/review/reopen using isolated data; screenshot actual views. No fake API fixtures in acceptance preview.

### Task 3: Distribution and review
Files: manifest.json, catalog.json, package-files.json, README.md, registry.json/build outputs per repository conventions, docs/validation/2026-10-31-learning-workbench.md.
- [x] List every readable runtime resource; build package and verify other six plugin package hashes unchanged.
- [x] Run npm test, npm run build, npm run check, git diff --check. Independent final review including security and integration; address material findings.
- [x] Record actual evidence and missing per-language audio validation, plus six real WTY gloss dictionaries / 263472 entries. Actual native screenshots and preview provided.
- [ ] After user acceptance create source PR targeting main; every commit includes Co-authored-by: Codex <codex@openai.com>. Do not merge automatically.

## Execution ledger
- 2026-10-31: Isolated worktree at 6cfc6dc, spec reviewed and user requested implementation. Existing canonical unrelated/untracked materials preserved.
- Preflight: Task1 internally consistent (service/worker/tests); Task2 consumes Task1.call shapes exactly; Task3 packages both, no overlapping ownership except root integration. Spec limits retained. Ruling: backend worker implementation delegated; controller owns Task2/3 integration to keep window/entry consistent.
- Ruling: Use a separate staging database but commit confirmed dictionary entries into learning.sqlite. One SQLite transaction makes activation atomic without cross-file/WAL pointer coordination; cost is that the final dictionary index is not a separate read-only file and the learning DB grows with dictionaries. Public interfaces and local-only boundaries stay the same.
- Task 1: backend16 focused tests passed; independent review covered backend and entry, canary revision mutation triggered4 failures then restored8/8 storage tests. Task2 native ZIP installed through actual Firefly PluginManager, default disabled/enable/open/re-enable, six demo languages and real worker SQLite passed. Task3 first full suite127/127 and build passed; final rebuild pending review fixes.
- Final review: reproduced P1 stale article save identity and P2 cancellation during activation; one fix wave delegated with deterministic deferred-response renderer regressions. No production data touched.
- Current remote host main refreshed to be9355b (local source9aee67e has no plugin-host/interface differences). Online marketplace still requires Release asset URLs; do not claim repository-direct online install was proved. Deliver source PR/local native ZIP preview without publishing.
- Final:134/134 tests, build/check/diff check passed. Other six package hashes unchanged. Actual Electron installer/window six real dictionaries, selection/context/collect/review/re-enable passed; Japanese local speech start/end callbacks observed. Review fixes independently rechecked clean. Pending user visual acceptance before remote PR; all data and code retained in isolated branch/worktree.
