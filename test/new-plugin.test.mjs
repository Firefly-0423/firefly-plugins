import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { prepareMarketplace } from "../scripts/build.mjs";
import { newPlugin } from "../scripts/new-plugin.mjs";
import { json, sourceFixture } from "./build-fixture.mjs";

test("scaffold produces a buildable disabled plugin and an offline tool with safe lifecycle/input handling", async t => {
  const root = await sourceFixture(t);
  const dir = await newPlugin("sample-tool", { root });
  assert.deepEqual((await readdir(dir)).sort(), ["LICENSE", "README.md", "catalog.json", "index.cjs", "manifest.json"]);
  const manifest = await json(path.join(dir, "manifest.json"));
  assert.equal(manifest.defaultEnabled, false);
  assert.deepEqual(manifest.deps, []);
  assert.equal(manifest.apiVersion, 1);
  assert.match(await readFile(path.join(dir, "LICENSE"), "utf8"), /MIT License[\s\S]*Firefly-0423/);
  assert.ok((await prepareMarketplace({ root })).plugins.some(p => p.id === "sample-tool"));
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(await readFile(path.join(dir, "index.cjs"), "utf8"), sandbox, { timeout: 1000 });
  const plugin = sandbox.module.exports;
  const tools = new Map();
  const ctx = { registerTool: t => tools.set(t.id, t), unregisterTool: id => tools.delete(id) };
  plugin.register(ctx);
  assert.equal(tools.size, 1);
  const tool = tools.get("sample-tool_trim");
  assert.equal(tool.risk, "safe");
  assert.equal(tool.effectKind, "read");
  assert.deepEqual(JSON.parse(await tool.execute({ text: " \t世界 😀 \n" })), { text: "世界 😀" });
  for (const args of [{}, null, { text: 2 }]) await assert.rejects(tool.execute(args), /text must be a string/);
  await assert.rejects(tool.execute({ text: "x".repeat(10001) }), /at most 10000/);
  assert.throws(() => plugin.register(ctx), /already registered/);
  plugin.unregister();
  plugin.unregister();
  assert.equal(tools.size, 0);
  plugin.register(ctx);
  plugin.unregister();
});

test("scaffold refuses traversal, unsafe ids and existing plugins without overwriting", async t => {
  const root = await sourceFixture(t);
  const before = await readFile(path.join(root, "plugins/text-stats/index.cjs"));
  for (const id of ["../escape", "../plugins/x", "A", "foo/bar", "a\\b", "a--b", "x ", "x\n", "con", "nul", "lpt9", "-x", "x".repeat(101)]) {
    await assert.rejects(newPlugin(id, { root }), /Invalid plugin id/);
  }
  await assert.rejects(newPlugin("text-stats", { root }), /EEXIST/);
  assert.deepEqual(await readFile(path.join(root, "plugins/text-stats/index.cjs")), before);
  assert.equal(existsSync(path.join(root, "escape")), false);
});
