# Vendored ZIP reader

Runtime sources are copied from the installed packages in `E:/Codex/Firefly/firefly-agent/node_modules` on 2026-10-31. They are distributed as readable source under their original MIT licenses. No runtime package installation or host package resolution is used.

- yauzl **3.4.0**: https://github.com/thejoshwolfe/yauzl ; npm package `yauzl@3.4.0`. Files: index.js, fd-slicer.js, crc32.js, LICENSE, package.json.
- pend **1.2.0**: https://github.com/andrewrk/node-pend ; npm package `pend@1.2.0`. Files: index.js, LICENSE, package.json.

Only runtime change: `yauzl/fd-slicer.js` resolves `require('../pend')` instead of `require('pend')`, so the packaged sibling is always used. The package.json files retain upstream metadata; devDependencies are not installed or used. No source from Yomitan is included; dictionary format handling is independently implemented in runtime/dictionaries.cjs.

The importer uses yauzl's lazy sequential entry API with strict file names and size validation, then additionally verifies actual expanded bytes, CRC32, entry mode, duplicate NFC/case aliases, schema limits, and explicit user-confirmed staging activation.

Sources checked: https://github.com/thejoshwolfe/yauzl#openpath-options-callback and the vendored exact-version source/README from the installed package. SQLite API source: https://nodejs.org/api/sqlite.html (DatabaseSync/prepare/parameter binding); actual Node 24 worker tests independently verify the used API.
