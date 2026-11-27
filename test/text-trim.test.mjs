import assert from "node:assert/strict";
import test from "node:test";
import { createTestHost, manifestErrors, readManifest, sandboxHost } from "./plugin-fixture.mjs";

const PLUGIN_ID = "dev.firefly.text-trim";
const utf8 = text => new TextEncoder().encode(text).length;

async function setup(hostOptions = {}) {
  const { manifest, plugin, host } = await sandboxHost(PLUGIN_ID, hostOptions);
  return {
    manifest,
    plugin,
    host,
    cap: async args => structuredClone(await host.callTool("cap", args)),
  };
}

function captureTools(plugin) {
  const registered = new Map();
  plugin.activate({
    tools: {
      register(def) {
        registered.set(def.name, def);
        return { dispose() { registered.delete(def.name); } };
      },
    },
  });
  return registered;
}

test("manifest passes 1.2.0 schema validation with no 0.x fields", () => {
  const manifest = readManifest(PLUGIN_ID);
  assert.deepEqual(manifestErrors(manifest), []);
  assert.equal(manifest.id, PLUGIN_ID);
  assert.equal(manifest.version, "2.0.1");
  assert.equal(manifest.sdk, "^1.2.0");
});

test("head keeps a prefix within the byte budget and reports exact omitted bytes", async () => {
  const { cap, host } = await setup();
  assert.deepEqual((await cap({ text: "abcdefghij", strategy: "head", maxBytes: 4 })).output, {
    text: "abcd", truncated: true, totalBytes: 10, keptBytes: 4, omittedBytes: 6, notice: "Omitted 6 bytes.",
  });
  assert.deepEqual((await cap({ text: "abcdefghij", maxBytes: 10 })).output, {
    text: "abcdefghij", truncated: false, totalBytes: 10, keptBytes: 10, omittedBytes: 0, notice: "",
  });
  assert.deepEqual((await cap({ text: "", maxBytes: 0 })).output, {
    text: "", truncated: false, totalBytes: 0, keptBytes: 0, omittedBytes: 0, notice: "",
  });
  assert.equal((await cap({ text: "abc", maxBytes: 0 })).output.text, "");
  await host.deactivate();
});

test("tail keeps a suffix", async () => {
  const { cap, host } = await setup();
  assert.deepEqual((await cap({ text: "abcdefghij", strategy: "tail", maxBytes: 3 })).output, {
    text: "hij", truncated: true, totalBytes: 10, keptBytes: 3, omittedBytes: 7, notice: "Omitted 7 bytes.",
  });
  await host.deactivate();
});

test("headTail keeps both ends and marks the gap, counting only retained content as kept", async () => {
  const { cap, host } = await setup();
  assert.deepEqual((await cap({ text: "abcdefghij", strategy: "headTail", headBytes: 3, tailBytes: 2 })).output, {
    text: "abc\n[... omitted 5 bytes ...]\nij", truncated: true, totalBytes: 10, keptBytes: 5, omittedBytes: 5, notice: "Omitted 5 bytes.",
  });
  // The two budgets cover the whole text: nothing is cut and no marker is added.
  assert.deepEqual((await cap({ text: "abcdefghij", strategy: "headTail", headBytes: 6, tailBytes: 4 })).output, {
    text: "abcdefghij", truncated: false, totalBytes: 10, keptBytes: 10, omittedBytes: 0, notice: "",
  });
  assert.equal((await cap({ text: "abcdefghij", strategy: "headTail", headBytes: 0, tailBytes: 0 })).output.text, "\n[... omitted 10 bytes ...]\n");
  await host.deactivate();
});

test("cuts land on UTF-8 boundaries and the omission count reflects the bytes actually dropped", async () => {
  const { cap, host } = await setup();
  // "é" is 2 bytes, "世" 3 bytes, "😀" 4 bytes.
  const text = "aé世😀z";
  assert.equal(utf8(text), 11);
  const head = (await cap({ text, strategy: "head", maxBytes: 4 })).output;
  assert.equal(head.text, "aé");
  assert.deepEqual([head.keptBytes, head.omittedBytes, head.totalBytes], [3, 8, 11]);
  assert.equal((await cap({ text, strategy: "head", maxBytes: 6 })).output.text, "aé世");
  assert.equal((await cap({ text, strategy: "head", maxBytes: 10 })).output.text, "aé世😀");
  const tail = (await cap({ text, strategy: "tail", maxBytes: 5 })).output;
  assert.equal(tail.text, "😀z");
  assert.deepEqual([tail.keptBytes, tail.omittedBytes], [5, 6]);
  assert.equal((await cap({ text, strategy: "tail", maxBytes: 4 })).output.text, "z");
  const both = (await cap({ text, strategy: "headTail", headBytes: 2, tailBytes: 4 })).output;
  assert.equal(both.text, "a\n[... omitted 9 bytes ...]\nz");
  assert.deepEqual([both.keptBytes, both.omittedBytes], [2, 9]);
  for (const result of [head, tail, both]) assert.ok(!result.text.includes("\uFFFD"));
  await host.deactivate();
});

