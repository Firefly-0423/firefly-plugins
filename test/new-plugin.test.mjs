import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { prepareMarketplace } from "../scripts/build.mjs";
import { newPlugin } from "../scripts/new-plugin.mjs";
import { json, sourceFixture } from "./build-fixture.mjs";
import { createTestHost, manifestErrors } from "./plugin-fixture.mjs";

test("scaffold produces a buildable 1.2.0 plugin and an offline tool with safe lifecycle/input handling", async t => {
  const root = await sourceFixture(t);
  const id = "dev.firefly.sample-tool";
  const dir = await newPlugin(id, { root });
  assert.deepEqual((await readdir(dir)).sort(), ["LICENSE", "README.md", "catalog.json", "firefly.plugin.json", "index.cjs"]);
  const manifest = await json(path.join(dir, "firefly.plugin.json"));
  assert.deepEqual(manifestErrors(manifest), []);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.native, false);
  assert.match(await readFile(path.join(dir, "LICENSE"), "utf8"), /MIT License[\s\S]*Firefly-0423/);
  assert.ok((await prepareMarketplace({ root })).plugins.some((p) => p.id === id));

  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(await readFile(path.join(dir, "index.cjs"), "utf8"), sandbox, { timeout: 1000 });
  const plugin = sandbox.module.exports;
  const host = createTestHost({ manifest, mode: "work", level: "full" });
  await host.activate(plugin);
  const ok = await host.callTool("trim", { text: " \t世界 😀 \n" });
  assert.deepEqual(structuredClone(ok), { status: "succeeded", output: { text: "世界 😀" } });

  for (const args of [{}, { text: 2 }]) {
    const bad = await host.callTool("trim", args);
    assert.equal(bad.status, "not_executed");
  }
  const tooLong = await host.callTool("trim", { text: "x".repeat(10001) });
  assert.equal(tooLong.status, "not_executed");
  await host.deactivate("disabled");
});

test("scaffold refuses traversal, unsafe ids and existing plugins without overwriting", async t => {
  const root = await sourceFixture(t);
  const before = await readFile(path.join(root, "plugins/dev.firefly.text-stats/index.cjs"));
  for (const id of ["../escape", "../plugins/x", "single", "A.b.c", "foo/bar", "a\\b", "dev.firefly.con", "dev.firefly.nul", "dev.firefly.lpt9", "x".repeat(65)]) {
    await assert.rejects(newPlugin(id, { root }), /Invalid plugin id/);
  }
  await assert.rejects(newPlugin("dev.firefly.text-stats", { root }), /EEXIST/);
  assert.deepEqual(await readFile(path.join(root, "plugins/dev.firefly.text-stats/index.cjs")), before);
  assert.equal(existsSync(path.join(root, "escape")), false);
});
