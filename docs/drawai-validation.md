# DrawAI 0.1.1 validation

DrawAI is a Firefly API v1 plugin: import its ZIP, enable it, and use the plugin card's Open action. Its independent window is owned by Firefly; users do not start a separate Node or DSH application.

## Scope

- Independent local .drawio editor: nodes, connections, labels, resizing, selection, alignment, layers, pages, undo/redo, SVG and PNG export.
- `drawai_read` and `drawai_apply` are registered with explicit schemas and host work/code modes. File operations use the host-bound workspace; native dialogs grant individual UI files.
- Manual drafts and content revisions prevent silent overwrites. XML/expanded-page limits, worker cancellation, safe IPC ownership and explicit packaged assets bound the implementation.
- Media nodes are preserved as read-only placeholders. No network, shell, extra model calls or DSH installation-data access.

## Verification

The implementation has a 109-test repository suite (including the merged study-cards tests), including extracted-ZIP execution outside repository dependencies. Tests cover path/case aliases, draft conflicts, recovery, save-as serialization, failed replacement, non-default compressed no-op round-trips, UTF-8 BOM preservation, operation schemas, runtime lifecycle and packaging validation.

Run the portable checks:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run check
node scripts/vendor-drawai.mjs --check
```

The five existing 1.0.1 plugin ZIP hashes are unchanged. The DrawAI 0.1.1 package SHA-256 is:

```text
7a6e4972a1a7e6092fdce8a4e7ec5666b3e530d349fde2ff0f3e0c9639c7dace
```

A separate native acceptance script uses a supplied compiled Firefly checkout and its Electron/Playwright dependencies:

```sh
node scripts/verify-drawai.cjs /absolute/path/to/Firefly-Agent
```

It creates an isolated test profile under ignored `.drawai-qa/`, imports the real ZIP through PluginManager/PluginVersionStore, enables its two tools, opens the actual sandboxed window and verifies editing, property changes, resize/layout, layers, host tool updates, conflict rejection, export, reopen, undo/redo, selection/pan/zoom, endpoint reconnection, page switching, disable and re-enable. Native dialogs select fixture files deterministically. It does not launch the full production settings app or contact a model endpoint.

Recorded native runs passed against compiled host checkouts with source HEADs `2c284072967d5948a399adf089541d7279333ad8` and `266b4a6684aabb582713cdb3a7aec3b4a927b71f`. API definitions were checked against published main `979b305f7eb764ef4b663c27f7f44338218fdef6`; the API remains v1. A focused host-interface suite passed 162 tests with one environment-dependent file-symlink probe skipped.

Fresh independent review reproduced six integration defects (Windows case aliases, persisted resize, property batching, layout requests, layer arguments and concurrent window opening). Each was corrected; a scoped re-review found no remaining blocker in those six items.

## Actual window captures

[Dark](validation/assets/drawai-20261027-dark.png) · [Light](validation/assets/drawai-20261027-light.png) · [Narrow](validation/assets/drawai-20261027-narrow.png)

These are native validation-window captures with fixture data, not design mockups.

## Boundaries

- Native component-host and direct tool execution are verified; real-model end-to-end, the full production settings/installer flow and universal third-party diagram compatibility are not claimed.
- In-process serialization and content checks are not an atomic cross-process compare-and-swap against unrelated editors.
- Plugins execute with application privileges in Main. Renderer isolation is not an OS sandbox for the entire plugin.
- A PR/registry entry does not publish a Release asset. Publish and verify the matching ZIP before treating online installation as available.

## Source and licenses

The pinned upstream snapshot is `fourzkw/dsh-drawai@80eb15e0a3a11cb4c88cf8716382d03cdf0e5b03` (MIT, Copyright 2026 fourzkw). Original inputs live under `scripts/upstream/drawai/`; readable adapted modules and hashes are under `plugins/drawai/upstream/`. The generator extracts the supported geometry/operation dependency closures, replaces DSH coupling, bounds inflation and preserves full content revisions. The application code supplies Firefly lifecycle, storage, tool and window adapters.

Saxes 6.0.0 and xmlchars 2.2.0 are vendored with their complete notices. Acorn 8.15.0 is a development-only extraction dependency. All versions are pinned in the lockfile.

## 2026-10-30 review fixes

File selection now precedes closing the current document; cancellation preserves the current document and recovery state. Diagram saves stage with mode 0600 and restore existing POSIX permission bits before replacement. Export replacement follows the same privacy rule. New regression tests reproduced both original defects before the fixes. POSIX permission preservation is asserted on POSIX runners; Windows checks the explicit private staging mode.

The branch incorporates main while retaining both DrawAI and study-cards catalog entries. npm test (109 passed), build, check and vendor verification passed. Historical native run records above apply to their original artifacts; fresh native acceptance is recorded separately. No Release was published in this update.

Fresh Electron acceptance on 2026-10-30 was stopped after an extended wait in a Playwright mouse.move step (script line 171). The process then exited with code 1. This run is incomplete and is not counted as passing; it does not establish a product regression. Unit and repository checks above completed normally.