test("a lone surrogate counts as the three bytes its replacement character takes in UTF-8", async () => {
  const { cap, host } = await setup();
  const text = "a\uD800b";
  assert.equal(utf8(text), 5);
  const result = (await cap({ text, strategy: "head", maxBytes: 3 })).output;
  assert.equal(result.text, "a");
  assert.equal(result.totalBytes, 5);
  await host.deactivate();
});

test("agrees with a reference TextEncoder implementation on mixed text for every budget", async () => {
  const { cap, host } = await setup();
  const text = "Hello, 世界! 😀 café\nline two ✓";
  const total = utf8(text);
  const bytes = new TextEncoder().encode(text);
  for (let budget = 0; budget <= total + 2; budget++) {
    let end = Math.min(budget, total);
    while (end > 0 && end < total && (bytes[end] & 0xc0) === 0x80) end--;
    const expected = new TextDecoder().decode(bytes.subarray(0, end));
    const head = (await cap({ text, strategy: "head", maxBytes: budget })).output;
    assert.equal(head.text, expected, `head ${budget}`);
    assert.equal(head.keptBytes + head.omittedBytes, total);
    let start = Math.max(total - budget, 0);
    while (start < total && (bytes[start] & 0xc0) === 0x80) start++;
    const tail = (await cap({ text, strategy: "tail", maxBytes: budget })).output;
    assert.equal(tail.text, new TextDecoder().decode(bytes.subarray(start)), `tail ${budget}`);
    assert.equal(tail.keptBytes + tail.omittedBytes, total);
  }
  await host.deactivate();
});

test("validates arguments instead of coercing or guessing budgets and checks aborted signals", async () => {
  const { cap, plugin, host } = await setup();
  for (const args of [{}, { text: 1, maxBytes: 3 }, { text: null, maxBytes: 3 }, null, undefined]) {
    assert.equal((await cap(args)).status, "not_executed");
  }
  assert.match((await cap({ text: "x" })).reason, /maxBytes must be a non-negative integer/);
  for (const maxBytes of [-1, 1.5, "3", NaN, Infinity, null]) {
    assert.equal((await cap({ text: "x", maxBytes })).status, "not_executed");
  }
  assert.equal((await cap({ text: "x", strategy: "middle", maxBytes: 1 })).status, "not_executed");
  assert.match((await cap({ text: "x", strategy: "headTail", maxBytes: 3 })).reason, /headBytes and tailBytes must be non-negative integers/);
  assert.match((await cap({ text: "x", strategy: "headTail", headBytes: 1, tailBytes: -1 })).reason, /headBytes and tailBytes must be non-negative integers/);
  assert.match((await cap({ text: "x", strategy: "head", maxBytes: 1, headBytes: 1 })).reason, /headBytes and tailBytes are only for headTail/);
  assert.match((await cap({ text: "x", strategy: "headTail", headBytes: 1, tailBytes: 1, maxBytes: 1 })).reason, /maxBytes is not used with headTail/);
  assert.match((await cap({ text: "x".repeat(1_000_001), maxBytes: 5 })).reason, /at most 1000000 characters/);
  await host.deactivate();

  // Direct execute checks
  const direct = captureTools(plugin);
  const ac = new AbortController();
  ac.abort("cancelled");
  assert.equal((await direct.get("cap").execute({ text: "abc", maxBytes: 2 }, { signal: ac.signal })).status, "not_executed");
  assert.match((await direct.get("cap").execute({ text: 1, maxBytes: 3 }, {})).reason, /text must be a string/);
  assert.match((await direct.get("cap").execute({ text: "x", strategy: "middle", maxBytes: 1 }, {})).reason, /strategy must be one of head, tail, headTail/);
  plugin.deactivate();
});

test("enforces chat mode restriction, per-action rejection, and clean deactivation", async () => {
  const manifest = readManifest(PLUGIN_ID);
  const { plugin } = await sandboxHost(PLUGIN_ID);
  const host = createTestHost({
    manifest,
    mode: "work",
    level: "per-action",
    approvalDecision: "reject",
  });
  await host.activate(plugin);

  const rejected = await host.callTool("cap", { text: "hello", maxBytes: 3 });
  assert.equal(rejected.status, "not_executed");
  assert.match(rejected.reason, /ERR_REJECTED/);

  host.setMode("chat");
  const chatBlocked = await host.callTool("cap", { text: "hello", maxBytes: 3 });
  assert.equal(chatBlocked.status, "not_executed");
  assert.match(chatBlocked.reason, /unavailable in chat mode/);

  await host.deactivate("disabled");
  assert.deepEqual(
    host.calls.filter(c => c.method === "tools.unregister").map(c => c.params.name),
    ["cap"],
  );
  assert.equal((await host.callTool("cap", { text: "hello", maxBytes: 3 })).status, "not_executed");
});
