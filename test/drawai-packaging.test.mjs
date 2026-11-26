import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareMarketplace, REPO_ROOT } from "../scripts/build.mjs";
import { sourceFixture } from "./build-fixture.mjs";
import { manifestErrors } from "./plugin-fixture.mjs";

test("asset descriptors reject traversal, duplicate paths, omitted files and non-UTF8 bytes", async (t) => {
  const root = await sourceFixture(t);
  await cp(path.join(REPO_ROOT, "plugins/dev.firefly.drawai"), path.join(root, "plugins/dev.firefly.drawai"), { recursive: true });
  const desc = path.join(root, "plugins/dev.firefly.drawai/package-files.json");
  for (const files of [["../README.md"], ["/absolute.js"], ["ui\\index.html"], ["ui/index.html", "ui/index.html"], ["ui/con.txt"]]) {
    await writeFile(desc, JSON.stringify({ files }));
    await assert.rejects(prepareMarketplace({ root, includeExcluded: true }));
  }
  await writeFile(desc, JSON.stringify({ files: ["ui/missing.js"] }));
  await assert.rejects(prepareMarketplace({ root, includeExcluded: true }));
  await writeFile(path.join(root, "plugins/dev.firefly.drawai/ui/binary.js"), Buffer.from([0xfe, 0xff]));
  await writeFile(desc, JSON.stringify({ files: ["ui/binary.js"] }));
  await assert.rejects(prepareMarketplace({ root, includeExcluded: true }));
});

test("DrawAI .ffplugin package is self-contained, 1.2.0 compliant, deterministic, and excluded from 1.2.0 registry", async () => {
  const catalog = await prepareMarketplace();
  assert.equal(catalog.plugins.some((x) => x.id === "dev.firefly.drawai"), false);
  const a = await prepareMarketplace({ includeExcluded: true });
  const b = await prepareMarketplace({ includeExcluded: true });
  const p = a.plugins.find((x) => x.id === "dev.firefly.drawai");
  assert.ok(p, "dev.firefly.drawai package missing");
  const Zip = createRequire(import.meta.url)("jszip");
  const zip = await Zip.loadAsync(p.zipBytes);
  assert.ok(zip.file("ui/editor.mjs"), "editor missing from package");
  assert.ok(zip.file("runtime/canvas-actions.cjs"));
  assert.ok(zip.file("runtime/export-validation.cjs"));
  assert.ok(zip.file("runtime/worker.cjs"));
  assert.ok(zip.file("vendor/saxes.cjs"));
  assert.equal(zip.file("runtime/window.cjs"), null, "legacy window.cjs must not be packaged");
  assert.equal(zip.file("ui/preload.cjs"), null, "legacy preload.cjs must not be packaged");
  const manifest = JSON.parse(await zip.file("firefly.plugin.json").async("string"));
  assert.deepEqual(manifestErrors(manifest), []);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.native, false);
  assert.equal(p.sha256, b.plugins.find((x) => x.id === "dev.firefly.drawai").sha256);
});
