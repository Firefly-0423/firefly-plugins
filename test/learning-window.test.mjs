import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTestHost, readManifest } from "./plugin-fixture.mjs";

const require = createRequire(import.meta.url);
const { createLearningActions } = require("../plugins/dev.firefly.study-cards/runtime/learning-actions.cjs");
const { createService } = require("../plugins/dev.firefly.study-cards/runtime/service.cjs");
const { createPlugin } = require("../plugins/dev.firefly.study-cards/index.cjs");

const PLUGIN_ID = "dev.firefly.study-cards";

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "learning-win-"));
  const owned = await realpath(dir);
  const parent = await realpath(os.tmpdir());
  t.after(async () => {
    if (path.dirname(owned) !== parent || await realpath(dir) !== owned) throw new Error("Unsafe cleanup");
    await rm(owned, { recursive: true, force: true });
  });
  return owned;
}

test("learningActions persists theme in ctx.dataDir, rejects extra/path fields, and rejects removed file-picker RPCs", async (t) => {
  const dataDir = await makeTempDir(t);
  let serviceCalls = 0;
  const service = {
    async call() {
      serviceCalls++;
      return {};
    },
  };
  const actions = createLearningActions({ service, dataDir });

  // Defaults safely to pearl-white
  assert.deepEqual(await actions.dispatch("getTheme"), { theme: "pearl-white" });
  await assert.rejects(actions.dispatch("setTheme", { theme: "unknown" }), { code: "E_ARGUMENT" });
  await assert.rejects(actions.dispatch("setTheme", { theme: "firefly-dark", path: "C:/private" }), { code: "E_ARGUMENT" });
  assert.deepEqual(await actions.dispatch("setTheme", { theme: "firefly-dark" }), { theme: "firefly-dark" });

  // Theme persists across instances in ctx.dataDir/settings.json
  const actions2 = createLearningActions({ service, dataDir });
  assert.deepEqual(await actions2.dispatch("getTheme"), { theme: "firefly-dark" });
  const saved = JSON.parse(await readFile(path.join(dataDir, "settings.json"), "utf8"));
  assert.equal(saved["ui-theme"], "firefly-dark");

  // Removed file-picker / arbitrary path RPCs must never reach service
  for (const method of ["chooseDictionary", "dictionaryPrepare", "dictionaryCommit", "dictionaryCancel", "chooseArticle", "exportData"]) {
    await assert.rejects(actions.dispatch(method, { path: "C:/private.zip" }), { code: "E_ARGUMENT" });
  }
  await assert.rejects(actions.dispatch("lookup", { language: "en", term: "hello", path: "C:/private" }), { code: "E_ARGUMENT" });
  assert.equal(serviceCalls, 0);

  // Corrupt settings.json falls back safely to pearl-white
  await writeFile(path.join(dataDir, "settings.json"), "{corrupt", "utf8");
  assert.deepEqual(await actions.dispatch("getTheme"), { theme: "pearl-white" });
});

test("ctx.ui.onMessage bridge works with createTestHost, respects ui.windows permission, and enforces CSP on UI assets", async (t) => {
  const dataDir = await makeTempDir(t);
  const manifest = readManifest(PLUGIN_ID);

  // 1. Revoking ui.windows still activates tools without crashing, while UI bridge rejects
  const revokedHost = createTestHost({
    manifest,
    mode: "work",
    level: "full",
    dataDir,
    revokedPermissions: ["ui.windows"],
  });
  await revokedHost.activate(createPlugin());
  assert.equal((await revokedHost.callTool("list", { limit: 10 })).status, "succeeded");
  await revokedHost.deactivate("disabled");

  // 2. Full ui.windows permission enables sendUiMessage round-trips
  const host = createTestHost({ manifest, mode: "work", level: "full", dataDir });
  await host.activate(createPlugin());
  const svcDataDir = await makeTempDir(t);
  const svc = createService({ rootDir: svcDataDir });
  try {
    assert.deepEqual(
      await host.sendUiMessage({ from: { kind: "window", id: "workbench" }, method: "getTheme", params: {} }),
      { theme: "pearl-white" },
    );
    await host.sendUiMessage({ from: { kind: "window", id: "workbench" }, method: "setTheme", params: { theme: "firefly-dark" } });
    assert.deepEqual(
      await host.sendUiMessage({ from: { kind: "window", id: "workbench" }, method: "getTheme", params: {} }),
      { theme: "firefly-dark" },
    );

    await host.sendUiMessage({ from: { kind: "window", id: "workbench" }, method: "demoInstall", params: {} });
    const lookup = await host.sendUiMessage({
      from: { kind: "window", id: "workbench" },
      method: "lookup",
      params: { language: "en", term: "quiet" },
    });
    assert.equal(lookup.entries.length, 1);

    await assert.rejects(
      host.sendUiMessage({ from: { kind: "window", id: "workbench" }, method: "chooseDictionary", params: { language: "en" } }),
      { code: "E_ARGUMENT" },
    );

    // 3. Static UI assets obey strict CSP (no inline scripts, no on* handlers, no style= attributes, no legacy window.Learning)
    const html = await readFile(new URL("../plugins/dev.firefly.study-cards/ui/index.html", import.meta.url), "utf8");
    const learningJs = await readFile(new URL("../plugins/dev.firefly.study-cards/ui/learning.js", import.meta.url), "utf8");
    const themeJs = await readFile(new URL("../plugins/dev.firefly.study-cards/ui/theme.js", import.meta.url), "utf8");
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, "no inline script allowed");
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, "no inline event handler attributes allowed");
    assert.equal(/\sstyle\s*=/i.test(html), false, "no inline style attributes allowed");
    assert.equal(learningJs.includes("window.fireflyPlugin"), true);
    assert.equal(themeJs.includes("window.fireflyPlugin"), true);
    assert.equal(learningJs.includes("window.Learning"), false);
    assert.equal(themeJs.includes("window.Learning"), false);

    // 4. Real service backing actions works end-to-end
    const svcActions = createLearningActions({ service: svc, dataDir: svcDataDir });
    const savedArticle = await svcActions.dispatch("articleSave", {
      title: "Test",
      language: "en",
      text: "Quiet joy",
      position: 2,
    });
    assert.equal((await svcActions.dispatch("articleGet", { id: savedArticle.id })).position, 2);
  } finally {
    await svc.dispose();
    await host.deactivate("disabled");
  }
});
