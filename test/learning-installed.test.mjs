import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { prepareMarketplace } from "../scripts/build.mjs";

test("extracted dev.firefly.study-cards .ffplugin runs tools, worker, SQLite, and UI RPC without repository dependencies", async (t) => {
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "firefly-learning-installed-"));
  t.after(async () => {
    const actual = await realpath(root);
    assert.equal(path.dirname(actual), parent);
    assert.ok(path.basename(actual).startsWith("firefly-learning-installed-"));
    await rm(actual, { recursive: true, force: true });
  });

  const pack = (await prepareMarketplace()).plugins.find((p) => p.id === "dev.firefly.study-cards");
  assert.ok(pack, "dev.firefly.study-cards package missing");
  const Zip = createRequire(import.meta.url)("jszip");
  const zip = await Zip.loadAsync(pack.zipBytes);
  for (const [name, entry] of Object.entries(zip.files)) {
    const dest = path.resolve(root, name);
    assert.ok(dest.startsWith(root + path.sep));
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, await entry.async("nodebuffer"));
  }

  const source = `
const assert = require("node:assert/strict");
const path = require("node:path");
(async () => {
  const p = require("./index.cjs");
  const tools = new Map();
  let uiHandler = null;
  const root = path.join(process.cwd(), "private");
  const ac = new AbortController();
  await p.activate({
    id: "dev.firefly.study-cards",
    version: "0.3.0",
    dataDir: root,
    signal: ac.signal,
    has: (perm) => perm === "ui.windows",
    tools: {
      register: (tool) => {
        tools.set(tool.name, tool);
        return { dispose() { tools.delete(tool.name); } };
      },
    },
    ui: {
      onMessage: (fn) => {
        uiHandler = fn;
        return { dispose() { uiHandler = null; } };
      },
    },
  });
  assert.equal(tools.size, 9);
  assert.equal(typeof uiHandler, "function");

  const collectRes = await tools.get("collect").execute(
    { language: "fr", term: "café", meaning: "咖啡", operationId: "installed-1" },
    { callId: "c1", sessionId: "s1", mode: "work", caller: "firefly", signal: ac.signal, progress() {} },
  );
  assert.equal(collectRes.status, "succeeded");

  const listRes = await tools.get("list").execute(
    { limit: 40 },
    { callId: "c2", sessionId: "s1", mode: "work", caller: "firefly", signal: ac.signal, progress() {} },
  );
  assert.equal(listRes.status, "succeeded");
  assert.equal(listRes.output.cards[0].front, "café");

  await uiHandler({ from: { kind: "window", id: "workbench" }, method: "demoInstall", params: {} });
  const lookupRes = await uiHandler({ from: { kind: "window", id: "workbench" }, method: "lookup", params: { language: "ja", term: "学ぶ" } });
  assert.equal(lookupRes.entries.length, 1);
  await assert.rejects(
    uiHandler({ from: { kind: "window", id: "workbench" }, method: "chooseDictionary", params: { language: "ja" } }),
    { code: "E_ARGUMENT" },
  );

  ac.abort("disabled");
  await p.deactivate("disabled");
  assert.equal(tools.size, 0);
  assert.equal(uiHandler, null);
  console.log("EXTRACTED_LEARNING_OK");
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
`;
  const child = spawnSync(process.execPath, ["-e", source], {
    cwd: root,
    env: { ...process.env, NODE_PATH: "" },
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /EXTRACTED_LEARNING_OK/);
});
