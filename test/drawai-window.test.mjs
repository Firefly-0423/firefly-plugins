import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateExport } = require("../plugins/dev.firefly.drawai/runtime/export-validation.cjs");
const { createCanvasActions } = require("../plugins/dev.firefly.drawai/runtime/canvas-actions.cjs");
const { createDocumentService } = require("../plugins/dev.firefly.drawai/runtime/documents.cjs");

async function makeTempDir(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const owned = await realpath(dir);
  const parent = await realpath(os.tmpdir());
  t.after(async () => {
    if (path.dirname(owned) !== parent || await realpath(dir) !== owned) throw new Error("Unsafe cleanup");
    await rm(owned, { recursive: true, force: true });
  });
  return owned;
}

test("pure export validation refuses active SVG, invalid PNG, and non-string payloads", () => {
  for (const data of [
    "<svg><script/></svg>",
    '<svg><image href="https://example.com"/></svg>',
    '<svg onload="x()"/>',
    '<svg style="fill:red"/>',
    '<!DOCTYPE svg><svg/>',
    '<svg><rect fill="url(https://evil.example/a)"/></svg>',
  ]) {
    assert.throws(() => validateExport("svg", data), { code: "E_EXPORT" });
  }
  const safeSvg = validateExport("svg", '<svg xmlns="http://www.w3.org/2000/svg"><text>安全</text></svg>');
  assert.equal(safeSvg.includes(Buffer.from("安全")), true);

  assert.throws(() => validateExport("png", Buffer.from("not png").toString("base64")), { code: "E_EXPORT" });
  assert.throws(() => validateExport("png", null), { code: "E_EXPORT" });
  assert.throws(() => validateExport("pdf", "anything"), { code: "E_EXPORT" });

  // Minimal valid 24-byte PNG header with 1x1 IHDR
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
  png.writeUInt32BE(13, 8);
  Buffer.from("IHDR").copy(png, 12);
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  assert.equal(validateExport("png", png.toString("base64")).length, 24);
});

test("canvasActions rejects window-message file-path handlers and keeps safe canvas RPCs working", async (t) => {
  const dataDir = await makeTempDir(t, "drawai-actions-");
  let nativeCalls = 0;
  const realService = createDocumentService({ storageRoot: dataDir });
  t.after(() => realService.stop());
  const service = {
    ...realService,
    async openNative(...args) {
      nativeCalls++;
      return realService.openNative(...args);
    },
    async save(...args) {
      nativeCalls++;
      return realService.save(...args);
    },
  };
  const actions = createCanvasActions({ service, dataDir });

  // Arbitrary path strings via window RPC must never authorize host file open or save
  await assert.rejects(
    actions.dispatch("openDocument", { filePath: path.join(dataDir, "secret.drawio") }),
    { code: "E_ARGUMENT" },
  );
  await assert.rejects(
    actions.dispatch("saveDocument", { filePath: path.join(dataDir, "out.drawio") }),
    { code: "E_ARGUMENT" },
  );
  assert.equal(nativeCalls, 0);

  // Safe in-memory / ctx.dataDir actions continue to work
  const initial = await actions.dispatch("initial");
  assert.equal(initial.theme, "firefly-dark");
  const created = await actions.dispatch("newDocument");
  assert.ok(created.handle);
  const edited = await actions.dispatch("editDocument", {
    revision: created.revision,
    ops: [{ op: "addNode", id: "n1", label: "安全画布" }],
  });
  assert.equal(edited.doc.nodes[0].label, "安全画布");

  const exported = await actions.dispatch("validateExport", {
    kind: "svg",
    data: '<svg xmlns="http://www.w3.org/2000/svg"><text>OK</text></svg>',
  });
  assert.equal(exported.kind, "svg");
  assert.ok(exported.bytes > 0);
  await assert.rejects(
    actions.dispatch("validateExport", { kind: "svg", data: "<svg><script/></svg>" }),
    { code: "E_EXPORT" },
  );
});
