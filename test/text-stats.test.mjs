import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createTestHost,
  loadPlugin,
  manifestErrors,
  readManifest,
  sandboxHost,
} from "./plugin-fixture.mjs";

const PLUGIN_ID = "dev.firefly.text-stats";

test("text-stats manifest matches the 1.2.0 schema with reverse-domain id and no 0.x fields", () => {
  const manifest = readManifest(PLUGIN_ID);
  assert.deepEqual(manifestErrors(manifest), []);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, PLUGIN_ID);
  assert.equal(manifest.sdk, "^1.2.0");
  assert.equal(manifest.main, "index.cjs");
  assert.equal(manifest.native, false);
  assert.deepEqual(manifest.permissions, []);
  assert.deepEqual(manifest.tools, [
    { name: "count", title: "文本统计", risk: ["fs-read"], modes: ["work", "code"] },
  ]);
  assert.match(
    manifest.version,
    new RegExp(JSON.parse(readFileSync(new URL("../schema/host-contract.json", import.meta.url), "utf8")).semverPattern),
  );
});

test("counts Unicode code points, whitespace-separated words, and nonempty lines via createTestHost", async t => {
  const manifest = readManifest(PLUGIN_ID);
  const plugin = await loadPlugin(PLUGIN_ID);
  const host = createTestHost({ manifest, mode: "work", level: "read-only" });
  await host.activate(plugin);
  t.after(() => host.deactivate("disabled"));

  assert.deepEqual(await host.callTool("count", { text: "Hello world\nSecond line" }), {
    status: "succeeded",
    output: { characters: 23, words: 4, nonEmptyLines: 2 },
    summary: "23 字符，4 词，2 非空行",
  });
  assert.deepEqual((await host.callTool("count", { text: "A😀 e\u0301\r\n\t\r世界\u2028x\u2029 " })).output, {
    characters: 15,
    words: 4,
    nonEmptyLines: 3,
  });
  assert.deepEqual((await host.callTool("count", { text: "" })).output, {
    characters: 0,
    words: 0,
    nonEmptyLines: 0,
  });
  assert.deepEqual((await host.callTool("count", { text: " \t\r\n" })).output, {
    characters: 4,
    words: 0,
    nonEmptyLines: 0,
  });
});

test("rejects invalid arguments, chat mode, approval rejection, and pre-aborted signals without execution", async () => {
  const manifest = readManifest(PLUGIN_ID);
  const plugin = await loadPlugin(PLUGIN_ID);
  let approvalCalls = 0;
  const host = createTestHost({
    manifest,
    mode: "work",
    level: "per-action",
    approvalDecision: () => {
      approvalCalls++;
      return "reject";
    },
  });
  await host.activate(plugin);

  const rejected = await host.callTool("count", { text: "hello" });
  assert.equal(rejected.status, "not_executed");
  assert.match(rejected.reason, /ERR_REJECTED/);
  assert.equal(approvalCalls, 1);

  host.setMode("chat");
  const chatBlocked = await host.callTool("count", { text: "hello" });
  assert.equal(chatBlocked.status, "not_executed");
  assert.equal(approvalCalls, 1);

  host.setMode("work");
  host.setLevel("full");
  for (const badArgs of [{}, { text: 3 }, { text: null }, { text: ["hello"] }]) {
    const res = await host.callTool("count", badArgs);
    assert.equal(res.status, "not_executed");
    assert.match(res.reason, /ERR_INVALID_ARGUMENT/);
  }

  const ac = new AbortController();
  ac.abort("stop");
  const cancelled = await host.callTool("count", { text: "hello" }, { signal: ac.signal });
  assert.equal(cancelled.status, "not_executed");

  await host.deactivate("disabled");
  assert.equal(host.status, "deactivated");
  const afterDeactivate = await host.callTool("count", { text: "hello" });
  assert.equal(afterDeactivate.status, "not_executed");
});

test("loads and counts in isolated VM without Node, network, filesystem, or timer globals", async () => {
  const { host } = await sandboxHost(PLUGIN_ID);
  const res = await host.callTool("count", { text: "offline 😀" });
  assert.deepEqual(structuredClone(res.output), { characters: 9, words: 2, nonEmptyLines: 1 });
  await host.deactivate("disabled");
  assert.equal(host.calls.some((c) => c.method === "tools.unregister"), true);
});
